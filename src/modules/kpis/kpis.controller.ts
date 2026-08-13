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
import { KpisSnapshotQueryDto } from './dto/kpis-snapshot-query.dto';
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
      'KPIs diarios: ganancia bruta + margen (rango), deuda abierta por día de vencimiento, stock bajo/negativo',
  })
  async snapshot(@Req() req: Request, @Query() query: KpisSnapshotQueryDto) {
    const storeId = req.storeContext?.storeId;
    if (!storeId) {
      throw new InternalServerErrorException('Missing store context');
    }
    return this.kpis.snapshot(storeId, query);
  }
}
