/**
 * Evalúa por embeddings (fit vacante ↔ perfil) las vacantes ya guardadas.
 * Sirve para calibrar JOB_FIT_THRESHOLD y para limpiar el backlog antiguo.
 * No abre el navegador ni arranca la cola.
 *
 *   npx ts-node --transpile-only -r tsconfig-paths/register scripts/evaluate-jobs.ts [STATUS,...] [--apply]
 *
 * Sin --apply solo muestra score e idioma de cada vacante (no cambia la BD).
 * Con --apply guarda la evaluación y mueve cada vacante a MATCHED o SKIPPED.
 * STATUS por defecto: MATCHED,DISCOVERED.
 */
import { Test } from '@nestjs/testing';
import { ConsoleLogger } from '@nestjs/common';
import { EvaluateJobFitUseCase } from '@aplicafacil/core/application';
import { detectLanguage } from '@aplicafacil/core/domain';
import { AppModule } from '../src/app.module';
import { ApplyJobProcessor } from '../src/linkedin-automation/worker/apply-job.processor';
import { JobWorkerAutomation } from '../src/linkedin-automation/worker/job.automation.worker';
import { JobAutomationHelperService } from '../src/linkedin-automation/service/job.automation.helper.service';
import { JobIntakeService } from '../src/linkedin-automation/service/job.intake.service';
import { JobApplicationStatus } from '../src/jobs/enum/job-application-status';

(async () => {
  const apply = process.argv.includes('--apply');
  const statusArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const statuses = (statusArg ?? 'MATCHED,DISCOVERED').split(',') as JobApplicationStatus[];

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ApplyJobProcessor).useValue({})
    .overrideProvider(JobWorkerAutomation).useValue({})
    .setLogger(new ConsoleLogger({ logLevels: ['error', 'warn', 'log'] }))
    .compile();
  await moduleRef.init();

  try {
    if (apply) {
      const summary = await moduleRef.get(JobIntakeService, { strict: false }).reevaluate(statuses);
      console.log('\n>>> APPLIED', summary);
      return;
    }

    const jobs: any = moduleRef.get('JobsService', { strict: false });
    const helper = moduleRef.get(JobAutomationHelperService, { strict: false });
    const evaluate = moduleRef.get(EvaluateJobFitUseCase, { strict: false });

    const rows: Array<Record<string, unknown>> = [];
    for (const status of statuses) {
      for (const job of await jobs.getJobsByStatus(status)) {
        const profile = await helper.resolveProfile(job);
        const language = detectLanguage(`${job.title}\n${job.description ?? ''}`);
        const row: Record<string, unknown> = { status, lang: language.code, title: job.title.slice(0, 45) };
        try {
          if (!profile) throw new Error('sin perfil');
          const fit = await evaluate.execute({
            jobText: [job.title, job.company, job.location, job.description].filter(Boolean).join('\n'),
            profile: { id: profile.id, text: helper.profileFitText(profile) },
          });
          Object.assign(row, { score: fit.score, verdict: fit.worthApplying ? 'MATCHED' : 'SKIPPED' });
        } catch (e: any) {
          Object.assign(row, { score: null, verdict: `ERROR: ${e.message.slice(0, 70)}` });
        }
        rows.push(row);
      }
    }
    rows.sort((a, b) => Number(b.score ?? -1) - Number(a.score ?? -1));
    console.table(rows);
    console.log('>>> DRY: no se guardó nada. Usa --apply para persistir.');
  } finally {
    await moduleRef.close();
    process.exit(0);
  }
})().catch((e) => {
  console.error('>>> SCRIPT ERROR', e);
  process.exit(1);
});
