import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { BusinessSettingsService } from './business-settings.service';

@Controller('stores')
export class StoresController {
  constructor(private readonly businessSettings: BusinessSettingsService) {}

  @Get(':storeId/business-settings')
  getBusinessSettings(@Param('storeId', ParseUUIDPipe) storeId: string) {
    return this.businessSettings.findByStoreId(storeId);
  }
}
