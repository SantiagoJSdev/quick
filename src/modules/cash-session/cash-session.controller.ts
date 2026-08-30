import {
  Body,
  Controller,
  Get,
  InternalServerErrorException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiQuery,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { CashSessionService } from './cash-session.service';
import {
  CloseCashSessionDto,
  OpenCashSessionDto,
} from './dto/cash-session.dto';

@ApiTags('cash-sessions')
@ApiSecurity('X-Store-Id')
@ApiHeader({
  name: 'X-Store-Id',
  description: 'Store UUID (must exist with BusinessSettings)',
  required: true,
})
@Controller('cash-sessions')
export class CashSessionController {
  constructor(private readonly cashSessions: CashSessionService) {}

  @Post()
  @ApiBody({ type: OpenCashSessionDto })
  @ApiOkResponse({ description: 'Abre turno (o devuelve el OPEN existente del device)' })
  async open(@Req() req: Request, @Body() dto: OpenCashSessionDto) {
    const storeId = req.storeContext?.storeId;
    if (!storeId) {
      throw new InternalServerErrorException('Missing store context');
    }
    return this.cashSessions.open(storeId, dto);
  }

  @Get('current')
  @ApiQuery({ name: 'deviceId', required: true })
  @ApiOkResponse({ description: 'Sesión OPEN actual del dispositivo' })
  async current(@Req() req: Request, @Query('deviceId') deviceId: string) {
    const storeId = req.storeContext?.storeId;
    if (!storeId) {
      throw new InternalServerErrorException('Missing store context');
    }
    return this.cashSessions.findCurrent(storeId, deviceId ?? '');
  }

  @Get(':id')
  @ApiOkResponse({ description: 'Detalle de sesión' })
  async getOne(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const storeId = req.storeContext?.storeId;
    if (!storeId) {
      throw new InternalServerErrorException('Missing store context');
    }
    return this.cashSessions.findOne(storeId, id);
  }

  @Get(':id/summary')
  @ApiOkResponse({
    description:
      'Resumen live (OPEN) o congelado (CLOSED): ventas, devoluciones, negativos, sync failed, pendientes',
  })
  async summary(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const storeId = req.storeContext?.storeId;
    if (!storeId) {
      throw new InternalServerErrorException('Missing store context');
    }
    return this.cashSessions.summary(storeId, id);
  }

  @Post(':id/close')
  @ApiBody({ type: CloseCashSessionDto })
  @ApiOkResponse({
    description:
      'Cierra el turno. Side-effect: upsert foto de patrimonio del día (capitalPhoto). Si el snapshot falla, el cierre igual queda CLOSED.',
  })
  async close(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseCashSessionDto,
  ) {
    const storeId = req.storeContext?.storeId;
    if (!storeId) {
      throw new InternalServerErrorException('Missing store context');
    }
    return this.cashSessions.close(storeId, id, dto);
  }
}
