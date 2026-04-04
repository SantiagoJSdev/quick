<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

[circleci-image]: https://img.shields.io/circleci/build/github/nestjs/nest/master?token=abc123def456
[circleci-url]: https://circleci.com/gh/nestjs/nest

  <p align="center">A progressive <a href="http://nodejs.org" target="_blank">Node.js</a> framework for building efficient and scalable server-side applications.</p>
    <p align="center">
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/v/@nestjs/core.svg" alt="NPM Version" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/l/@nestjs/core.svg" alt="Package License" /></a>
<a href="https://www.npmjs.com/~nestjscore" target="_blank"><img src="https://img.shields.io/npm/dm/@nestjs/common.svg" alt="NPM Downloads" /></a>
<a href="https://circleci.com/gh/nestjs/nest" target="_blank"><img src="https://img.shields.io/circleci/build/github/nestjs/nest/master" alt="CircleCI" /></a>
<a href="https://coveralls.io/github/nestjs/nest?branch=master" target="_blank"><img src="https://coveralls.io/repos/github/nestjs/nest/badge.svg?branch=master#9" alt="Coverage" /></a>
<a href="https://discord.gg/G7Qnnhy" target="_blank"><img src="https://img.shields.io/badge/discord-online-brightgreen.svg" alt="Discord"/></a>
<a href="https://opencollective.com/nest#backer" target="_blank"><img src="https://opencollective.com/nest/backers/badge.svg" alt="Backers on Open Collective" /></a>
<a href="https://opencollective.com/nest#sponsor" target="_blank"><img src="https://opencollective.com/nest/sponsors/badge.svg" alt="Sponsors on Open Collective" /></a>
  <a href="https://paypal.me/kamilmysliwiec" target="_blank"><img src="https://img.shields.io/badge/Donate-PayPal-ff3f59.svg" alt="Donate us"/></a>
    <a href="https://opencollective.com/nest#sponsor"  target="_blank"><img src="https://img.shields.io/badge/Support%20us-Open%20Collective-41B883.svg" alt="Support us"></a>
  <a href="https://twitter.com/nestframework" target="_blank"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow" alt="Follow us on Twitter"></a>
