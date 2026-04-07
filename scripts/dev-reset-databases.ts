/**
 * Dev only:
 * - PostgreSQL: `prisma migrate reset --force` (borra todas las tablas del schema, reaplica migraciones + seed).
 * - MongoDB (si `MONGODB_URI` está definido):
 *   - Por defecto: vacía solo `products_read` y `fx_rates_read` en `MONGODB_DATABASE_NAME` (default `quickmarket`).
 *   - Con `MONGODB_DROP_DATABASE=1`: hace `dropDatabase()` sobre esa base (borra toda la DB con ese nombre).
 *
 * `npm run db:reset:dev` inyecta `ALLOW_DEV_DB_RESET=1` vía cross-env.
 * Ejecución manual: `ALLOW_DEV_DB_RESET=1 npm run db:reset:dev`
 */
import { execSync } from 'child_process';
import { resolve } from 'path';
import { config } from 'dotenv';
import { MongoClient } from 'mongodb';

config({ path: resolve(process.cwd(), '.env') });

const root = resolve(__dirname, '..');

function requireAllow(): void {
  const v = (process.env.ALLOW_DEV_DB_RESET ?? '').trim();
  if (v !== '1' && v.toLowerCase() !== 'true') {
    console.error(
      '\nRefusing to reset databases. Set ALLOW_DEV_DB_RESET=1 (local dev only).\n' +
        'Example: ALLOW_DEV_DB_RESET=1 npm run db:reset:dev\n',
    );
    process.exit(1);
  }
}

function wantDropMongoDatabase(): boolean {
  const v = (process.env.MONGODB_DROP_DATABASE ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

async function clearMongoReadModels(): Promise<void> {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) {
    console.log('MONGODB_URI not set — skipped Mongo cleanup.');
    return;
  }
  const dbName =
    process.env.MONGODB_DATABASE_NAME?.trim() || 'quickmarket';
  const client = new MongoClient(uri);
  await client.connect();
  try {
    const db = client.db(dbName);
    if (wantDropMongoDatabase()) {
      await db.dropDatabase();
      console.log(`Mongo: dropped database "${dbName}" (MONGODB_DROP_DATABASE=1).`);
      return;
    }
    for (const coll of ['products_read', 'fx_rates_read']) {
      const r = await db.collection(coll).deleteMany({});
      console.log(
        `Mongo ${dbName}.${coll}: deleted ${r.deletedCount} document(s)`,
      );
    }
  } finally {
    await client.close();
  }
}

async function main(): Promise<void> {
  requireAllow();
  console.log(
    'PostgreSQL: prisma migrate reset --force (recreate schema, migrations, seed)...\n',
  );
  execSync('npx prisma migrate reset --force', {
    stdio: 'inherit',
    cwd: root,
    env: { ...process.env },
  });
  await clearMongoReadModels();
  console.log('\nReset complete.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
