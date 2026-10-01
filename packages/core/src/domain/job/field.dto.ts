import { FieldOptionDto } from './field.option.dto.js';

export class FieldDto {
  label!: string;
  description?: string;
  name!: string;                // el name del input en el DOM (lo necesita la extensión para inyectar)
  type!: string;                // 'text' | 'select' | 'textarea' | 'tel' | etc.
  required!: boolean;
  placeholder?: string;
  fieldType?: string;           // 'UNKNOWN' | otros valores de LinkedIn
  options?: FieldOptionDto[];   // solo en selects
  maxLength?: number;           // límite de caracteres (maxlength o texto de ayuda "0 de 20 caracteres")
  numeric?: boolean;            // el campo solo acepta números
  currentValue?: string;        // valor ya escrito que tiene error y hay que reemplazar
  error?: string;               // mensaje de validación del campo
}