import { parseArgs } from 'node:util';
import { loadConfig } from '../config/config.ts';
import { R2ObjectStore } from '../infrastructure/storage/r2-object-store.ts';

/**
 * Checks the bucket the server would keep the PDFs in, with the same
 * configuration:
 *
 *   npm run storage-check               # the bucket answers to these credentials
 *   npm run storage-check -- --write    # also writes a small object and reads it back
 *
 * `--write` leaves the object `storage-check/<moment>.txt` in the bucket: it
 * holds no document and nothing reads it. Credentials are never printed.
 */
async function main(): Promise<number> {
  const { values } = parseArgs({ options: { write: { type: 'boolean', default: false } } });
  const { documents } = loadConfig();

  if (documents.driver !== 'r2') {
    console.log('DOCUMENT_STORAGE=database: os PDFs ficam no arquivo SQLite. Nada a verificar.');
    return 0;
  }

  console.log(`R2 ${documents.endpoint} | bucket ${documents.bucket} | região ${documents.region}`);
  const store = new R2ObjectStore(documents);
  try {
    await store.checkBucket();
    console.log('Bucket acessível com estas credenciais: OK');

    if (values.write) {
      const key = `storage-check/${new Date().toISOString()}.txt`;
      const content = new TextEncoder().encode(`usina-seguro storage-check ${key}`);
      await store.put(key, content, 'text/plain');
      const read = await store.get(key);
      if (Buffer.compare(Buffer.from(read), Buffer.from(content)) !== 0) {
        console.error(`O objeto ${key} voltou diferente do que foi gravado.`);
        return 1;
      }
      console.log(`Gravação e leitura de ${key}: OK`);
    }
    return 0;
  } catch (error) {
    console.error(`Falha no armazenamento: ${(error as Error).message}`);
    return 1;
  }
}

main().then((code) => process.exit(code));
