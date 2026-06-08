import {
  Body,
  Controller,
  Delete,
  Get,
  InternalServerErrorException,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import type { Request } from 'express';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductsQueryDto } from './dto/products-query.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import {
  type ProductStoreContext,
  ProductsService,
} from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  private storeContext(req: Request): ProductStoreContext {
    const ctx = req.storeContext;
    if (!ctx) {
      throw new InternalServerErrorException('Missing store context');
    }
    return ctx;
  }

  @Post()
  create(@Body() dto: CreateProductDto, @Req() req: Request) {
    return this.productsService.create(dto, this.storeContext(req));
  }

  @Get()
  findAll(@Query() query: ProductsQueryDto, @Req() req: Request) {
    return this.productsService.findAllCatalog(
      query.includeInactive ?? false,
      this.storeContext(req),
    );
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: Request) {
    return this.productsService.findOneCatalog(id, this.storeContext(req));
  }

  @Patch(':id')
  @ApiQuery({
    name: 'syncListPriceFromMargin',
    required: false,
    description:
      'Si true y el producto usa margen, recalcula price desde cost + margen efectivo',
  })
  @ApiQuery({
    name: 'applySuggestedListPrice',
    required: false,
    description:
      'Alias de syncListPriceFromMargin (misma semántica en PATCH)',
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
    @Req() req: Request,
  ) {
    return this.productsService.update(id, dto, this.storeContext(req));
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: Request) {
    return this.productsService.remove(id, this.storeContext(req));
  }
}
