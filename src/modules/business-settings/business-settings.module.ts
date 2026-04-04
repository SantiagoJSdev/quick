import { Module } from '@nestjs/common';
import { BusinessSettingsService } from './business-settings.service';
import { StoresController } from './stores.controller';

@Module({
  controllers: [StoresController],
  providers: [BusinessSettingsService],
  exports: [BusinessSettingsService],
})
export class BusinessSettingsModule {}
