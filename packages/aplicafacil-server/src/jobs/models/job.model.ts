import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { JobMetadata } from '@aplicafacil/core/domain';
import { JobApplicationStatus } from '../enum/job-application-status';
import { EmploymentType } from '../enum/employment.yype';
import { WorkplaceType } from '../enum/workplace.type';
import { SalaryPeriod } from '../enum/salary.period';

/**
 * Entidad que refleja la tabla `jobs` existente en la base de datos.
 *
 * La tabla fue creada por la migración AddJobsTable (aplicada en BD,
 * aunque el archivo ya no esté en el repo). Esta entidad la reutiliza
 * en lugar de duplicar el modelo en `jobs_applyments`.
 *
 * Cada fila pertenece a un usuario (personId) y opcionalmente a un perfil
 * (profileId), lo que da el contexto multi-usuario necesario.
 * El estado usa el enum `jobs_status_enum` existente en la BD.
 */
@Entity('jobs')
export class JobModel {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ length: 255 })
  title!: string;

  @Column({ length: 255, nullable: true })
  company?: string;

  @Column({ length: 255, nullable: true })
  location?: string;

  @Column({ type: 'text', nullable: true })
  description?: string;

  @Column({ type: 'text', nullable: true })
  url?: string;

  @Column({ length: 100, nullable: true })
  source?: string;

  @Column({ type: 'date', nullable: true })
  postedDate?: string;

  @Column({ type: 'enum', enum: EmploymentType, nullable: true })
  employmentType?: EmploymentType;

  @Column({ type: 'enum', enum: WorkplaceType, nullable: true })
  workplaceType?: WorkplaceType;

  @Column({ type: 'enum', enum: SalaryPeriod, nullable: true })
  salaryPeriod?: SalaryPeriod;

  @Column({ type: 'numeric', nullable: true })
  salaryMin?: string;

  @Column({ type: 'numeric', nullable: true })
  salaryMax?: string;

  @Column({ type: 'text', nullable: true })
  requirements?: string;

  @Column({ type: 'text', nullable: true })
  rawContent?: string;

  @Index('IDX_jobs_personId')
  @Column({ name: 'personId', type: 'uuid', nullable: true })
  personId?: string;

  @Index('IDX_jobs_profileId')
  @Column({ name: 'profileId', type: 'uuid', nullable: true })
  profileId?: string;

  @Index('IDX_jobs_status')
  @Column({
    type: 'enum',
    enum: JobApplicationStatus,
    default: JobApplicationStatus.DISCOVERED,
  })
  status!: JobApplicationStatus;

  @Column({ name: 'matchScore', type: 'int', nullable: true })
  matchScore?: number;

  @Column({ name: 'statusReason', type: 'text', nullable: true })
  statusReason?: string;

  @Column({ name: 'searchParams', type: 'jsonb', nullable: true })
  searchParams?: Record<string, unknown>;

  @Column({ name: 'applicationDetail', type: 'jsonb', nullable: true })
  applicationDetail?: Record<string, unknown>;

  @Column({ name: 'applyAttempts', type: 'int', default: 0 })
  applyAttempts!: number;

  @Index('IDX_jobs_coverageScore')
  @Column({ name: 'coverageScore', type: 'int', nullable: true })
  coverageScore?: number;

  /** Metadata del ciclo de vida: idioma, evaluación de fit e historial de estados. */
  @Column({ name: 'metadata', type: 'jsonb', nullable: true })
  metadata?: JobMetadata | null;

  @Index('IDX_jobs_appliedAt')
  @Column({ name: 'appliedAt', type: 'timestamp', nullable: true })
  appliedAt?: Date;

  @CreateDateColumn({ name: 'createdAt' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updatedAt' })
  updatedAt!: Date;
}