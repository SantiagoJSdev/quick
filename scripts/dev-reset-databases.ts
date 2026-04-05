/**
 * Dev only: drops PostgreSQL data (prisma migrate reset + seed) and clears Mongo read-model collections.
 *
 * Requires ALLOW_DEV_DB_RESET=1 to avoid accidental runs against the wrong environment.
 *
 * Usage: ALLOW_DEV_DB_RESET=1 npm run db:reset:dev
 * Windows (PowerShell): $env:ALLOW_DEV_DB_RESET=1; npm run db:reset:dev
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
    for (const coll of ['products_read', 'fx_rates_read']) {
      const r = await db.collection(coll).deleteMany({});
      console.log(`Mongo ${dbName}.${coll}: deleted ${r.deletedCount} document(s)`);
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
