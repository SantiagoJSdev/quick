/**
 * Importa quickmarket_data.sql contra la DATABASE_URL activa (.env).
 * Pensado para Docker local (data-only dump + schema vía prisma migrate deploy).
 *
 * Uso:
 *   npm run db:docker:up
 *   # .env → URL Docker
 *   npm run db:local:migrate
 *   npm run db:local:import
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config({ path: path.join(process.cwd(), '.env') });

const dumpPath = path.join(process.cwd(), 'quickmarket_data.sql');
const sanitizedDumpPath = path.join(process.cwd(), 'quickmarket_data.sanitized.sql');
const wrapperPath = path.join(process.cwd(), 'import_wrapper.sql');

/** pg_dump de PG18 emite SETs que PG16 no conoce. */
const DROP_SET_PARAMS = new Set([
  'transaction_timeout',
]);

function sanitizeDumpForTarget(src: string, dest: string): void {
  const text = fs.readFileSync(src, 'utf8');
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    const m = line.match(/^\s*SET\s+([a-zA-Z0-9_]+)\s*=/i);
    if (m && DROP_SET_PARAMS.has(m[1].toLowerCase())) {
      continue;
    }
    out.push(line);
  }
  fs.writeFileSync(dest, out.join('\n'), 'utf8');
}

function findPsql(): string {
  const fromPath = spawnSync('psql', ['--version'], { encoding: 'utf8' });
  if (fromPath.status === 0) return 'psql';

  const candidates = [
    'C:\\Program Files\\PostgreSQL\\18\\bin\\psql.exe',
    'C:\\Program Files\\PostgreSQL\\17\\bin\\psql.exe',
    'C:\\Program Files\\PostgreSQL\\16\\bin\\psql.exe',
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(
    'psql no está en PATH. Instala PostgreSQL client tools o agrega ...\\PostgreSQL\\XX\\bin al PATH.',
  );
}

/** Prisma usa ?schema=public; psql no lo acepta. */
function toPsqlConnectionUri(databaseUrl: string): string {
  const bare = databaseUrl.replace(/^["']|["']$/g, '').trim();
  const noHash = bare.split('#')[0] ?? bare;
  const [base, query = ''] = noHash.split('?');
  if (!query) return base;
  const kept = query
    .split('&')
    .filter((p) => {
      const key = p.split('=')[0]?.toLowerCase();
      return key !== 'schema' && key !== 'channel_binding';
    })
    .join('&');
  return kept ? `${base}?${kept}` : base;
}

function main() {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error('DATABASE_URL vacío en .env');
  }
  if (/neon\.tech/i.test(url)) {
    throw new Error(
      'DATABASE_URL apunta a Neon. Cambia a Docker local antes de importar el dump.',
    );
  }
  if (!fs.existsSync(dumpPath)) {
    throw new Error(`No existe ${dumpPath}. Genera el dump con pg_dump primero.`);
  }

  const psqlUrl = toPsqlConnectionUri(url);
  sanitizeDumpForTarget(dumpPath, sanitizedDumpPath);
  const dumpPosix = sanitizedDumpPath.replace(/\\/g, '/');
  fs.writeFileSync(
    wrapperPath,
    [
      'SET session_replication_role = replica;',
      '-- Vaciar data de migrate/seed sin borrar schema ni _prisma_migrations',
      `DO $$`,
      `DECLARE r RECORD;`,
      `BEGIN`,
      `  FOR r IN (`,
      `    SELECT tablename FROM pg_tables`,
      `    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
      `  ) LOOP`,
      `    EXECUTE format('TRUNCATE TABLE %I CASCADE', r.tablename);`,
      `  END LOOP;`,
      `END $$;`,
      `\\i '${dumpPosix}'`,
      'SET session_replication_role = DEFAULT;',
      '',
    ].join('\n'),
    'utf8',
  );

  const psql = findPsql();
  console.log(
    `Importando ${path.basename(dumpPath)} → ${psqlUrl.replace(/:[^:@/]+@/, ':****@')}`,
  );
  const result = spawnSync(
    psql,
    [psqlUrl, '-v', 'ON_ERROR_STOP=1', '-f', wrapperPath],
    {
      encoding: 'utf8',
      stdio: 'inherit',
    },
  );
  try {
    fs.unlinkSync(sanitizedDumpPath);
  } catch {
    /* ignore */
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
  console.log('Import OK');
}

main();
