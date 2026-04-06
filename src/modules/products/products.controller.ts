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

