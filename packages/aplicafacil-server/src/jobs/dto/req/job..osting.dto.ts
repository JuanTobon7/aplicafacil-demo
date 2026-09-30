import { Type } from 'class-transformer';
import {
  IsDate,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

import { CompanyDto } from '../helpers/company.dto';
import { CompensationDto } from '../helpers/compensation.dto';
import { JobExtraInfoDto } from '../helpers/job.extrainfo.dto';
import { JobMetadataDto } from '../helpers/job.metadata.dto';
import { JobSourceDto } from '../helpers/job.source.dto';
import { LocationDto } from '../helpers/location.dto';
import { RequirementsDto } from '../helpers/requeriments.dto';

export class JobPostingDto {

  @ValidateNested()
  @Type(() => JobSourceDto)
  source!: JobSourceDto;

  @ValidateNested()
  @Type(() => JobExtraInfoDto)
  job!: JobExtraInfoDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CompanyDto)
  company?: CompanyDto;

  @ValidateNested()
  @Type(() => LocationDto)
  location!: LocationDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => CompensationDto)
  compensation?: CompensationDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => RequirementsDto)
  requirements?: RequirementsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => JobMetadataDto)
  metadata?: JobMetadataDto;

  @IsOptional()
  @IsString()
  rawContent?: string;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  extractedAt?: Date;

  /** Perfil del candidato que aplica (la IA lo consulta vía tools MCP). */
  @IsOptional()
  @IsString()
  profileId?: string;

  /** Persona que aplica (datos de contacto, vía tools MCP). */
  @IsOptional()
  @IsString()
  personId?: string;

  /** Ruta local del CV del candidato (para formularios que piden subirlo). */
  @IsOptional()
  @IsString()
  resumePath?: string;
}