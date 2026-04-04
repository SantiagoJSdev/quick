import { Module } from '@nestjs/common';
import { OutboxMongoWorker } from './outbox-mongo.worker';

@Module({
  providers: [OutboxMongoWorker],
})
export class OutboxModule {}
