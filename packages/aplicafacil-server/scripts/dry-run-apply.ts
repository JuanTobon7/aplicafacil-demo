/**
 * Postulación real en DRY RUN de UNA vacante MATCHED: navegador, LinkedIn, LLM y MCP
 * reales, pero se detiene antes de pulsar "Enviar". No arranca la cola ni los crons
 * y NO cambia estados en la BD. Levanta el HTTP en :3000 (el MCP server lo consulta).
 *
 *   npx ts-node --transpile-only -r tsconfig-paths/register scripts/dry-run-apply.ts [jobId|urlFragment]
 */
import * as fs from 'fs';
import * as path from 'path';

// Variables del LLM desde mcp-server/.env, solo en memoria de este proceso.
const mcpEnv = fs.readFileSync(path.join(__dirname, '../../mcp-server/.env'), 'utf8');
for (const line of mcpEnv.split(/\r?\n/)) {
  const m = /^(LLM_PROVIDER|OPENROUTER_[A-Z_]+|OMNIROUTE_[A-Z_]+|OMNI_ROUTE_API_KEY)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
process.env.OMNIROUTE_API_KEY ??= process.env.OMNI_ROUTE_API_KEY;
process.env.AI_FORM_DRY_RUN = 'true';

import { Test } from '@nestjs/testing';
import { ConsoleLogger } from '@nestjs/common';
import { BrowserManager } from '../src/linkedin-automation/components/browser-manager/contract/browser.manager';
import { AppModule } from '../src/app.module';
import { ApplyJobProcessor } from '../src/linkedin-automation/worker/apply-job.processor';
import { JobWorkerAutomation } from '../src/linkedin-automation/worker/job.automation.worker';
import { JobAutomationHelperService } from '../src/linkedin-automation/service/job.automation.helper.service';
import { JobApplicationStatus } from '../src/jobs/enum/job-application-status';

(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(ApplyJobProcessor).useValue({})
    .overrideProvider(JobWorkerAutomation).useValue({})
    .setLogger(new ConsoleLogger())
    .compile();
  // HTTP real en :3000: el MCP server consulta aquí los datos del candidato.
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  await app.listen(3000);

  const scraping: any = moduleRef.get('ScrapingLinkldnService', { strict: false });
  const jobs: any = moduleRef.get('JobsService', { strict: false });
  const helper = moduleRef.get(JobAutomationHelperService, { strict: false });

  const wanted = process.argv[2];
  const matched = await jobs.getJobsByStatus(JobApplicationStatus.MATCHED);
  const job = wanted ? matched.find((j: any) => j.id === wanted || j.url?.includes(wanted)) : matched[0];
  if (!job) throw new Error('No MATCHED job found');
  console.log(`\n>>> DRY RUN on: ${job.title} (${job.url}) profileId=${job.profileId} personId=${job.personId}\n`);

  try {
    await scraping.openLinkdlnProfile(helper.getCredentialsLinkdln(), 'apply');
    await scraping.resolveFillFormAndApply(helper.toJobPosting(job));
    console.log('\n>>> RESULT: submitted (unexpected in dry run)');
  } catch (e: any) {
    console.log(`\n>>> RESULT: ${e.message}`);
    const page = await moduleRef.get(BrowserManager, { strict: false }).getPage('apply');
    await page.screenshot({ path: 'dry-run-fail.png' });
    const html = await page.evaluate(() => {
      const parts = [document.body.outerHTML];
      document.querySelectorAll('*').forEach((el) => {
        if (el.shadowRoot) parts.push(`<!-- SHADOW of ${el.tagName}#${el.id} -->${el.shadowRoot.innerHTML}`);
      });
      return parts.join('\n');
    });
    fs.writeFileSync('dry-run-fail.html', html);
    console.log('>>> saved dry-run-fail.png / dry-run-fail.html');
  } finally {
    await scraping.close();
    await app.close();
    process.exit(0);
  }
})().catch((e) => { console.error('>>> SCRIPT ERROR', e); process.exit(1); });
