import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { StoreOnboardingEnabledGuard } from '../../common/guards/store-onboarding-enabled.guard';
import { SkipStoreConfigured } from '../../common/metadata';
import { BusinessSettingsService } from './business-settings.service';
import { UpsertBusinessSettingsOnboardingDto } from './dto/upsert-business-settings-onboarding.dto';
import { UpsertStoreDto } from './dto/upsert-store.dto';
import { StoresService } from './stores.service';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertXStoreIdMatchesParam(req: Request, paramStoreId: string) {
  const raw = req.headers['x-store-id'];
  const trimmed = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  if (!trimmed) {
    throw new BadRequestException('Header X-Store-Id is required');
  }
  if (!UUID_RE.test(trimmed)) {
    throw new BadRequestException('X-Store-Id must be a valid UUID');
  }
  if (trimmed !== paramStoreId) {
    throw new BadRequestException(
      'X-Store-Id must match the store id in the URL',
    );
  }
}

@ApiTags('stores')
@ApiSecurity('X-Store-Id')
@Controller('stores')
export class StoresController {
  constructor(
    private readonly businessSettings: BusinessSettingsService,
    private readonly storesService: StoresService,
  ) {}

  @Put(':storeId')
  @SkipStoreConfigured()
  @UseGuards(StoreOnboardingEnabledGuard)
  @ApiOperation({
    summary: 'Onboarding: crear o actualizar tienda (UUID desde el cliente)',
    description:
      'Requiere `STORE_ONBOARDING_ENABLED=1` en el servidor. Cabecera `X-Store-Id` debe coincidir con `:storeId`.',
  })
  upsertStore(
    @Param('storeId', ParseUUIDPipe) storeId: string,
    @Body() dto: UpsertStoreDto,
    @Req() req: Request,
  ) {
    assertXStoreIdMatchesParam(req, storeId);
    return this.storesService.upsert(storeId, dto);
  }

  @Put(':storeId/business-settings')
  @SkipStoreConfigured()
  @UseGuards(StoreOnboardingEnabledGuard)
  @ApiOperation({
    summary: 'Onboarding: crear o actualizar BusinessSettings por códigos ISO',
    description:
      'La tienda debe existir (`PUT /stores/:storeId`). Respuesta igual que GET .../business-settings.',
  })
  upsertBusinessSettingsOnboarding(
    @Param('storeId', ParseUUIDPipe) storeId: string,
    @Body() dto: UpsertBusinessSettingsOnboardingDto,
    @Req() req: Request,
  ) {
    assertXStoreIdMatchesParam(req, storeId);
    return this.businessSettings.upsertByCurrencyCodes(
      storeId,
      dto.functionalCurrencyCode,
      dto.defaultSaleDocCurrencyCode,
    );
  }

  @Get(':storeId/business-settings')
  getBusinessSettings(@Param('storeId', ParseUUIDPipe) storeId: string) {
    return this.businessSettings.findByStoreId(storeId);
  }
}
