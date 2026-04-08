import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  InternalServerErrorException,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiHeader,
  ApiOkResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { existsSync, mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { extname, join, resolve } from 'path';
import type { Request, Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { SkipStoreConfigured } from '../../common/metadata';
import { ProductsService, type ProductStoreContext } from './products.service';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB

class PatchProductImageDto {
  imageUrl!: string;
}

function storageRoot() {
  return resolve(process.cwd(), 'storage', 'products-images');
}

function extFromMimetype(mime: string): string {
  const m = mime.toLowerCase();
  if (m === 'image/jpeg' || m === 'image/jpg') return '.jpg';
  if (m === 'image/png') return '.png';
  if (m === 'image/webp') return '.webp';
  if (m === 'image/gif') return '.gif';
  return '';
}

@ApiTags('products')
@ApiSecurity('X-Store-Id')
@ApiHeader({
  name: 'X-Store-Id',
  description: 'Store UUID (must exist with BusinessSettings)',
  required: true,
})
@Controller()
export class ProductImagesController {
  constructor(private readonly productsService: ProductsService) {}

  private storeContext(req: Request): ProductStoreContext {
    const ctx = req.storeContext;
    if (!ctx) {
      throw new InternalServerErrorException('Missing store context');
    }
    return ctx;
  }

  @Post('uploads/products-image')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
      required: ['file'],
    },
  })
  @ApiOkResponse({
    description:
      'Upload de imagen de producto. Devuelve URL para consumir en card/form y luego vincular al producto.',
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (req, _file, cb) => {
          const storeId = (req as Request).storeContext?.storeId;
          if (!storeId) {
            cb(
              new InternalServerErrorException('Missing store context in upload'),
              '',
            );
            return;
          }
          const dir = join(storageRoot(), storeId);
          mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (_req, file, cb) => {
          const ext = extFromMimetype(file.mimetype) || extname(file.originalname);
          const safeExt = ext.length > 0 ? ext.toLowerCase() : '.bin';
          const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
          cb(null, `${id}${safeExt}`);
        },
      }),
      limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.toLowerCase().startsWith('image/')) {
          cb(new BadRequestException('Only image/* files are allowed'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  upload(
    @UploadedFile()
    file: {
      filename: string;
      mimetype: string;
      size: number;
    },
    @Req() req: Request,
  ) {
    const { storeId } = this.storeContext(req);
    if (!file) {
      throw new BadRequestException('Missing file');
    }
    const url = `/api/v1/uploads/products-image/${storeId}/${file.filename}`;
    return {
      fileId: file.filename,
      url,
      mimeType: file.mimetype,
      bytes: file.size,
    };
  }

  @SkipStoreConfigured()
  @Get('uploads/products-image/:storeId/:fileName')
  serve(
    @Param('storeId') storeId: string,
    @Param('fileName') fileName: string,
    @Res() res: Response,
  ) {
    if (!/^[a-zA-Z0-9-]+$/.test(storeId)) {
      throw new BadRequestException('Invalid storeId in image path');
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(fileName)) {
      throw new BadRequestException('Invalid fileName in image path');
    }
    const absolute = resolve(storageRoot(), storeId, fileName);
    const base = resolve(storageRoot(), storeId);
    if (!absolute.startsWith(base)) {
      throw new BadRequestException('Invalid image path');
    }
    if (!existsSync(absolute)) {
      throw new BadRequestException('Image not found');
    }
    res.sendFile(absolute);
  }

  @Patch('products/:id/image')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { imageUrl: { type: 'string', example: '/api/v1/uploads/products-image/<storeId>/<fileId>' } },
      required: ['imageUrl'],
    },
  })
  attach(
    @Param('id') id: string,
    @Body() body: PatchProductImageDto,
    @Req() req: Request,
  ) {
    if (!body?.imageUrl || typeof body.imageUrl !== 'string') {
      throw new BadRequestException('imageUrl is required');
    }
    return this.productsService.update(
      id,
      { image: body.imageUrl },
      this.storeContext(req),
    );
  }

  @Delete('products/:id/image')
  detach(@Param('id') id: string, @Req() req: Request) {
    return this.productsService.update(
      id,
      { image: null },
      this.storeContext(req),
    );
  }
}
