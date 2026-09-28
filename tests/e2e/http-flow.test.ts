import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Application, composeApplication } from '../../src/composition-root.ts';
import { loadConfig } from '../../src/config/config.ts';
import { createHttpServer } from '../../src/interfaces/http/server.ts';

/**
 * E2E exercises the system through the real external interface: a server
 * listening on a port, real HTTP requests, SQLite persistence on disk.
 */
let directory: string;
let application: Application;
let app: FastifyInstance;
let baseUrl: string;

beforeAll(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'usina-e2e-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    PORT: '0', // ephemeral port: never conflicts
    PERSISTENCE_DRIVER: 'sqlite',
    SQLITE_FILE: path.join(directory, 'usina.sqlite'),
  });

  application = composeApplication(config);
  app = createHttpServer(application.useCases);
  await app.listen({ port: config.http.port, host: config.http.host });

  const address = app.server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Server did not expose a TCP address.');
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await app.close();
  await application.shutdown();
  rmSync(directory, { recursive: true, force: true });
});

const validProposal = {
  clientId: 'client-1',
  brokerId: 'broker-1',
  insurerId: 'insurer-1',
  productId: 'product-1',
  paymentMethodId: 'bank-slip',
  proposalNumber: 'PRP-1',
  netPremium: '1234.56',
  coverageStart: '2026-10-01',
  coverageEnd: '2027-10-01',
  installments: [{ amount: '1234.56' }],
  workedCommission: '20',
  workedCommissionMode: 'INTEGRAL',
  intermediary: null,
  userId: 'ana.souza',
};

interface ErrorBody {
  error: string;
  rule?: string;
  messageKey?: string;
  message?: string;
}

