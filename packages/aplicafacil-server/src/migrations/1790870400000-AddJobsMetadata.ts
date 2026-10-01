import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Agrega `metadata` (jsonb) a `jobs`: la metadata del ciclo de vida de la
 * vacante (idioma, evaluación de fit por embeddings, historial de estados).
 */
export class AddJobsMetadata1790870400000 implements MigrationInterface {
    name = 'AddJobsMetadata1790870400000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "metadata" jsonb`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "jobs" DROP COLUMN IF EXISTS "metadata"`);
    }

}
