import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
} from 'class-validator';
import { DashboardView, PosDeviceMode } from '@prisma/client';

export class PatchDashboardConfigDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  dashboardEnabled?: boolean;

  @ApiPropertyOptional({ enum: PosDeviceMode })
  @IsOptional()
  @IsEnum(PosDeviceMode)
  deviceMode?: PosDeviceMode;

  @ApiPropertyOptional({ enum: DashboardView })
  @IsOptional()
  @IsEnum(DashboardView)
  dashboardView?: DashboardView;

  @ApiPropertyOptional({
    description:
      'Si true, genera un nuevo token de acceso (solo se devuelve una vez en la respuesta).',
  })
  @IsOptional()
  @IsBoolean()
  regenerateToken?: boolean;
}
