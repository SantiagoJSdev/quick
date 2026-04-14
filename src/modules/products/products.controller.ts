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
  Res,
} from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CreateProductDto } from './dto/create-product.dto';
import {
  ProductIdQueryDto,
  ProductsQueryDto,
} from './dto/products-query.dto';
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
  async findAll(
    @Query() query: ProductsQueryDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
  ) {
    const source = query.source ?? 'auto';
    const { data, readSource } = await this.productsService.findAllCatalog(
      query.includeInactive ?? false,
      source,
      this.storeContext(req),
    );
    res.setHeader('X-Catalog-Source', readSource);
    return data;
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Query() query: ProductIdQueryDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request,
  ) {
    const source = query.source ?? 'auto';
    const { data, readSource } = await this.productsService.findOneCatalog(
      id,
      source,
      this.storeContext(req),
    );
    res.setHeader('X-Catalog-Source', readSource);
    return data;
  }

  @Patch(':id')
  @ApiQuery({
    name: 'syncListPriceFromMargin',
    required: false,
    description:
      'Si es `1` o `true`, misma semántica que `applySuggestedListPrice: true` en el body (persistir `price` desde margen M7).',
  })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
    @Query('syncListPriceFromMargin') syncListPriceFromMargin: string | undefined,
    @Req() req: Request,
  ) {
    const fromQuery =
      syncListPriceFromMargin === '1' ||
      syncListPriceFromMargin === 'true';
    return this.productsService.update(id, dto, this.storeContext(req), {
      syncListPriceFromMargin: fromQuery,
    });
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: Request) {
    return this.productsService.remove(id, this.storeContext(req));
  }
}

