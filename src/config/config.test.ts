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
