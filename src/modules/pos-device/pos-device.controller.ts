import {
  Body,
  Controller,
  Get,
  InternalServerErrorException,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiHeader,
  ApiOkResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { DashboardAdminGuard } from './dashboard-admin.guard';
import { PatchDashboardConfigDto } from './dto/patch-dashboard-config.dto';
import { PosDeviceDashboardService } from './pos-device-dashboard.service';

@ApiTags('pos-devices')
@ApiSecurity('X-Store-Id')
@ApiHeader({
  name: 'X-Store-Id',
  description: 'Store UUID (must exist with BusinessSettings)',
  required: true,
})
@Controller('pos-devices')
export class PosDeviceController {
  constructor(private readonly dashboard: PosDeviceDashboardService) {}

  @Get(':deviceId/dashboard-config')
  @ApiOkResponse({ description: 'Configuración dashboard del dispositivo' })
  async getDashboardConfig(
    @Req() req: Request,
    @Param('deviceId') deviceId: string,
  ) {
    const storeId = req.storeContext?.storeId;
    if (!storeId) {
      throw new InternalServerErrorException('Missing store context');
    }
    return this.dashboard.getConfig(storeId, deviceId);
  }

  @Patch(':deviceId/dashboard-config')
  @UseGuards(DashboardAdminGuard)
  @ApiHeader({
    name: 'X-Dashboard-Admin-Pin',
    description:
      'PIN de administración (DASHBOARD_ADMIN_PIN). Alternativa: X-Ops-Api-Key si OPS_API_KEY está definido.',
    required: false,
  })
  @ApiOkResponse({
    description:
      'Actualiza modo dashboard. Si se genera token, campo `dashboardAccessToken` solo en esta respuesta.',
  })
  async patchDashboardConfig(
    @Req() req: Request,
    @Param('deviceId') deviceId: string,
    @Body() dto: PatchDashboardConfigDto,
  ) {
    const storeId = req.storeContext?.storeId;
    if (!storeId) {
      throw new InternalServerErrorException('Missing store context');
    }
    return this.dashboard.patchConfig(storeId, deviceId, dto);
  }
}
