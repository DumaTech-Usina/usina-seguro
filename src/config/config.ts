/**
 * The only place in the system that reads `process.env`.
 *
 * Deliberately without a schema library: there are few keys and the validation
 * fits in a handful of lines. Swapping this out later is cheap if it ever hurts.
 *
 * Configuration errors are reported in English: they abort startup and are read
 * by a developer or operator, never by an end user, so they do not go through
 * the i18n dictionary.
 */

export type PersistenceDriver = 'memory' | 'sqlite' | 'postgres';

export interface Config {
  readonly env: 'development' | 'test' | 'production';
  readonly http: {
    readonly port: number;
    readonly host: string;
    /**
     * Where people reach the system, without a trailing slash: the base of
     * the links sent by e-mail (REQ-420, REQ-425) and the origin a changing
     * request must come from (REQ-417).
     */
    readonly publicUrl: string;
  };
  readonly persistence:
    | { readonly driver: 'memory' }
    | { readonly driver: 'sqlite'; readonly file: string }
    | { readonly driver: 'postgres'; readonly url: string };
}

const DRIVERS: readonly PersistenceDriver[] = ['memory', 'sqlite', 'postgres'];

export class InvalidConfiguration extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidConfiguration';
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = readPort(env.PORT);
  const host = env.HOST?.trim() || '127.0.0.1';

  return {
    env: readEnvironment(env.NODE_ENV),
    http: {
      port,
      host,
      publicUrl: readPublicUrl(env.APP_BASE_URL, host, port),
    },
    persistence: readPersistence(env),
  };
}

function readEnvironment(value: string | undefined): Config['env'] {
  const environment = value?.trim() || 'development';
  if (environment !== 'development' && environment !== 'test' && environment !== 'production') {
    throw new InvalidConfiguration(
      `Invalid NODE_ENV: '${value}'. Use development, test or production.`,
    );
  }
  return environment;
}

function readPort(value: string | undefined): number {
  if (value === undefined || value.trim() === '') {
    return 3000;
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new InvalidConfiguration(`Invalid PORT: '${value}'.`);
  }
  return port;
}

function readPublicUrl(value: string | undefined, host: string, port: number): string {
  const url = value?.trim() || `http://${host}:${port}`;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new InvalidConfiguration(`Invalid APP_BASE_URL: '${value}'. Use an http(s) URL.`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new InvalidConfiguration(`Invalid APP_BASE_URL: '${value}'. Use an http(s) URL.`);
  }

  return url.replace(/\/+$/, '');
}

function readPersistence(env: NodeJS.ProcessEnv): Config['persistence'] {
  const driver = (env.PERSISTENCE_DRIVER?.trim() || 'sqlite') as PersistenceDriver;

  if (!DRIVERS.includes(driver)) {
    throw new InvalidConfiguration(
      `Invalid PERSISTENCE_DRIVER: '${env.PERSISTENCE_DRIVER}'. Use ${DRIVERS.join(', ')}.`,
    );
  }

  if (driver === 'memory') {
    return { driver };
  }

  if (driver === 'sqlite') {
    return { driver, file: env.SQLITE_FILE?.trim() || './data/usina.sqlite' };
  }

  const url = env.DATABASE_URL?.trim();
  if (!url) {
    throw new InvalidConfiguration('PERSISTENCE_DRIVER=postgres requires DATABASE_URL.');
  }
  return { driver, url };
}
