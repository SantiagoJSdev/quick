import {
  Body,
  Controller,
  InternalServerErrorException,
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
import { SyncPushDto } from './dto/sync-push.dto';
import { SyncPushResponseDto } from './dto/sync-push-response.dto';
import { SyncService } from './sync.service';

@ApiTags('sync')
@ApiSecurity('X-Store-Id')
@ApiHeader({
  name: 'X-Store-Id',
  description: 'Store UUID (must exist with BusinessSettings)',
  required: true,
})
@Controller('sync')
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Post('push')
  @ApiBody({ type: SyncPushDto })
  @ApiOkResponse({ type: SyncPushResponseDto })
  async push(@Req() req: Request, @Body() body: SyncPushDto) {
    const storeId = req.storeContext?.storeId;
    if (!storeId) {
      throw new InternalServerErrorException(
        'Store context missing (StoreConfiguredGuard should run first)',
      );
    }
    return this.syncService.push(body, storeId);
  }
}