</p>
  <!--[![Backers on Open Collective](https://opencollective.com/nest/backers/badge.svg)](https://opencollective.com/nest#backer)
  [![Sponsors on Open Collective](https://opencollective.com/nest/sponsors/badge.svg)](https://opencollective.com/nest#sponsor)-->

## Description

[Nest](https://github.com/nestjs/nest) framework TypeScript starter repository.

## Quick Start (Database first)

This backend requires PostgreSQL before starting Nest.

1. Copy env template:

```bash
copy .env.example .env
```

2. Ensure PostgreSQL is running at `localhost:5432` with:
- user: `postgres`
- password: `postgres`
- database: `gemini`

3. If using Docker Desktop, start Docker first, then run:

```bash
docker compose up -d db
```

4. Run Prisma migration/generate:

```bash
npx prisma generate
npx prisma migrate dev
```

5. (Opcional) Seed: monedas USD/VES, **crea una tienda por defecto si no hay ninguna**, `BusinessSettings`, tasa ejemplo y outbox. Comando correcto:

```bash
npm run db:seed
```

(No uses `npx run:db seed`; no existe. Si hace falta: `npx prisma generate` y luego el seed, con el API detenido si Windows bloquea el DLL de Prisma.)

6. Start API:

```bash
npm run start:dev
```

## Inspeccionar PostgreSQL en Windows

PostgreSQL usa **tablas** (no “colecciones”; eso es Mongo).

1. **Prisma Studio** (recomendado para este proyecto): en la raiz del backend ejecuta `npx prisma studio` y abre el navegador. Veras `ExchangeRate`, `Currency`, `Store`, `Product`, `OutboxEvent`, etc.
2. **pgAdmin** o **DBeaver**: conecta con los mismos datos que `DATABASE_URL` (host, puerto, usuario, contraseña, base `gemini`).
3. **Docker**: si Postgres corre en contenedor, puedes usar `docker exec -it gemini-postgres psql -U postgres -d gemini` y luego `\dt` para listar tablas.

## Mongo: `products_read` y `fx_rates_read`

- **`products_read`**: proyeccion del catalogo (eventos de producto en outbox).
- **`fx_rates_read`**: proyeccion de la **ultima tasa por tienda y par** (USD/VES, etc.) cuando se crea un `ExchangeRate` y el worker procesa el outbox. Sirve para lectura rapida / sync hacia dispositivos si expones Mongo al cliente (o replica local).
- **PostgreSQL** sigue siendo la fuente maestra; Mongo es eventual.

## Prisma: carpeta `prisma/migrations/`

Cada subcarpeta con nombre tipo **`20260404112022_sync_push_store_sync_state`** es **una migración versionada** del esquema de PostgreSQL:

- Dentro hay un **`migration.sql`** con los `CREATE TABLE`, `ALTER TABLE`, índices, etc. que deben aplicarse en la base.
- **`npx prisma migrate dev`** (desarrollo) o **`npx prisma migrate deploy`** (CI/producción) ejecutan esas migraciones en orden para que la base coincida con **`prisma/schema.prisma`**.
- No hace falta tocar esos SQL a mano en el día a día: se generan al cambiar el schema con Prisma.

**Ejemplo concreto** `20260404112022_sync_push_store_sync_state`: crea la tabla **`StoreSyncState`** (contador **`serverVersion`** por tienda para sync) y amplía **`SyncOperation`** (campos y FKs necesarios para **`POST /api/v1/sync/push`** e idempotencia por `opId`). El API en sí no “lee” esa carpeta en runtime; solo la usa Prisma al migrar.

## Header `X-Store-Id` (obligatorio en casi toda la API)

Salvo la ruta raiz (`GET /`), las rutas exigen el header **`X-Store-Id: <uuid-de-tienda>`** y que existan **`Store`** + **`BusinessSettings`** para esa tienda. Asi no se usan endpoints sin tienda configurada.

- **`GET /api/v1/stores/:storeId/business-settings`**: el `X-Store-Id` debe coincidir con `:storeId`.
- **Tasas**: solo por tienda (no hay tasa global `storeId null` en la API actual).

## OpenAPI (Swagger)

Con la API en marcha (`npm run start:dev`): abre **http://localhost:3000/api/docs**. Usa **Authorize** y el esquema de API Key **X-Store-Id** con el UUID de la tienda (el mismo que en Postman).

## Postman: `postman/QuickMarket_API.postman_collection.json`

Es un archivo **colección de Postman** (formato JSON Collection v2.1). **No lo ejecuta Nest**; sirve para **importarlo en Postman** (Import → elegir el archivo) y tener requests de ejemplo (raíz, productos, business-settings, tasas, `sync/push`) con variables **`baseUrl`** y **`storeId`**. Así pruebas la API sin reescribir URLs y headers cada vez; puedes versionarlo en git junto al backend.

Tras importar, rellena **`storeId`** con el UUID de tu tienda (salida del seed o columna `id` en `Store` en Prisma Studio). Para **`sync/push`**, si repites el mismo `opId` que ya se aplicó, la API responderá `skipped`: usa un UUID nuevo por operación de prueba o borra la fila en `SyncOperation` si quieres repetir el mismo id.

**`GET /api/v1/sync/pull`**: el POS baja cambios del servidor (catálogo) con `?since=<ultima_version_pull>&limit=500`. Esa versión es la de **`ServerChangeLog`**, no la misma que `acked[].serverVersion` de `sync/push` (ver `docs/api/SYNC_CONTRACTS.md`).

**Inventario**: `GET /api/v1/inventory`, `GET .../movements`, `POST .../adjustments` (ajuste `IN_ADJUST`/`OUT_ADJUST`); ver Swagger y `docs/FRONTEND_INTEGRATION_CONTEXT.md`.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```

**Integración con PostgreSQL** (outbox + `sync/push`): con la base migrada y seed:

```powershell
npm run test:integration
```

(o en PowerShell: `$env:RUN_INTEGRATION='1'; npm run test` — en bash: `RUN_INTEGRATION=1 npm run test`). Sin `RUN_INTEGRATION=1`, los `*.integration.spec.ts` se omiten.

**Si `npm run test:integration` falla con** `Could not find mapping for model StoreSyncState` **(u otro modelo que acabas de añadir en `schema.prisma`)**: el **cliente generado de Prisma** en `node_modules/.prisma/client` no está al día. Detén el API (`npm run start:dev`), ejecuta **`npx prisma generate`** y vuelve a lanzar los tests. Suele pasar si migraste la base pero no se pudo regenerar el client (por ejemplo **EPERM** en Windows).

**Prisma en Windows**: si `npx prisma generate` falla con `EPERM` al sustituir `query_engine-windows.dll.node`, detén `npm run start:dev` (y cualquier proceso que use ese DLL) y vuelve a ejecutar el generate.

## Deployment

When you're ready to deploy your NestJS application to production, there are some key steps you can take to ensure it runs as efficiently as possible. Check out the [deployment documentation](https://docs.nestjs.com/deployment) for more information.

If you are looking for a cloud-based platform to deploy your NestJS application, check out [Mau](https://mau.nestjs.com), our official platform for deploying NestJS applications on AWS. Mau makes deployment straightforward and fast, requiring just a few simple steps:

```bash
$ npm install -g mau
$ mau deploy
```

With Mau, you can deploy your application in just a few clicks, allowing you to focus on building features rather than managing infrastructure.

## Resources

Check out a few resources that may come in handy when working with NestJS:

- Visit the [NestJS Documentation](https://docs.nestjs.com) to learn more about the framework.
- For questions and support, please visit our [Discord channel](https://discord.gg/G7Qnnhy).
- To dive deeper and get more hands-on experience, check out our official video [courses](https://courses.nestjs.com/).
- Deploy your application to AWS with the help of [NestJS Mau](https://mau.nestjs.com) in just a few clicks.
- Visualize your application graph and interact with the NestJS application in real-time using [NestJS Devtools](https://devtools.nestjs.com).
- Need help with your project (part-time to full-time)? Check out our official [enterprise support](https://enterprise.nestjs.com).
- To stay in the loop and get updates, follow us on [X](https://x.com/nestframework) and [LinkedIn](https://linkedin.com/company/nestjs).
- Looking for a job, or have a job to offer? Check out our official [Jobs board](https://jobs.nestjs.com).

## Support

Nest is an MIT-licensed open source project. It can grow thanks to the sponsors and support by the amazing backers. If you'd like to join them, please [read more here](https://docs.nestjs.com/support).

## Stay in touch

- Author - [Kamil Myśliwiec](https://twitter.com/kammysliwiec)
- Website - [https://nestjs.com](https://nestjs.com/)
- Twitter - [@nestframework](https://twitter.com/nestframework)

## License

Nest is [MIT licensed](https://github.com/nestjs/nest/blob/master/LICENSE).
