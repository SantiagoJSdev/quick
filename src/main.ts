import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/filters/api-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new ApiExceptionFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Quick Market API')
    .setDescription(
      'Backend POS / mini-mercado: PostgreSQL como fuente de verdad, Mongo opcional para read models (catálogo, FX). Casi todos los endpoints requieren el header X-Store-Id; excepción: GET /api/v1/ops/metrics (observabilidad M5).',
    )
    .setVersion('1.0')
    .addApiKey(
      { type: 'apiKey', name: 'X-Store-Id', in: 'header' },
      'X-Store-Id',
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

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