async function post(body: unknown, url = '/proposals'): Promise<Response> {
  return fetch(`${baseUrl}${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('HTTP application', () => {
  it('answers the health check', async () => {
    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });

  it('registers a proposal awaiting issuance with its expected value and returns 201 (FP-01)', async () => {
    const response = await post(validProposal);

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      status: 'AWAITING_ISSUANCE',
      netPremium: '1234.56',
      renewalDate: '2027-10-01',
      installments: [{ number: 1, amount: '1234.56', dueDate: null }],
      expectedReceipt: { intermediary: null, usina: '246.91' },
    });
  });

  it('rejects a proposal without a payment method with 422 (REQ-040)', async () => {
    const response = await post({ ...validProposal, paymentMethodId: '  ' });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: 'business_rule_violation',
      rule: 'REQ-040',
      messageKey: 'proposal.payment_method_required',
    });
  });

  it('renders the message in Portuguese through the i18n dictionary', async () => {
    const response = await post({ ...validProposal, paymentMethodId: '  ' });

    const body = (await response.json()) as ErrorBody;
    expect(body.message).toBe('Proposta exige forma de pagamento definida.');
  });

  it('interpolates message parameters in the rendered text', async () => {
    const response = await post({ ...validProposal, clientId: '   ' });

    expect(response.status).toBe(422);
    const body = (await response.json()) as ErrorBody;
    expect(body.message).toBe('Proposta exige o campo clientId.');
  });

  it('rejects a malformed body with 400 before reaching the domain', async () => {
    const response = await post({ clientId: 'client-1' });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: 'invalid_request' });
  });

  it('rejects a net premium sent as a number (REQ-120)', async () => {
    const response = await post({ ...validProposal, netPremium: 1234.56 });

    expect(response.status).toBe(400);
  });
});

async function registered(overrides: Record<string, unknown> = {}): Promise<string> {
  const response = await post({ ...validProposal, ...overrides });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

describe('proposal API (V2)', () => {
  it('accepts a proposal without installments (REQ-202, CA-216)', async () => {
    const { installments: _omitted, ...withoutInstallments } = validProposal;

    expect((await post(withoutInstallments)).status).toBe(201);
  });

  it('requires every other datum of REQ-202 (CA-216)', async () => {
    const { coverageEnd: _omitted, ...withoutCoverageEnd } = validProposal;

    expect((await post(withoutCoverageEnd)).status).toBe(400);
  });

  it('declares one intermediary with its CTU (REQ-220, REQ-231)', async () => {
    const response = await post({
      ...validProposal,
      netPremium: '100.00',
      intermediary: { intermediaryId: 'intermediary-1', ctu: '50' },
    });

    expect(await response.json()).toMatchObject({
      intermediaryId: 'intermediary-1',
      ctu: '50',
      expectedReceipt: { intermediary: '20.00', usina: '10.00' },
    });
  });

  it('refuses an intermediary without CTU with 422 (REJ-202, EX-202)', async () => {
    const response = await post({
      ...validProposal,
      intermediary: { intermediaryId: 'intermediary-1' },
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      rule: 'REQ-221',
      message: 'Com intermediária, a CTU (comissão trabalhada da Usina) é obrigatória.',
    });
  });

  it('cannot even express a second intermediary (REJ-209, CA-213)', async () => {
    const response = await post({
      ...validProposal,
      intermediary: [
        { intermediaryId: 'intermediary-1', ctu: '50' },
        { intermediaryId: 'intermediary-2', ctu: '50' },
      ],
    });

    expect(response.status).toBe(400);
  });

  it('refuses an unsigned registration (REQ-216, REJ-206)', async () => {
    const { userId: _omitted, ...unsigned } = validProposal;

    expect((await post(unsigned)).status).toBe(400);

    const blank = await post({ ...validProposal, userId: '  ' });
    expect(blank.status).toBe(422);
    expect(await blank.json()).toMatchObject({ rule: 'REQ-216' });
  });

  it('rejects a CT sent as a number (REQ-121)', async () => {
    expect((await post({ ...validProposal, workedCommission: 20 })).status).toBe(400);
  });

  it('corrects the CT and its mode, signed (REQ-214, REQ-215, CA-217)', async () => {
    const id = await registered();

    const response = await post(
      { workedCommission: '25', workedCommissionMode: 'PARCELLED', userId: 'bruno.lima' },
      `/proposals/${id}/worked-commission`,
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      workedCommissionMode: string;
      workedCommissionHistory: { workedCommission: string; informedBy: string }[];
    };
    expect(body.workedCommissionMode).toBe('PARCELLED');
    expect(body.workedCommissionHistory.map((entry) => entry.informedBy)).toEqual([
      'ana.souza',
      'bruno.lima',
    ]);
  });

  it('declares and removes the intermediary before issuance (FA-204, FA-209)', async () => {
    const id = await registered({ netPremium: '100.00' });

    const declared = await post(
      { intermediary: { intermediaryId: 'intermediary-1', ctu: '50' }, userId: 'bruno.lima' },
      `/proposals/${id}/receipt`,
    );
    expect(await declared.json()).toMatchObject({ expectedReceipt: { usina: '10.00' } });

    const removed = await post(
      { intermediary: null, userId: 'bruno.lima' },
      `/proposals/${id}/receipt`,
    );
    expect(await removed.json()).toMatchObject({
      intermediaryId: null,
      expectedReceipt: { intermediary: null, usina: '20.00' },
    });
  });

  it('keeps a refused proposal final (REQ-253, REJ-212)', async () => {
    const id = await registered();
    expect((await post({ reason: 'perfil de risco' }, `/proposals/${id}/rejection`)).status).toBe(
      200,
    );

    const response = await post(
      { workedCommission: '25', workedCommissionMode: 'INTEGRAL', userId: 'bruno.lima' },
      `/proposals/${id}/worked-commission`,
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      rule: 'REQ-253',
      message: 'Proposta recusada não pode ser alterada: a recusa é definitiva.',
    });
  });

  it('refuses a refusal without a reason (REJ-208, EX-203)', async () => {
    const id = await registered();

    const response = await post({ reason: ' ' }, `/proposals/${id}/rejection`);

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ rule: 'REQ-253' });
  });

  it('answers 404 when correcting a proposal that does not exist', async () => {
    const response = await post(
      { workedCommission: '25', workedCommissionMode: 'INTEGRAL', userId: 'bruno.lima' },
      '/proposals/ghost/worked-commission',
    );

    expect(response.status).toBe(404);
  });
});

/** REQ-218: the reference PDF holds personal data and is never versioned. */
const REFERENCE_PDF = path.resolve(import.meta.dirname, '../../proposta-exemplo.pdf');

function pdfBody(bytes: Uint8Array): { content: string } {
  return { content: Buffer.from(bytes).toString('base64') };
}

describe('reading the PDF of a proposal (REQ-218)', () => {
  it.skipIf(!existsSync(REFERENCE_PDF))(
    'answers the fields it read and registers nothing (CA-220)',
    async () => {
      const response = await post(
        pdfBody(new Uint8Array(readFileSync(REFERENCE_PDF))),
        '/proposals/pdf-reading',
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        status: 'SUCCESS',
        missing: [],
        fields: { proposalNumber: '140839725', netPremium: '643.85', insurerId: 'ALLIANZ' },
      });

      // Reading is an aid to filling the form: no proposal came out of it.
      const listed = (await (await fetch(`${baseUrl}/proposals`)).json()) as {
        proposalNumber: string;
      }[];
      expect(listed.some((proposal) => proposal.proposalNumber === '140839725')).toBe(false);
    },
  );

  it('answers FAILED, not an error, for a file that is not a PDF (CA-222)', async () => {
    const response = await post(
      pdfBody(new TextEncoder().encode('isto não é um pdf')),
      '/proposals/pdf-reading',
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'FAILED', reason: 'UNREADABLE' });
  });

  it('refuses a body without the file with 400', async () => {
    expect((await post({}, '/proposals/pdf-reading')).status).toBe(400);
  });
});

describe('the PDF a proposal was imported from (REQ-219)', () => {
  const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0xff, 0x00]);

  it('keeps the uploaded file with the proposal and hands it back as it was (CA-223)', async () => {
    const response = await post({
      ...validProposal,
      proposalNumber: 'PRP-SRC-1',
      sourceDocument: {
        fileName: 'proposta 140839725.pdf',
        contentType: 'application/pdf',
        ...pdfBody(PDF_BYTES),
      },
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: string; sourceDocument: unknown };
    expect(created.sourceDocument).toEqual({ fileName: 'proposta 140839725.pdf' });

    const download = await fetch(`${baseUrl}/proposals/${created.id}/source-document`);

    expect(download.status).toBe(200);
    expect(download.headers.get('content-type')).toBe('application/pdf');
    expect(download.headers.get('content-disposition')).toContain('attachment');
    expect(download.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(PDF_BYTES);
  });

  it('answers 404 for a proposal typed by hand', async () => {
    const created = (await (
      await post({ ...validProposal, proposalNumber: 'PRP-SRC-2' })
    ).json()) as { id: string; sourceDocument: unknown };

    expect(created.sourceDocument).toBeNull();
    expect((await fetch(`${baseUrl}/proposals/${created.id}/source-document`)).status).toBe(404);
  });
});
