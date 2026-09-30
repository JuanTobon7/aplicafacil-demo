import { FieldDto } from './field.dto.js';
import { JobMetadataDto } from './job.metadata.dto.js';

export class FillFormRequestDto {
  url!: string;                 // URL de la vacante
  title!: string;               // título del job (redundante con metadata pero viene en raíz)
  fields!: FieldDto[];          // ← campos del formulario
  metadata!: JobMetadataDto;    // ← toda la info de la vacante
  profileId?: string;           // perfil del candidato (el LLM lo consulta vía tools)
  personId?: string;            // datos personales del candidato (idem)
}