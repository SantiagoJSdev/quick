import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { MongoClient } from 'mongodb';

@Injectable()
export class MongoService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MongoService.name);
  private client: MongoClient | null = null;

  async onModuleInit() {
    const uri = process.env.MONGODB_URI?.trim();
    if (!uri) {
      this.logger.warn(
        'MongoDB: MONGODB_URI not set — read model / projection disabled until configured',
      );
      return;
    }

    try {
      this.client = new MongoClient(uri);
      await this.client.connect();
      await this.client.db().admin().command({ ping: 1 });
      this.logger.log('MongoDB: connected (ping ok)');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`MongoDB: connection failed — ${message}`);
      if (this.client) {
        await this.client.close().catch(() => undefined);
        this.client = null;
      }
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }

  getClient(): MongoClient | null {
    return this.client;
  }
}
