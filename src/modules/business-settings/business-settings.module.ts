import { Module } from '@nestjs/common';
import { StoreOnboardingEnabledGuard } from '../../common/guards/store-onboarding-enabled.guard';
import { BusinessSettingsService } from './business-settings.service';
import { StoresController } from './stores.controller';
import { StoresService } from './stores.service';

@Module({
  controllers: [StoresController],
  providers: [
    BusinessSettingsService,
    StoresService,
    StoreOnboardingEnabledGuard,
  ],
  exports: [BusinessSettingsService],
})
export class BusinessSettingsModule {}
