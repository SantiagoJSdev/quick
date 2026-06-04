import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { DashboardDeviceController } from './dashboard-device.controller';
import { DeviceDashboardGuard } from './device-dashboard.guard';
import { ReportsController } from './reports.controller';
import { ReportsPaymentsService } from './reports-payments.service';
import { ReportsService } from './reports.service';

@Module({
  imports: [PrismaModule],
  controllers: [ReportsController, DashboardDeviceController],
  providers: [
    ReportsService,
    ReportsPaymentsService,
    DeviceDashboardGuard,
  ],
  exports: [ReportsService],
})
export class ReportsModule {}
