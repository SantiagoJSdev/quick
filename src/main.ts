import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/filters/api-exception.filter';
import { PrismaService } from './prisma/prisma.service';

function isProductionEnv(): boolean {
  return process.env.NODE_ENV === 'production';
}

function isSwaggerEnabled(): boolean {
  if (process.env.SWAGGER_ENABLED === '1') {
    return true;
  }
  if (process.env.SWAGGER_ENABLED === '0') {
    return false;
  }
  return !isProductionEnv();
}

function nestLoggerLevels(): ('error' | 'warn' | 'log' | 'debug' | 'verbose')[] {
  return isProductionEnv()
    ? ['error', 'warn', 'log']
    : ['error', 'warn', 'log', 'debug', 'verbose'];
}

function setupSwagger(app: Awaited<ReturnType<typeof NestFactory.create>>) {
  const swaggerConfig = new DocumentBuilder()
    .setTitle('Quick Market API')
    .setDescription(
      'Backend POS / mini-mercado: PostgreSQL como única fuente de verdad. Casi todos los endpoints requieren el header X-Store-Id; excepciones: GET /api/v1/ops/metrics (M5, OPS_API_KEY opcional) y, si STORE_ONBOARDING_ENABLED=1, PUT /api/v1/stores/:id y PUT .../business-settings para alta de tienda desde el POS. POST /api/v1/products-with-stock requiere además Idempotency-Key (UUID) para reintentos sin duplicar producto. POST /api/v1/sales soporta payments opcional para cobro mixto y sync/push SALE acepta payload.sale.payments.',
    )
    .setVersion('1.0')
    .addApiKey(
      { type: 'apiKey', name: 'X-Store-Id', in: 'header' },
      'X-Store-Id',
    )
    .addApiKey(
      {
        type: 'apiKey',
        name: 'X-Ops-Api-Key',
        in: 'header',
        description:
          'Solo para GET /api/v1/ops/metrics. Debe coincidir con OPS_API_KEY del servidor (si está definido).',
      },
      'X-Ops-Api-Key',
    )
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'token',
        description:
          'Alternativa a X-Ops-Api-Key: mismo valor que OPS_API_KEY (si está definido en el servidor).',
      },
      'ops-bearer',
    )
    .addApiKey(
      {
        type: 'apiKey',
        name: 'X-Request-Id',
        in: 'header',
        description:
          'Opcional. UUID de trazabilidad; si no se envía, el servidor genera uno y lo devuelve en cabecera y en errores JSON.',
      },
      'X-Request-Id',
    )
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    customSiteTitle: 'Quick Market API',
  });
}

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule, {
    logger: nestLoggerLevels(),
  });

  if (process.env.TRUST_PROXY === '1') {
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
  }
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ApiExceptionFilter());

  if (isSwaggerEnabled()) {
    setupSwagger(app);
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const prisma = app.get(PrismaService);
  await prisma.enableShutdownHooks(app);

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);

  const base = `http://127.0.0.1:${port}`;
  const docsHint = isSwaggerEnabled() ? ` | docs ${base}/api/docs` : '';
  logger.log(
    `[API_READY] Quick Market HTTP escuchando — base ${base} | API ${base}/api/v1${docsHint}`,
  );
}
bootstrap();
