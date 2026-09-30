import { Type } from 'class-transformer';
import {
  IsArray,
  IsOptional,
  IsString,
  IsUrl,
  ValidateNested,
} from 'class-validator';
import { JobMetadataDto } from '../helpers/job.metadata.dto';
import { FieldDto } from '../helpers/field.dto';
export class FillFormRequestDto {
 
  @IsUrl()
  url!: string;                 // URL de la vacante
 
  @IsString()
  title!: string;               // título del job (redundante con metadata pero viene en raíz)
 
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FieldDto)
  fields!: FieldDto[];          // ← campos del formulario
 
  @ValidateNested()
  @Type(() => JobMetadataDto)
  metadata!: JobMetadataDto;    // ← toda la info de la vacante

  @IsOptional()
  @IsString()
  profileId?: string;           // perfil del candidato (el LLM lo consulta vía tools MCP)

  @IsOptional()
  @IsString()
  personId?: string;            // datos personales del candidato (idem)
}