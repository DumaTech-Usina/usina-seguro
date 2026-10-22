import { AwsClient } from 'aws4fetch';
import type { Config } from '../../config/config.ts';
import type { ObjectStore } from '../persistence/sqlite/sqlite-object-document-storage.ts';

type R2Config = Extract<Config['documents'], { driver: 'r2' }>;

/** A request that takes longer than this is a failure, not a hung page. */
const TIMEOUT_MS = 30_000;

/**
 * The bytes of the PDFs in a Cloudflare R2 bucket, through its S3 API.
 *
 * Path-style addresses (`<endpoint>/<bucket>/<key>`), which R2 accepts, and so
 * does any S3-compatible server used to test it. The bucket stays private:
 * every download goes through the server, after the session is checked.
 *
 * Errors name the operation, the key and the HTTP status only — never a
 * credential, a signature or the body of the answer.
 */
export class R2ObjectStore implements ObjectStore {
  private readonly client: AwsClient;
  private readonly base: string;

  constructor(config: R2Config) {
    this.client = new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      service: 's3',
      region: config.region,
      // The default (10, with growing waits) would hold the request for minutes.
      retries: 2,
    });
    this.base = `${config.endpoint}/${encodeURIComponent(config.bucket)}`;
  }

  async put(key: string, content: Uint8Array, contentType: string): Promise<void> {
    const response = await this.request('PUT', key, {
      body: content,
      headers: { 'content-type': contentType },
    });
    await response.arrayBuffer();
  }

  async get(key: string): Promise<Uint8Array> {
    const response = await this.request('GET', key, {});
    return new Uint8Array(await response.arrayBuffer());
  }

  /** Whether the bucket answers with these credentials: `npm run storage-check`. */
  async checkBucket(): Promise<void> {
    const response = await this.send('HEAD', this.base, {});
    if (!response.ok) {
      throw new Error(`Object storage HEAD bucket failed: HTTP ${response.status}`);
    }
  }

  private async request(
    method: 'PUT' | 'GET',
    key: string,
    init: { body?: Uint8Array; headers?: Record<string, string> },
  ): Promise<Response> {
    const response = await this.send(method, `${this.base}/${encodeKey(key)}`, init);
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Object storage ${method} '${key}' failed: HTTP ${response.status}`);
    }
    return response;
  }

  private async send(
    method: string,
    url: string,
    init: { body?: Uint8Array; headers?: Record<string, string> },
  ): Promise<Response> {
    try {
      return await this.client.fetch(url, {
        method,
        ...init,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      // A network failure or the timeout: the cause says which, without the URL's signature.
      const reason =
        (error as Error).name === 'TimeoutError' ? 'timeout' : (error as Error).message;
      throw new Error(`Object storage ${method} failed: ${reason}`);
    }
  }
}

/** Each segment encoded, the slashes kept: `documents/<id>` stays a path. */
function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}
