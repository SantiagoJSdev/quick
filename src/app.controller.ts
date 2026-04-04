import { Controller, Get } from '@nestjs/common';
import { SkipStoreConfigured } from './common/metadata';
import { AppService } from './app.service';

@Controller()
@SkipStoreConfigured()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }
}
