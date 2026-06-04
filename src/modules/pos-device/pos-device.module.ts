import { Module } from '@nestjs/common';
import { DashboardAdminGuard } from './dashboard-admin.guard';
import { PosDeviceController } from './pos-device.controller';
import { PosDeviceDashboardService } from './pos-device-dashboard.service';
import { PosDeviceService } from './pos-device.service';

@Module({
  controllers: [PosDeviceController],
  providers: [PosDeviceService, PosDeviceDashboardService, DashboardAdminGuard],
  exports: [PosDeviceService, PosDeviceDashboardService],
})
export class PosDeviceModule {}
