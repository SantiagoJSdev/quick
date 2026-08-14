import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { KpisController } from './kpis.controller';
import { KpisService } from './kpis.service';

@Module({
  imports: [PrismaModule],
  controllers: [KpisController],
  providers: [KpisService],
  exports: [KpisService],
})
export class KpisModule {}
