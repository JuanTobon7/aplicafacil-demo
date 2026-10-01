import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Cron, CronExpression } from '@nestjs/schedule';
import { ScrapingLinkldnService } from "../service/contract/scraping.linkldn.service";
import { JobPostingDto } from "src/jobs/dto/req/job..osting.dto";
import { LinkedInSearchParams } from "../dto/params.lindkln.search";
import { JobLifecycleService } from "src/jobs/service/impl/job.lifecycle.service";
import { JobIntakeService } from "../service/job.intake.service";
import { JobsService } from "src/jobs/service/contract/jobs.service";
import { JobApplicationStatus } from "src/jobs/enum/job-application-status";
import { JobAutomationHelperService } from "../service/job.automation.helper.service";
import { JobApplyerQueue } from "./job.applyer.queu";
import { QueuePoller } from "./queue.poller";

@Injectable()
export class JobWorkerAutomation implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(JobWorkerAutomation.name);
    params: LinkedInSearchParams;
    private readonly MAX_JOBS_TO_APPLY = 10;

    constructor(
        @Inject('ScrapingLinkldnService') 
        private readonly scrapingLinkldnService: ScrapingLinkldnService,
        @Inject('JobsService')
        private readonly jobsService: JobsService,
        private readonly helper: JobAutomationHelperService,
        private readonly jobApplyerQueue: JobApplyerQueue,
        private readonly queuePoller: QueuePoller,
        private readonly lifecycle: JobLifecycleService,
        private readonly intake: JobIntakeService,
    ) {
        this.params = new LinkedInSearchParams(
            '1_week', 
            'Colombia', 
            true,
        );
    }

    /**
     * Se ejecuta apenas el servidor arranca. Lo PRIMERO es aplicar a las
     * vacantes existentes: se recuperan las que quedaron a medias y se
     * reconstruye la cola desde la BD (la búsqueda espera a que se vacíe).
     */
    async onModuleInit(): Promise<void> {
        this.logger.log('Job automation starting on server startup...');
        try {
            await this.recoverInterruptedJobs();
            const pendingJobs = await this.jobsService.getJobsByStatus(JobApplicationStatus.MATCHED);
            const enqueued = await this.jobApplyerQueue.rebuild(
                this.helper.extractNumberOfJobsToApply(pendingJobs, this.MAX_JOBS_TO_APPLY),
            );
            this.logger.log(`Startup: ${enqueued} existing jobs queued to apply first.`);
        } catch (error) {
            this.logger.error(
                `Job automation on startup failed: ${error instanceof Error ? error.message : error}`,
            );
        }
    }

    /**
     * Cierra el navegador compartido al apagar el servidor.
     */
    async onModuleDestroy(): Promise<void> {
        this.logger.log('Closing shared LinkedIn browser...');
        await this.scrapingLinkldnService.close();
    }

    /**
     * Un reinicio a mitad de una postulación deja la vacante en APPLYING para
     * siempre (nadie la vuelve a reclamar). Al arrancar no hay nada aplicando,
     * así que se devuelven a MATCHED para reintentarlas.
     */
    private async recoverInterruptedJobs(): Promise<void> {
        const interrupted = await this.jobsService.getJobsByStatus(JobApplicationStatus.APPLYING);
        for (const job of interrupted) {
            await this.lifecycle.recover(job, 'Recuperada tras reinicio del servidor durante la postulación');
        }
        if (interrupted.length > 0) {
            this.logger.warn(`Recovered ${interrupted.length} jobs interrupted in APPLYING.`);
        }
    }

    /**
     * Búsqueda de vacantes. Antes de dejarlas para postular, la IA evalúa por
     * embeddings si valen la pena (DISCOVERED → MATCHED | SKIPPED).
     * Desactivada salvo JOB_SEARCH_ENABLED=true.
     */
    @Cron(CronExpression.EVERY_5_MINUTES)
    async startJobAutomation(){
        if (process.env.JOB_SEARCH_ENABLED !== 'true') return;

        // Primero se aplica a las vacantes existentes: la búsqueda solo corre
        // cuando la cola está vacía y el worker no está postulando.
        const pending = await this.jobApplyerQueue.getPendingCount();
        if (pending > 0 || this.queuePoller.isProcessing()) {
            this.logger.log(
                `Search skipped: applying to existing jobs first (${pending} queued${this.queuePoller.isProcessing() ? ', one in progress' : ''}).`,
            );
            return;
        }

        this.logger.log('Starting job automation process...');

        // Las que no se pudieron evaluar antes (p.ej. embeddings caídos)
        await this.intake.reevaluate();

        const userId = await this.helper.getAutomationUserId();

        const credentials = this.helper.getCredentialsLinkdln();

        try {
            await this.scrapingLinkldnService.openLinkdlnProfile(credentials, 'search');

            const searchJobs : JobPostingDto[] = await this.scrapingLinkldnService.getJobsToApply(this.params);
            await this.intake.intake(searchJobs, userId);
        } finally {
            // El cron terminó: cierra su pestaña (y el navegador si el worker no tiene la suya).
            await this.scrapingLinkldnService.releaseTab('search');
        }
    }

    @Cron(CronExpression.EVERY_5_MINUTES)
    async applyToPendingJobs() {
        const pendingJobs = await this.jobsService.getJobsByStatus(JobApplicationStatus.MATCHED);

        if(pendingJobs.length <= 0) {
            this.logger.debug('No pending jobs found to apply for.');
            return;
        }

        // No abre el navegador: el worker de la cola abre su propia pestaña
        // al tomar cada vacante y la cierra cuando la cola queda vacía.
        // Encolar las vacantes para que el procesador las aplique una a una
        await this.jobApplyerQueue.enqueueJobs(
            this.helper.extractNumberOfJobsToApply(pendingJobs, this.MAX_JOBS_TO_APPLY),
        );
    }
}