import { describe, expect, it } from 'vitest';
import { InvalidConfiguration, loadConfig } from './config.ts';

describe('loadConfig', () => {
  it('applies the development defaults when nothing is provided', () => {
    const config = loadConfig({});

    expect(config.env).toBe('development');
    expect(config.http.port).toBe(3000);
    expect(config.http.host).toBe('127.0.0.1');
    expect(config.persistence).toEqual({ driver: 'sqlite', file: './data/usina.sqlite' });
  });

  it('reads port and driver from the environment', () => {
    const config = loadConfig({ PORT: '8080', PERSISTENCE_DRIVER: 'memory' });

    expect(config.http.port).toBe(8080);
    expect(config.persistence).toEqual({ driver: 'memory' });
  });

  it('requires DATABASE_URL when the driver is postgres', () => {
    expect(() => loadConfig({ PERSISTENCE_DRIVER: 'postgres' })).toThrow(InvalidConfiguration);
  });

  it('rejects an unknown driver instead of falling back to the default', () => {
    expect(() => loadConfig({ PERSISTENCE_DRIVER: 'mysql' })).toThrow(InvalidConfiguration);
  });

  it('rejects an invalid port', () => {
    expect(() => loadConfig({ PORT: '99999' })).toThrow(InvalidConfiguration);
  });

  it('builds the public base URL from host and port when none is given', () => {
    expect(loadConfig({}).http.publicUrl).toBe('http://127.0.0.1:3000');
    expect(loadConfig({ HOST: 'localhost', PORT: '8080' }).http.publicUrl).toBe(
      'http://localhost:8080',
    );
  });

  it('reads the public base URL the links of e-mails are built on, without a trailing slash', () => {
    expect(loadConfig({ APP_BASE_URL: 'https://usina.example/ ' }).http.publicUrl).toBe(
      'https://usina.example',
    );
  });

  it('rejects a public base URL that is not http or https', () => {
    expect(() => loadConfig({ APP_BASE_URL: 'usina.example' })).toThrow(InvalidConfiguration);
    expect(() => loadConfig({ APP_BASE_URL: 'ftp://usina.example' })).toThrow(InvalidConfiguration);
  });
});

describe('loadConfig — e-mail (REQ-435, REQ-436)', () => {
  it('writes e-mails to the log while no SMTP is configured', () => {
    expect(loadConfig({}).email).toEqual({ driver: 'log' });
  });

  it('uses SMTP once its host is configured, with 587 and STARTTLS by default', () => {
    expect(
      loadConfig({
        SMTP_HOST: 'smtp.usina.example',
        SMTP_USER: 'naoresponda',
        SMTP_PASSWORD: 'segredo',
        SMTP_FROM: 'Usina do Seguro <naoresponda@usina.example>',
      }).email,
    ).toEqual({
      driver: 'smtp',
      host: 'smtp.usina.example',
      port: 587,
      secure: false,
      requireTls: true,
      user: 'naoresponda',
      password: 'segredo',
      from: 'Usina do Seguro <naoresponda@usina.example>',
    });
  });

  it('reads the implicit-TLS port and an SMTP with no authentication', () => {
    expect(
      loadConfig({
        SMTP_HOST: 'smtp.usina.example',
        SMTP_PORT: '465',
        SMTP_SECURE: 'true',
        SMTP_FROM: 'naoresponda@usina.example',
      }).email,
    ).toMatchObject({ port: 465, secure: true, user: null, password: null });
  });

  it('refuses an SMTP without a sender, a user without a password, or a bad port', () => {
    expect(() => loadConfig({ SMTP_HOST: 'smtp.usina.example' })).toThrow(InvalidConfiguration);
    expect(() =>
      loadConfig({ SMTP_HOST: 'h', SMTP_FROM: 'f@u.example', SMTP_USER: 'only-user' }),
    ).toThrow(InvalidConfiguration);
    expect(() =>
      loadConfig({ SMTP_HOST: 'h', SMTP_FROM: 'f@u.example', SMTP_PORT: 'abc' }),
    ).toThrow(InvalidConfiguration);
  });

  it('lets STARTTLS be optional only when asked, and refuses a flag that is not true or false', () => {
    const smtp = { SMTP_HOST: 'h', SMTP_FROM: 'f@u.example' };
    expect(loadConfig({ ...smtp, SMTP_REQUIRE_TLS: 'false' }).email).toMatchObject({
      requireTls: false,
    });
    expect(() => loadConfig({ ...smtp, SMTP_SECURE: 'yes' })).toThrow(InvalidConfiguration);
    expect(() => loadConfig({ ...smtp, SMTP_REQUIRE_TLS: '1' })).toThrow(InvalidConfiguration);
  });

  it('keeps e-mails in memory when the tests ask for it', () => {
    expect(loadConfig({ EMAIL_DRIVER: 'memory' }).email).toEqual({ driver: 'memory' });
    expect(() => loadConfig({ EMAIL_DRIVER: 'pigeon' })).toThrow(InvalidConfiguration);
  });
});

describe('loadConfig — production', () => {
  it('requires the https address the links of e-mails point to', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/APP_BASE_URL/);
    expect(() =>
      loadConfig({ NODE_ENV: 'production', APP_BASE_URL: 'http://usina.example' }),
    ).toThrow(InvalidConfiguration);
    expect(
      loadConfig({ NODE_ENV: 'production', APP_BASE_URL: 'https://usina.example/' }).http.publicUrl,
    ).toBe('https://usina.example');
  });
});

describe('loadConfig — documents (REQ-219, REQ-247)', () => {
  const R2 = {
    DOCUMENT_STORAGE: 'r2',
    R2_ENDPOINT: 'https://0123abcd.r2.cloudflarestorage.com/',
    R2_BUCKET: 'usina-documentos',
    R2_ACCESS_KEY_ID: 'exemplo-id',
    R2_SECRET_ACCESS_KEY: 'exemplo-segredo',
  };

  it('keeps the PDFs in the database unless told otherwise', () => {
    expect(loadConfig({}).documents).toEqual({ driver: 'database' });
  });

  it('reads the R2 bucket, with the region R2 expects by default', () => {
    expect(loadConfig(R2).documents).toEqual({
      driver: 'r2',
      endpoint: 'https://0123abcd.r2.cloudflarestorage.com',
      bucket: 'usina-documentos',
      region: 'auto',
      accessKeyId: 'exemplo-id',
      secretAccessKey: 'exemplo-segredo',
    });
  });

  it('names what is missing, and never a value', () => {
    const { R2_SECRET_ACCESS_KEY: _, ...withoutSecret } = R2;
    expect(() => loadConfig(withoutSecret)).toThrow('requires R2_SECRET_ACCESS_KEY.');
    try {
      loadConfig({ ...R2, R2_ENDPOINT: '' });
    } catch (error) {
      expect(String(error)).not.toContain('exemplo-segredo');
    }
  });

  it('refuses an endpoint with the bucket in it, an unknown storage, or R2 without SQLite', () => {
    expect(() =>
      loadConfig({ ...R2, R2_ENDPOINT: 'https://0123abcd.r2.cloudflarestorage.com/bucket' }),
    ).toThrow(InvalidConfiguration);
    expect(() => loadConfig({ DOCUMENT_STORAGE: 's3' })).toThrow(InvalidConfiguration);
    expect(() => loadConfig({ ...R2, PERSISTENCE_DRIVER: 'memory' })).toThrow(
      'DOCUMENT_STORAGE=r2 requires PERSISTENCE_DRIVER=sqlite.',
    );
  });
});
