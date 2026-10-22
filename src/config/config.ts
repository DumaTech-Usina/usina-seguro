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
  /**
   * REQ-435, REQ-436: how the e-mails of access leave. `smtp` once its host is
   * configured; `log` (written to the server's output, nothing delivered)
   * until then; `memory` for the tests.
   */
  readonly email:
    | { readonly driver: 'log' }
    | { readonly driver: 'memory' }
    | {
        readonly driver: 'smtp';
        readonly host: string;
        readonly port: number;
        /** Implicit TLS (usually 465); `false` means STARTTLS when offered (587). */
        readonly secure: boolean;
        /**
         * Without implicit TLS, refuse to go on when the server does not offer
         * STARTTLS, so the password is never sent in clear.
         */
        readonly requireTls: boolean;
        readonly user: string | null;
        readonly password: string | null;
        readonly from: string;
      };
  /**
   * Where the bytes of the PDFs go (REQ-219, REQ-247). `database`: a BLOB in
   * the SQLite file. `r2`: an object in a Cloudflare R2 bucket (S3 API), with
   * the name and the type still in SQLite. Downloads always go through the
   * server: the bucket is never public.
   */
  readonly documents:
    | { readonly driver: 'database' }
    | {
        readonly driver: 'r2';
        /** `https://<account id>.r2.cloudflarestorage.com`, without the bucket. */
        readonly endpoint: string;
        readonly bucket: string;
        readonly region: string;
        readonly accessKeyId: string;
        readonly secretAccessKey: string;
      };
}

const DRIVERS: readonly PersistenceDriver[] = ['memory', 'sqlite', 'postgres'];

export class InvalidConfiguration extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidConfiguration';
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const environment = readEnvironment(env.NODE_ENV);
  const port = readPort(env.PORT);
  const host = env.HOST?.trim() || '127.0.0.1';
  const persistence = readPersistence(env);

  return {
    env: environment,
    http: {
      port,
      host,
      publicUrl: readPublicUrl(env.APP_BASE_URL, host, port, environment),
    },
    persistence,
    email: readEmail(env),
    documents: readDocuments(env, persistence),
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

function readPublicUrl(
  value: string | undefined,
  host: string,
  port: number,
  environment: Config['env'],
): string {
  // In production the default would put `http://0.0.0.0:3000` in every
  // e-mail link, and the session cookie only travels over https (REQ-412).
  if (environment === 'production' && !value?.trim().startsWith('https://')) {
    throw new InvalidConfiguration(
      'NODE_ENV=production requires APP_BASE_URL with the https address people use, ' +
        "e.g. 'https://usina.example'.",
    );
  }
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

function readEmail(env: NodeJS.ProcessEnv): Config['email'] {
  const host = env.SMTP_HOST?.trim() || null;
  const driver = env.EMAIL_DRIVER?.trim() || (host === null ? 'log' : 'smtp');

  if (driver === 'log' || driver === 'memory') {
    return { driver };
  }
  if (driver !== 'smtp') {
    throw new InvalidConfiguration(
      `Invalid EMAIL_DRIVER: '${env.EMAIL_DRIVER}'. Use smtp, log or memory.`,
    );
  }

  const from = env.SMTP_FROM?.trim() || null;
  if (host === null || from === null) {
    throw new InvalidConfiguration('The smtp e-mail driver requires SMTP_HOST and SMTP_FROM.');
  }
  const user = env.SMTP_USER?.trim() || null;
  const password = env.SMTP_PASSWORD || null;
  if ((user === null) !== (password === null)) {
    throw new InvalidConfiguration('SMTP_USER and SMTP_PASSWORD go together, or neither.');
  }
  const port = env.SMTP_PORT?.trim() ? Number(env.SMTP_PORT) : 587;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new InvalidConfiguration(`Invalid SMTP_PORT: '${env.SMTP_PORT}'.`);
  }

  return {
    driver: 'smtp',
    host,
    port,
    secure: readFlag(env, 'SMTP_SECURE', false),
    requireTls: readFlag(env, 'SMTP_REQUIRE_TLS', true),
    user,
    password,
    from,
  };
}

function readFlag(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const value = env[name]?.trim() || '';
  if (value === '') {
    return fallback;
  }
  if (value !== 'true' && value !== 'false') {
    throw new InvalidConfiguration(`Invalid ${name}: '${env[name]}'. Use true or false.`);
  }
  return value === 'true';
}

const R2_VARIABLES = ['R2_ENDPOINT', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];

function readDocuments(
  env: NodeJS.ProcessEnv,
  persistence: Config['persistence'],
): Config['documents'] {
  const driver = env.DOCUMENT_STORAGE?.trim() || 'database';
  if (driver === 'database') {
    return { driver };
  }
  if (driver !== 'r2') {
    throw new InvalidConfiguration(
      `Invalid DOCUMENT_STORAGE: '${env.DOCUMENT_STORAGE}'. Use database or r2.`,
    );
  }
  // The name and the type of each document stay in the SQLite file.
  if (persistence.driver !== 'sqlite') {
    throw new InvalidConfiguration('DOCUMENT_STORAGE=r2 requires PERSISTENCE_DRIVER=sqlite.');
  }
  const missing = R2_VARIABLES.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    // Names only: a value, even a partial one, never goes into the message.
    throw new InvalidConfiguration(`DOCUMENT_STORAGE=r2 requires ${missing.join(', ')}.`);
  }
  const endpoint = (env.R2_ENDPOINT as string).trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/]+$/.test(endpoint)) {
    throw new InvalidConfiguration(
      "Invalid R2_ENDPOINT: use the account's S3 endpoint without the bucket, " +
        "e.g. 'https://<account id>.r2.cloudflarestorage.com'.",
    );
  }
  return {
    driver,
    endpoint,
    bucket: (env.R2_BUCKET as string).trim(),
    region: env.R2_REGION?.trim() || 'auto',
    accessKeyId: (env.R2_ACCESS_KEY_ID as string).trim(),
    secretAccessKey: (env.R2_SECRET_ACCESS_KEY as string).trim(),
  };
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
