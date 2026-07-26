import { Module } from '@nestjs/common';
import { PosDeviceModule } from '../pos-device/pos-device.module';
import { CashSessionController } from './cash-session.controller';
import { CashSessionService } from './cash-session.service';

@Module({
  imports: [PosDeviceModule],
  controllers: [CashSessionController],
  providers: [CashSessionService],
  exports: [CashSessionService],
})
export class CashSessionModule {}
