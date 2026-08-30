import {
  Body,
  Controller,
  Get,
  HttpCode,
  InternalServerErrorException,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { KpisCapitalSeriesQueryDto } from './dto/kpis-capital-series-query.dto';
import { KpisSnapshotQueryDto } from './dto/kpis-snapshot-query.dto';
import { RunCapitalSnapshotDto } from './dto/run-capital-snapshot.dto';
import { KpisService } from './kpis.service';

@ApiTags('kpis')
@ApiSecurity('X-Store-Id')
@ApiHeader({
  name: 'X-Store-Id',
  description: 'Store UUID (must exist with BusinessSettings)',
  required: true,
})
@Controller('kpis')
export class KpisController {
  constructor(private readonly kpis: KpisService) {}

  @Get('snapshot')
  @ApiOkResponse({
    description:
      'KPIs: ganancia bruta/real, capital live, cashAvailable (hoy), deuda, stock',
  })
  async snapshot(@Req() req: Request, @Query() query: KpisSnapshotQueryDto) {
    const storeId = req.storeContext?.storeId;
    if (!storeId) {
      throw new InternalServerErrorException('Missing store context');
    }
    return this.kpis.snapshot(storeId, query);
  }

  @Get('capital-series')
  @ApiOkResponse({
    description:
      'Serie de fotos de patrimonio. Huecos = días sin foto. Lazy crea ayer si falta.',
  })
  async capitalSeries(
    @Req() req: Request,
    @Query() query: KpisCapitalSeriesQueryDto,
  ) {
    const storeId = req.storeContext?.storeId;
    if (!storeId) {
      throw new InternalServerErrorException('Missing store context');
    }
    return this.kpis.capitalSeries(storeId, query);
  }

  @Post('capital-snapshots/run')
  @HttpCode(200)
  @ApiBody({ type: RunCapitalSnapshotDto })
  @ApiOkResponse({
    description:
      'Upsert foto de un día (default ayer). Inventario/deuda = ahora. Idempotente.',
  })
  async runCapitalSnapshot(
    @Req() req: Request,
    @Body() dto: RunCapitalSnapshotDto = {},
  ) {
    const storeId = req.storeContext?.storeId;
    if (!storeId) {
      throw new InternalServerErrorException('Missing store context');
    }
    return this.kpis.runCapitalSnapshot(storeId, dto.date);
  }
}
