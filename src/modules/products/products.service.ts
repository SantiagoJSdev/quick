import {
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MongoService } from '../../mongo/mongo.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProductDto } from './dto/create-product.dto';
import type { ProductReadSource } from './dto/products-query.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { productSyncPullPayload } from './product-pull-payload';
import {
  buildProductOutboxPayload,
  productOutboxInclude,
} from './product-outbox.payload';
import {
  mongoProductReadToApiShape,
  type MongoProductReadDoc,
} from './products-read.mapper';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mongo: MongoService,
  ) {}

  async create(dto: CreateProductDto) {
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          ...dto,
          price: this.toDecimal(dto.price),
          cost: this.toDecimal(dto.cost),
        },
        include: productOutboxInclude,
      });

      await tx.outboxEvent.create({
        data: {
          aggregateType: 'Product',
          aggregateId: product.id,
          eventType: 'PRODUCT_CREATED',
          payload: buildProductOutboxPayload(product),
        },
      });

      await tx.serverChangeLog.create({
        data: {
          opType: 'PRODUCT_CREATED',
          payload: productSyncPullPayload(product) as Prisma.InputJsonValue,
          storeScopeId: null,
        },
      });

      return product;
    });
  }

  /**
   * Catalog list: Mongo `products_read` first when `source` is `auto` or `mongo`, else Postgres.
   * `auto` falls back to Postgres if Mongo is down or the query fails.
   */
  async findAllCatalog(
    includeInactive: boolean,
    source: ProductReadSource = 'auto',
  ): Promise<{ data: unknown[]; readSource: 'mongo' | 'postgres' }> {
    if (source === 'postgres') {
      return {
        data: await this.findAllPostgres(includeInactive),
        readSource: 'postgres',
      };
    }
    if (source === 'mongo') {
      return {
        data: await this.findAllMongoOrThrow(includeInactive),
        readSource: 'mongo',
      };
    }
    const client = this.mongo.getClient();
    if (!client) {
      return {
        data: await this.findAllPostgres(includeInactive),
        readSource: 'postgres',
      };
    }
    try {
      const data = await this.findAllMongo(includeInactive, client);
      return { data, readSource: 'mongo' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Catalog list: Mongo failed (${message}) — falling back to Postgres`,
      );
      return {
        data: await this.findAllPostgres(includeInactive),
        readSource: 'postgres',
      };
    }
  }

  /**
   * Single product: same resolution as list. In `auto`, if missing in Mongo, tries Postgres
   * (projection lag).
   */
  async findOneCatalog(
    id: string,
    source: ProductReadSource = 'auto',
  ): Promise<{ data: unknown; readSource: 'mongo' | 'postgres' }> {
    if (source === 'postgres') {
      return { data: await this.findOnePostgres(id), readSource: 'postgres' };
    }
    if (source === 'mongo') {
      const doc = await this.findOneMongoOrThrow(id);
      if (!doc) {
        throw new NotFoundException('Product not found');
      }
      return { data: mongoProductReadToApiShape(doc), readSource: 'mongo' };
    }
    const client = this.mongo.getClient();
    if (!client) {
      return { data: await this.findOnePostgres(id), readSource: 'postgres' };
    }
    try {
      const doc = await this.findOneMongo(id, client);
      if (doc) {
        return { data: mongoProductReadToApiShape(doc), readSource: 'mongo' };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Catalog get ${id}: Mongo failed (${message}) — falling back to Postgres`,
      );
    }
    return { data: await this.findOnePostgres(id), readSource: 'postgres' };
  }

  private dbName() {
    return process.env.MONGODB_DATABASE_NAME?.trim() || 'quickmarket';
  }

  private async findAllPostgres(includeInactive: boolean) {
    return this.prisma.product.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async findAllMongo(
    includeInactive: boolean,
    client: NonNullable<ReturnType<MongoService['getClient']>>,
  ) {
    const coll = client
      .db(this.dbName())
      .collection<MongoProductReadDoc>('products_read');
    const filter = includeInactive ? {} : { active: true };
    const docs = await coll
      .find(filter)
      .sort({ 'pg.updatedAt': -1 })
      .toArray();
    return docs.map((d) => mongoProductReadToApiShape(d));
  }

  private async findAllMongoOrThrow(includeInactive: boolean) {
    const client = this.mongo.getClient();
    if (!client) {
      throw new ServiceUnavailableException(
        'MongoDB read model is not configured or unavailable',
      );
    }
    return this.findAllMongo(includeInactive, client);
  }

  private async findOneMongo(
    id: string,
    client: NonNullable<ReturnType<MongoService['getClient']>>,
  ) {
    const coll = client
      .db(this.dbName())
      .collection<MongoProductReadDoc>('products_read');
    return coll.findOne({ _id: id });
  }

  private async findOneMongoOrThrow(id: string) {
    const client = this.mongo.getClient();
    if (!client) {
      throw new ServiceUnavailableException(
        'MongoDB read model is not configured or unavailable',
      );
    }
    return this.findOneMongo(id, client);
  }

  private async findOnePostgres(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return product;
  }

  async update(id: string, dto: UpdateProductDto) {
    await this.findOnePostgres(id);

    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.update({
        where: { id },
        data: {
          ...dto,
          price: this.toDecimal(dto.price),
          cost: this.toDecimal(dto.cost),
        },
        include: productOutboxInclude,
      });

      await tx.outboxEvent.create({
        data: {
          aggregateType: 'Product',
          aggregateId: product.id,
          eventType: 'PRODUCT_UPDATED',
          payload: buildProductOutboxPayload(product),
        },
      });

      await tx.serverChangeLog.create({
        data: {
          opType: 'PRODUCT_UPDATED',
          payload: productSyncPullPayload(product) as Prisma.InputJsonValue,
          storeScopeId: null,
        },
      });

      return product;
    });
  }

  async remove(id: string) {
    const existing = await this.findOnePostgres(id);
    if (!existing.active) {
      return existing;
    }

    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.update({
        where: { id },
        data: { active: false },
        include: productOutboxInclude,
      });

      await tx.outboxEvent.create({
        data: {
          aggregateType: 'Product',
          aggregateId: product.id,
          eventType: 'PRODUCT_DEACTIVATED',
          payload: buildProductOutboxPayload(product),
        },
      });

      await tx.serverChangeLog.create({
        data: {
          opType: 'PRODUCT_DEACTIVATED',
          payload: productSyncPullPayload(product) as Prisma.InputJsonValue,
          storeScopeId: null,
        },
      });

      return product;
    });
  }

  private toDecimal(value?: string) {
    if (value === undefined) {
      return undefined;
    }
    return new Prisma.Decimal(value);
  }
}
