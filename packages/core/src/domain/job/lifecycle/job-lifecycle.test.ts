import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JobLifecycle } from './job-lifecycle.js';
import { JobFitEvaluation, JobStatus } from './job-metadata.js';
import { InvalidJobTransitionError } from './job-state.js';
import { detectLanguage } from './language-detector.js';

const fit = (score: number, threshold = 0.4): JobFitEvaluation => ({
  score,
  threshold,
  worthApplying: score >= threshold,
  model: 'test',
  profileId: 'p1',
  evaluatedAt: new Date().toISOString(),
});

test('vacante con buen fit: DISCOVERED → MATCHED → APPLYING → APPLIED', () => {
  const job = JobLifecycle.discover({ code: 'en', confidence: 0.9 });
  job.evaluate(fit(0.55));
  assert.equal(job.status, JobStatus.MATCHED);
  job.startApplying();
  job.applied('ok');
  assert.equal(job.status, JobStatus.APPLIED);
  assert.deepEqual(
    job.metadata.history.map((h) => h.to),
    ['DISCOVERED', 'MATCHED', 'APPLYING', 'APPLIED'],
  );
  assert.equal(job.metadata.fit?.score, 0.55);
  assert.equal(job.language, 'en');
});

test('vacante con fit bajo queda SKIPPED y no se puede postular', () => {
  const job = JobLifecycle.discover();
  job.evaluate(fit(0.2));
  assert.equal(job.status, JobStatus.SKIPPED);
  assert.throws(() => job.startApplying(), InvalidJobTransitionError);
});

test('re-evaluar una MATCHED antigua puede descartarla; una SKIPPED puede volver', () => {
  const matched = JobLifecycle.restore(JobStatus.MATCHED);
  matched.evaluate(fit(0.1));
  assert.equal(matched.status, JobStatus.SKIPPED);
  matched.evaluate(fit(0.6));
  assert.equal(matched.status, JobStatus.MATCHED);
});

test('APPLYING interrumpida se recupera a MATCHED; fallo → APPLICATION_FAILED', () => {
  const job = JobLifecycle.restore(JobStatus.APPLYING, { language: { code: 'es', confidence: 1 } });
  job.recover('reinicio');
  assert.equal(job.status, JobStatus.MATCHED);
  job.startApplying();
  job.failed('sin botón');
  assert.equal(job.status, JobStatus.APPLICATION_FAILED);
  assert.equal(job.language, 'es');
  assert.throws(() => job.evaluate(fit(0.9)), InvalidJobTransitionError);
});

test('si la evaluación falla, la vacante sigue DISCOVERED con el error anotado', () => {
  const job = JobLifecycle.discover();
  job.evaluationFailed('No credentials');
  assert.equal(job.status, JobStatus.DISCOVERED);
  assert.equal(job.metadata.evaluationError?.message, 'No credentials');
  job.evaluate(fit(0.5));
  assert.equal(job.metadata.evaluationError, undefined);
});

test('detectLanguage distingue español e inglés', () => {
  assert.equal(
    detectLanguage('Buscamos un desarrollador backend con experiencia en Java y Spring para nuestro equipo de trabajo').code,
    'es',
  );
  assert.equal(
    detectLanguage('We are looking for a backend developer with strong experience in Java and Spring to join our team').code,
    'en',
  );
  assert.equal(detectLanguage('Java Spring AWS').code, 'unknown');
});
