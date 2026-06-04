import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { SkipStoreConfigured } from '../../common/metadata';
import { SalesReportQueryDto } from './dto/sales-report-query.dto';
import { DeviceDashboardGuard } from './device-dashboard.guard';
import { ReportsService } from './reports.service';

@ApiTags('dashboard')
@Controller('dashboard/device')
export class DashboardDeviceController {
  constructor(private readonly reports: ReportsService) {}

  @Get(':deviceId')
  @SkipStoreConfigured()
  @UseGuards(DeviceDashboardGuard)
  @ApiHeader({
    name: 'X-Device-Token',
    description: 'Token emitido al activar dashboard en el dispositivo',
    required: true,
  })
  @ApiOkResponse({
    description:
      'Resumen consolidado para pantalla kiosk (sin X-Store-Id; tienda inferida del dispositivo)',
  })
  async getDeviceDashboard(
    @Param('deviceId') deviceId: string,
    @Query() query: SalesReportQueryDto,
  ) {
    const q: SalesReportQueryDto = {
      ...query,
      preset: query.preset ?? 'today',
    };
    return this.reports.getDeviceDashboardPayload(deviceId, q);
  }
}
