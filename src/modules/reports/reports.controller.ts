import {
  Controller,
  Get,
  InternalServerErrorException,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiHeader,
  ApiOkResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { SalesReportQueryDto } from './dto/sales-report-query.dto';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiSecurity('X-Store-Id')
@ApiHeader({
  name: 'X-Store-Id',
  description: 'Store UUID (must exist with BusinessSettings)',
  required: true,
})
@Controller('reports/sales')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('summary')
  @ApiOkResponse({ description: 'KPIs de ventas, devoluciones y ticket promedio' })
  async summary(@Req() req: Request, @Query() query: SalesReportQueryDto) {
    const storeId = req.storeContext?.storeId;
    if (!storeId) {
      throw new InternalServerErrorException('Missing store context');
    }
    return this.reports.getSalesSummary(storeId, query);
  }

  @Get('timeseries')
  @ApiOkResponse({ description: 'Serie diaria de ventas y devoluciones' })
  async timeseries(@Req() req: Request, @Query() query: SalesReportQueryDto) {
    const storeId = req.storeContext?.storeId;
    if (!storeId) {
      throw new InternalServerErrorException('Missing store context');
    }
    return this.reports.getSalesTimeSeries(storeId, query);
  }

  @Get('payments')
  @ApiOkResponse({ description: 'Desglose por método de pago (moneda funcional)' })
  async payments(@Req() req: Request, @Query() query: SalesReportQueryDto) {
    const storeId = req.storeContext?.storeId;
    if (!storeId) {
      throw new InternalServerErrorException('Missing store context');
    }
    return this.reports.getSalesPayments(storeId, query);
  }

  @Get('by-device')
  @ApiOkResponse({ description: 'Métricas agrupadas por dispositivo POS' })
  async byDevice(@Req() req: Request, @Query() query: SalesReportQueryDto) {
    const storeId = req.storeContext?.storeId;
    if (!storeId) {
      throw new InternalServerErrorException('Missing store context');
    }
    return this.reports.getSalesByDevice(storeId, query);
  }
}
