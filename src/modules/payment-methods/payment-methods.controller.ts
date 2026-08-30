import {
  Body,
  Controller,
  Get,
  InternalServerErrorException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
import {
  CreatePaymentMethodDto,
  PatchPaymentMethodDto,
} from './dto/payment-method.dto';
import { PaymentMethodsService } from './payment-methods.service';

@ApiTags('payment-methods')
@ApiSecurity('X-Store-Id')
@ApiHeader({
  name: 'X-Store-Id',
  description: 'Store UUID (must exist with BusinessSettings)',
  required: true,
})
@Controller('payment-methods')
export class PaymentMethodsController {
  constructor(private readonly paymentMethods: PaymentMethodsService) {}

  @Get()
  @ApiOkResponse({ description: 'Métodos activos para cobro POS' })
  async listActive(@Req() req: Request) {
    const storeId = req.storeContext?.storeId;
    if (!storeId) {
      throw new InternalServerErrorException('Missing store context');
    }
    return this.paymentMethods.listActive(storeId);
  }

  @Get('admin')
  @ApiOkResponse({ description: 'Todos los métodos (incl. inactivos)' })
  async listAdmin(@Req() req: Request) {
    const storeId = req.storeContext?.storeId;
    if (!storeId) {
      throw new InternalServerErrorException('Missing store context');
    }
    return this.paymentMethods.listAdmin(storeId);
  }

  @Post()
  @ApiBody({ type: CreatePaymentMethodDto })
  @ApiOkResponse({ description: 'Crea método de pago' })
  async create(@Req() req: Request, @Body() dto: CreatePaymentMethodDto) {
    const storeId = req.storeContext?.storeId;
    if (!storeId) {
      throw new InternalServerErrorException('Missing store context');
    }
    return this.paymentMethods.create(storeId, dto);
  }

  @Patch(':id')
  @ApiBody({ type: PatchPaymentMethodDto })
  @ApiOkResponse({ description: 'Actualiza % / nombre / active' })
  async patch(
    @Req() req: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PatchPaymentMethodDto,
  ) {
    const storeId = req.storeContext?.storeId;
    if (!storeId) {
      throw new InternalServerErrorException('Missing store context');
    }
    return this.paymentMethods.patch(storeId, id, dto);
  }
}
