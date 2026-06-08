/**
 * Dev only:
 * - PostgreSQL: `prisma migrate reset --force` (borra todas las tablas del schema, reaplica migraciones + seed).
 *
 * `npm run db:reset:dev` inyecta `ALLOW_DEV_DB_RESET=1` vía cross-env.
 * Ejecución manual: `ALLOW_DEV_DB_RESET=1 npm run db:reset:dev`
 */
import { execSync } from 'child_process';
import { resolve } from 'path';
import { config } from 'dotenv';

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
  console.log('\nReset complete.');
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
