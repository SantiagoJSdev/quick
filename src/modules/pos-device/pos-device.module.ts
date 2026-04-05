import { Module } from '@nestjs/common';
import { PosDeviceService } from './pos-device.service';

@Module({
  providers: [PosDeviceService],
  exports: [PosDeviceService],
})
export class PosDeviceModule {}
