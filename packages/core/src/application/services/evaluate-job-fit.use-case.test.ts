import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EvaluateJobFitUseCase, cosineSimilarity } from './evaluate-job-fit.use-case.js';
import { CachePort } from '../ports/cache.port.js';
import { EmbeddingPort } from '../ports/embedding.port.js';
import { LoggerPort } from '../ports/logger.port.js';

const silent: LoggerPort = { debug() {}, info() {}, warn() {}, error() {} };

class MemoryCache implements CachePort {
  readonly store = new Map<string, string>();
  async mget(keys: string[]) {
    return keys.map((k) => this.store.get(k) ?? null);
  }
  async set(key: string, value: string) {
    this.store.set(key, value);
  }
}

/** Embeddings de juguete: un eje por palabra clave. */
class KeywordEmbeddings implements EmbeddingPort {
  calls = 0;
  async getEmbedding(text: string): Promise<number[]> {
    this.calls++;
    const t = text.toLowerCase();
    return ['java', 'spring', 'backend', 'abogado', 'ventas'].map((k) => (t.includes(k) ? 1 : 0));
  }
}

test('cosineSimilarity', () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.throws(() => cosineSimilarity([1], [1, 2]));
});

test('vacante afín supera el umbral y la ajena no; el perfil se embebe una sola vez', async () => {
  const embeddings = new KeywordEmbeddings();
  const useCase = new EvaluateJobFitUseCase(embeddings, new MemoryCache(), silent, {
    threshold: 0.5,
    model: 'toy',
  });
  const profile = { id: 'p1', text: 'Backend developer Java Spring' };

  const good = await useCase.execute({ jobText: 'Desarrollador Java Spring backend', profile });
  const bad = await useCase.execute({ jobText: 'Abogado para área de ventas', profile });

  assert.equal(good.worthApplying, true);
  assert.equal(good.score, 1);
  assert.equal(bad.worthApplying, false);
  assert.equal(bad.score, 0);
  // 1 perfil (cacheado) + 2 vacantes
  assert.equal(embeddings.calls, 3);
});
