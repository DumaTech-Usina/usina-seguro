import { mkdtempSync, rmSync } from 'node:fs';
import { type IncomingMessage, type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openSqliteConnection } from '../../src/infrastructure/persistence/sqlite/sqlite-connection.ts';
import { SqliteDocumentStorage } from '../../src/infrastructure/persistence/sqlite/sqlite-document-storage.ts';
import {
  type ObjectStore,
  SqliteObjectDocumentStorage,
} from '../../src/infrastructure/persistence/sqlite/sqlite-object-document-storage.ts';
import { R2ObjectStore } from '../../src/infrastructure/storage/r2-object-store.ts';

/**
 * DOCUMENT_STORAGE=r2: the bytes of the PDFs (REQ-219, REQ-247) in a bucket,
 * their name and type in SQLite. No real bucket is reached here — the object
 * store is a fake, or a local HTTP server standing for the S3 API. That the
 * signature is accepted by R2 is checked with `npm run storage-check`.
 */
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);

let directory: string;
let db: DatabaseSync;

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'usina-documents-'));
  db = openSqliteConnection(path.join(directory, 'usina.sqlite'));
});

afterEach(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
});

class FakeObjectStore implements ObjectStore {
  readonly objects = new Map<string, { content: Uint8Array; contentType: string }>();
  failing = false;

  async put(key: string, content: Uint8Array, contentType: string): Promise<void> {
    if (this.failing) {
      throw new Error('Object storage PUT failed: HTTP 503');
    }
    this.objects.set(key, { content: Uint8Array.from(content), contentType });
  }

  async get(key: string): Promise<Uint8Array> {
    const object = this.objects.get(key);
    if (object === undefined) {
      throw new Error(`Object storage GET '${key}' failed: HTTP 404`);
    }
    return object.content;
  }
}

describe('documents with their bytes in a bucket', () => {
  it('keeps the bytes in the bucket and only the name and the type in SQLite', async () => {
    const objects = new FakeObjectStore();
    const storage = new SqliteObjectDocumentStorage(db, objects);

    await storage.save({
      id: 'doc-1',
      fileName: 'proposta.pdf',
      contentType: 'application/pdf',
      content: PDF,
    });

    expect(objects.objects.get('documents/doc-1')).toEqual({
      content: PDF,
      contentType: 'application/pdf',
    });
    const row = db
      .prepare('SELECT length(content) AS size FROM document WHERE id = ?')
      .get('doc-1');
    expect(row).toEqual({ size: 0 });
    expect(await storage.findById('doc-1')).toEqual({
      id: 'doc-1',
      fileName: 'proposta.pdf',
      contentType: 'application/pdf',
      content: PDF,
    });
  });

  it('still reads, from the database, a document stored before the bucket was configured', async () => {
    await new SqliteDocumentStorage(db).save({
      id: 'doc-old',
      fileName: 'antiga.pdf',
      contentType: 'application/pdf',
      content: PDF,
    });

    const storage = new SqliteObjectDocumentStorage(db, new FakeObjectStore());

    expect((await storage.findById('doc-old'))?.content).toEqual(PDF);
  });

  it('writes no row when the upload fails, so nothing points to a missing object', async () => {
    const objects = new FakeObjectStore();
    objects.failing = true;
    const storage = new SqliteObjectDocumentStorage(db, objects);

    await expect(
      storage.save({
        id: 'doc-1',
        fileName: 'p.pdf',
        contentType: 'application/pdf',
        content: PDF,
      }),
    ).rejects.toThrow('HTTP 503');

    expect(await storage.findById('doc-1')).toBeNull();
  });

  it('answers nothing for an unknown document', async () => {
    const storage = new SqliteObjectDocumentStorage(db, new FakeObjectStore());

    expect(await storage.findById('missing')).toBeNull();
  });
});

describe('R2ObjectStore, against a local server standing for the S3 API', () => {
  let server: Server;
  let endpoint: string;
  const received: { method: string; url: string; headers: IncomingMessage['headers'] }[] = [];
  const stored = new Map<string, Buffer>();
  let status = 200;

  beforeEach(async () => {
    received.length = 0;
    stored.clear();
    status = 200;
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        received.push({
          method: request.method ?? '',
          url: request.url ?? '',
          headers: request.headers,
        });
        if (status !== 200) {
          response.writeHead(status).end('<Error><Code>AccessDenied</Code></Error>');
        } else if (request.method === 'PUT') {
          stored.set(request.url ?? '', Buffer.concat(chunks));
          response.writeHead(200).end();
        } else if (request.method === 'GET') {
          response.writeHead(200).end(stored.get(request.url ?? ''));
        } else {
          response.writeHead(200).end();
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  function store(): R2ObjectStore {
    return new R2ObjectStore({
      driver: 'r2',
      endpoint,
      bucket: 'usina-documentos',
      region: 'auto',
      accessKeyId: 'exemplo-id',
      secretAccessKey: 'exemplo-segredo',
    });
  }

  it('puts and gets the object by its path in the bucket, signed with SigV4', async () => {
    await store().put('documents/doc-1', PDF, 'application/pdf');
    const read = await store().get('documents/doc-1');

    expect(read).toEqual(PDF);
    expect(received[0]).toMatchObject({
      method: 'PUT',
      url: '/usina-documentos/documents/doc-1',
      headers: { 'content-type': 'application/pdf' },
    });
    expect(received[0]?.headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=exemplo-id\/\d{8}\/auto\/s3\/aws4_request/,
    );
    // The secret signs the request; it never travels.
    expect(JSON.stringify(received)).not.toContain('exemplo-segredo');
  });

  it('fails with the status only — no credential, no body of the answer', async () => {
    status = 403;

    const error = await store()
      .get('documents/doc-1')
      .catch((thrown: unknown) => thrown as Error);

    expect((error as Error).message).toBe("Object storage GET 'documents/doc-1' failed: HTTP 403");
  });

  it('checks the bucket with a HEAD', async () => {
    await store().checkBucket();

    expect(received[0]).toMatchObject({ method: 'HEAD', url: '/usina-documentos' });
  });
});
