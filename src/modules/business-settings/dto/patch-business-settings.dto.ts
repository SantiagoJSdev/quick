import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumberString, IsOptional, MaxLength } from 'class-validator';

export class PatchBusinessSettingsDto {
  @ApiPropertyOptional({
    example: '15',
    description:
      'Margen por defecto de la tienda en porcentaje (ej. "15" = 15%). Rango 0–999. Enviar null vía JSON `null` no está soportado en este DTO; use PATCH con valor explícito. Para quitar margen: documentar en siguiente iteración o usar valor "0".',
  })
  @IsOptional()
  @IsNumberString()
  @MaxLength(20)
  defaultMarginPercent?: string;
}
