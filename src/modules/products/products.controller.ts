import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CreateProductDto } from './dto/create-product.dto';
import {
  ProductIdQueryDto,
  ProductsQueryDto,
} from './dto/products-query.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  create(@Body() dto: CreateProductDto) {
    return this.productsService.create(dto);
  }

  @Get()
  async findAll(
    @Query() query: ProductsQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const source = query.source ?? 'auto';
    const { data, readSource } = await this.productsService.findAllCatalog(
      query.includeInactive ?? false,
      source,
    );
    res.setHeader('X-Catalog-Source', readSource);
    return data;
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @Query() query: ProductIdQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const source = query.source ?? 'auto';
    const { data, readSource } = await this.productsService.findOneCatalog(
      id,
      source,
    );
    res.setHeader('X-Catalog-Source', readSource);
    return data;
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.productsService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.productsService.remove(id);
  }
}

