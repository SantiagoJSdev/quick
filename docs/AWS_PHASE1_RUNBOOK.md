# Fase 1 — Runbook AWS (desde cero hasta producción)

Guía operativa paso a paso: **cuenta AWS → RDS → EC2 → deploy NestJS**.  
Checklist maestro: [`AWS_DEPLOY_READINESS.md`](./AWS_DEPLOY_READINESS.md) §9.

**Alcance:** solo Fase 1. **Imágenes S3 = Fase 2** (no empezar).  
**Rama deploy:** solo **`main`**.

---

## Estado actual del repo (ya hecho)

| Hecho | Pendiente |
|-------|-----------|
| Código P0 (logger, Swagger off, Prisma deps, shutdown hooks) | Infra AWS |
| `FEATURE_PRODUCT_IMAGES=0` en código + workflow | `.env` en EC2 |
| GitHub `ci.yml` + `deploy-phase1.yml` (gate `main`) | PM2, nginx, HTTPS |
| Ops scheduler WARN solo en dev | Smoke tests prod |

---

## Mapa de fases (orden)

```
A  Cuenta AWS + billing
B  GitHub (main protegida)
C  RDS PostgreSQL
D  EC2 + Security Groups
E  Bootstrap servidor (Node, PM2)
F  Deploy app + migrate
G  Smoke tests
H  P1 (HTTPS, Flutter, alarmas)
── estabilizar ──
Fase 2  Imágenes S3 (doc aparte)
```

---

## A — Cuenta AWS (día 0)

### A.1 Crear cuenta

- [ ] **AWS-1** Ir a [https://aws.amazon.com](https://aws.amazon.com) → Create Account
- [ ] **AWS-2** Email, contraseña, nombre cuenta (ej. `quickmarket-prod`)
- [ ] **AWS-3** Método de pago (tarjeta)
- [ ] **AWS-4** Plan **Free tier** / Basic support (suficiente Fase 1)

### A.2 Seguridad cuenta root

- [ ] **AWS-5** Activar **MFA** en usuario root (Console → IAM → root → MFA)
- [ ] **AWS-6** **No usar root** para trabajo diario — solo facturación/emergencias

### A.3 Usuario IAM administrador (consola)

- [ ] **AWS-7** IAM → Users → Create → `admin-quickmarket`
- [ ] **AWS-8** Attach policy: `AdministratorAccess` *(solo este usuario admin; la app EC2 usará role mínimo más adelante en Fase 2 S3)*
- [ ] **AWS-9** Crear **password consola** + activar **MFA** en este usuario
- [ ] **AWS-10** Cerrar sesión root; entrar siempre con `admin-quickmarket`

### A.4 Billing y alertas (anti-sorpresa)

- [ ] **AWS-11** Billing → **Budgets** → budget mensual ej. **USD 20–30** con alerta 80%
- [ ] **AWS-12** Billing → **Free Tier** revisar qué aplica (12 meses EC2/RDS limitado)
- [ ] **AWS-13** Elegir **región** y no cambiarla después sin plan:
  - Recomendado costo: **`us-east-1`** (N. Virginia)
  - Alternativa LATAM: **`sa-east-1`** (São Paulo, un poco más caro)

Anotar región elegida: `________________`

---

## B — GitHub y ramas (día 0–1)

### B.1 Política de ramas

| Rama | Uso |
|------|-----|
| `develop` | Integración interna; CI corre; **no deploy AWS** |
| `main` | **Única** rama que despliega a producción |

- [ ] **GIT-3** Settings → Branches → proteger `main`:
  - Require pull request before merging
  - Require status checks (`CI` / `build-and-test`)
- [ ] **GIT-6** Merge `develop` → `main` solo cuando release listo

### B.2 Secrets (cuando tengas EC2)

- [ ] **GIT-7** GitHub → Settings → Secrets → Actions:
  - `EC2_HOST` — IP o DNS público
  - `EC2_SSH_KEY` — private key PEM (o usar SSM más adelante)
  - *(Opcional)* `DATABASE_URL` solo si migrate desde CI — preferible migrate **desde EC2**

### B.3 Workflow deploy

- [ ] **GIT-4** Completar paso deploy en `.github/workflows/deploy-phase1.yml` (SSH o manual hasta entonces)

---

## C — RDS PostgreSQL (día 1)

### C.1 Crear instancia

Console → **RDS** → Create database:

| Campo | Valor Fase 1 |
|-------|----------------|
| Engine | **PostgreSQL 15** |
| Template | Free tier *(si aplica)* o Dev/Test |
| Instance | **db.t4g.micro** |
| Storage | 20 GB gp3 (default) |
| **Public access** | **No** |
| VPC | default VPC |
| DB name | `quickmarket` |
| Master username | `qmadmin` |
| Master password | *(generar fuerte, guardar en gestor)* |

- [ ] **RDS-1** Instancia creada
- [ ] **RDS-2** Anotar **endpoint**: `xxxxx.region.rds.amazonaws.com`

### C.2 Security group RDS

- [ ] **RDS-3** SG de RDS: inbound **5432** solo desde **SG de EC2** (lo creas en paso D)
- [ ] **RDS-4** Confirmar **Publicly accessible = No** (P0-11 / SEC-5)

### C.3 URL de conexión (para EC2)

```bash
DATABASE_URL="postgresql://qmadmin:PASSWORD@endpoint:5432/quickmarket?schema=public&sslmode=require"
```

- [ ] **RDS-5** Probar conexión **desde EC2** (no desde tu PC si RDS es privado)

---

## D — EC2 (día 1–2)

### D.1 Lanzar instancia

Console → **EC2** → Launch instance:

| Campo | Valor Fase 1 |
|-------|----------------|
| Name | `quickmarket-api` |
| AMI | **Ubuntu Server 22.04 LTS** ARM64 |
| Instance type | **t4g.micro** |
| Key pair | Crear nueva → descargar `.pem` |
| Storage | **8–16 GB gp3 EBS** |
| Auto-assign public IP | **Enable** (Fase 1 sin ALB) |

- [ ] **EC2-1** Instancia running
- [ ] **EC2-2** Elastic IP *(opcional pero recomendado)* → asociar a instancia (IP fija para POS)

### D.2 Security group EC2

| Type | Port | Source |
|------|------|--------|
| SSH | 22 | **Tu IP** `/32` solamente |
| HTTP | 80 | `0.0.0.0/0` *(P1 nginx)* |
| HTTPS | 443 | `0.0.0.0/0` *(P1)* |
| Custom TCP | 3000 | **Restringir** a tu IP en pruebas; luego solo localhost + nginx |

- [ ] **EC2-3** SG creado y asociado (P0-11 / SEC-4)
- [ ] **EC2-4** RDS SG permite 5432 **desde este SG** (P0-11)

### D.3 Conectar por SSH

```bash
ssh -i quickmarket.pem ubuntu@EC2_PUBLIC_IP
```

- [ ] **EC2-5** SSH OK

---

## E — Bootstrap servidor (día 2)

En la EC2 (Ubuntu ARM):

```bash
# Node 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git

# PM2
sudo npm install -g pm2

node -v   # v20.x
npm -v
```

- [ ] **EC2-6** Node 20 + git + PM2 instalados

### E.1 Clonar repo

```bash
sudo mkdir -p /opt/quickmarket
sudo chown ubuntu:ubuntu /opt/quickmarket
cd /opt/quickmarket
git clone https://github.com/TU_ORG/TU_REPO.git .
git checkout main
```

- [ ] **EC2-7** Repo en `/opt/quickmarket` rama `main`

---

## F — Deploy aplicación (día 2–3)

### F.1 Archivo `.env` producción (EC2)

```bash
nano /opt/quickmarket/.env
chmod 600 /opt/quickmarket/.env
```

Contenido mínimo:

```bash
NODE_ENV=production
PORT=3000

DATABASE_URL=postgresql://qmadmin:PASSWORD@RDS_ENDPOINT:5432/quickmarket?schema=public&sslmode=require

OPS_API_KEY=generar-secreto-largo-aleatorio
DASHBOARD_ADMIN_PIN=pin-solo-operadores
STORE_ONBOARDING_ENABLED=0
FEATURE_PRODUCT_IMAGES=0

TRUST_PROXY=1
OPS_SCHEDULER_ENABLED=1
OPS_SCHEDULER_INTERVAL_MS=300000
```

- [ ] **P0-1** `OPS_API_KEY`
- [ ] **P0-2** `DASHBOARD_ADMIN_PIN`
- [ ] **P0-3** `STORE_ONBOARDING_ENABLED=0`
- [ ] **P0-4** `NODE_ENV=production`
- [ ] **IMG-2** `FEATURE_PRODUCT_IMAGES=0`
- [ ] **SEC-9** `.env` permisos `600`

### F.2 Build y migraciones

```bash
cd /opt/quickmarket
npm ci
npx prisma generate
npm run build
npx prisma migrate deploy
npm run db:seed    # solo primera vez / entorno vacío
```

- [ ] **P0-7** / **DB-3** / **PROD-4** migrate deploy OK
- [ ] **P0-12** DB prod sin sync `failed` de prueba (o limpiar antes de seed)

### F.3 PM2

Crear `/opt/quickmarket/ecosystem.config.js`:

```javascript
module.exports = {
  apps: [
    {
      name: 'quickmarket-api',
      cwd: '/opt/quickmarket',
      script: 'dist/main.js',
      instances: 1,
      autorestart: true,
      max_memory_restart: '400M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
```

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # seguir instrucción sudo que imprime
```

- [ ] **P0-8** / **CPU-1** PM2 running + startup enabled

### F.4 Verificar API

```bash
curl http://127.0.0.1:3000/
curl -H "X-Ops-Api-Key: TU_KEY" http://127.0.0.1:3000/api/v1/ops/metrics
```

Desde tu PC (si puerto 3000 abierto temporalmente):

```bash
curl http://EC2_IP:3000/
```

- [ ] API responde
- [ ] `/api/docs` **no** responde (Swagger off)
- [ ] Upload imagen → **503** (IMG-4)

---

## G — Smoke tests (día 3)

Con Postman o Flutter apuntando a `http://EC2_IP:3000/api/v1`:

- [ ] **P1-7** `GET /` health
- [ ] **P1-7** Request con `X-Store-Id` → productos / sync
- [ ] **P1-7** `POST /sync/push` NOOP
- [ ] **P1-7** `GET /sync/pull?since=0&limit=10`
- [ ] **P1-7** Crear venta o producto de prueba
- [ ] **IMG-4** `POST /uploads/products-image` → 503

Anotar `storeId` de seed para POS: `________________`

---

## H — P1 primera semana (después del primer deploy)

| Orden | Tarea | Ref |
|-------|-------|-----|
| 1 | **HTTPS** — Caddy o nginx + Let's Encrypt (dominio) | P1-5, SEC-8 |
| 2 | Cerrar puerto **3000** público; solo 443 → proxy localhost:3000 | SEC-4 |
| 3 | CloudWatch log retention **3–7 días** | P1-1, L-3 |
| 4 | Alarmas CPU EC2 + espacio RDS | P1-8 |
| 5 | Flutter: sync incremental (FE-1..5) | P1-3 |
| 6 | Flutter: fix `supplier.phone` string | P1-4 |
| 7 | Flutter: **no** UI imágenes prod | IMG-3 |

---

## I — Costo orientativo Fase 1 (USD/mes)

| Recurso | Aprox. |
|---------|--------|
| EC2 t4g.micro | ~6–8 |
| RDS db.t4g.micro | ~12–15 |
| EBS 20 GB | ~2 |
| Elastic IP (asociada) | ~0 |
| Data transfer bajo | ~1–3 |
| **Total** | **~20–28/mes** |

Free tier puede reducir el primer año. Budget alert en paso A.4.

---

## J — Fase 2 (después — no empezar ahora)

Cuando Fase 1 estable (sync, ventas, HTTPS, POS en prod):

1. Abrir [`PRODUCT_IMAGES_S3_IMPLEMENTATION.md`](./PRODUCT_IMAGES_S3_IMPLEMENTATION.md)
2. Bucket S3 + IAM role EC2
3. `FEATURE_PRODUCT_IMAGES=1` + código S3
4. Flutter imágenes

---

## Checklist rápido “¿dónde voy?”

Marca la **primera casilla sin `[x]`** de arriba hacia abajo:

```
[ ] A  Cuenta AWS + MFA + budget
[ ] B  GitHub main protegida
[ ] C  RDS privado
[ ] D  EC2 + SG
[ ] E  Node + PM2 en servidor
[ ] F  .env prod + migrate + pm2 start
[ ] G  Smoke tests
[ ] H  HTTPS + Flutter P1
[ ] J  Fase 2 S3 (futuro)
```

---

## Próxima acción concreta (hoy)

Si **aún no tienes cuenta AWS** → empieza **A.1–A.4** (30–45 min).

Si **ya tienes cuenta** → salta a **C (RDS)** y **D (EC2)** en la misma sesión (1–2 h).

Cuando tengas **IP EC2 + endpoint RDS**, podemos armar el `.env` exacto y el `ecosystem.config.js` en el repo.

---

## Referencias

- [`AWS_DEPLOY_READINESS.md`](./AWS_DEPLOY_READINESS.md) — análisis y checklist P0/P1
- [`PRODUCT_IMAGES_S3_IMPLEMENTATION.md`](./PRODUCT_IMAGES_S3_IMPLEMENTATION.md) — Fase 2
- [`.github/workflows/deploy-phase1.yml`](../.github/workflows/deploy-phase1.yml)
