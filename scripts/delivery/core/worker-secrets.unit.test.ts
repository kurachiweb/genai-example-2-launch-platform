import { describe, expect, test } from 'bun:test';

import type { SecretEntry } from './secret-scope.ts';
import {
  OPTIONAL_WORKER_SECRETS,
  selectWorkerSecrets,
} from './worker-secrets.ts';

const SHARED: readonly SecretEntry[] = [
  { key: 'HASH_PEPPER', value: 'fake-shared-pepper' },
  { key: 'SENTRY_DSN', value: 'fake-shared-sentry-dsn' },
  { key: 'STRIPE_API_KEY', value: 'fake-shared-stripe-key' },
  { key: 'DISIFY_API_KEY', value: 'fake-shared-disify-key' },
  { key: 'UNDECLARED_SECRET', value: 'fake-undeclared-value' },
];

const PER_WORKER: readonly SecretEntry[] = [
  { key: 'SENTRY_DSN', value: 'fake-worker-sentry-dsn' },
  { key: 'STRIPE_API_KEY', value: 'fake-worker-stripe-key' },
];

describe('OPTIONAL_WORKER_SECRETS', () => {
  test('各specが宣言した任意のシークレットをWorkerごとに持つ', () => {
    expect(OPTIONAL_WORKER_SECRETS).toEqual({
      api: ['DISIFY_API_KEY'],
      event: [
        'EMAIL_SMOKE_TOKEN',
        'EMAIL_SMOKE_RECIPIENT',
        'MEDIA_SMOKE_TOKEN',
        'DISIFY_API_KEY',
      ],
      client: [],
      admin: [],
    });
  });
});

describe('selectWorkerSecrets', () => {
  test('宣言した必須と任意のキーだけを選び、宣言していないキーを渡さない', () => {
    const selection = selectWorkerSecrets({
      required: ['HASH_PEPPER', 'SENTRY_DSN'],
      optional: ['DISIFY_API_KEY'],
      shared: SHARED,
      perWorker: [],
    });

    expect(selection).toEqual({
      ok: true,
      secrets: {
        HASH_PEPPER: 'fake-shared-pepper',
        SENTRY_DSN: 'fake-shared-sentry-dsn',
        DISIFY_API_KEY: 'fake-shared-disify-key',
      },
    });
  });

  test('任意のキーは在る場合だけ渡し、無くても欠落にしない', () => {
    const selection = selectWorkerSecrets({
      required: ['HASH_PEPPER'],
      optional: ['EMAIL_SMOKE_TOKEN', 'DISIFY_API_KEY'],
      shared: SHARED,
      perWorker: [],
    });

    expect(selection).toEqual({
      ok: true,
      secrets: {
        HASH_PEPPER: 'fake-shared-pepper',
        DISIFY_API_KEY: 'fake-shared-disify-key',
      },
    });
  });

  test('必須のキーが欠けていれば、欠けたキーの名前だけを宣言の順に返し、値を返さない', () => {
    const selection = selectWorkerSecrets({
      required: [
        'TURNSTILE_SECRET_KEY',
        'HASH_PEPPER',
        'SENTRY_DSN',
        'MISSING_TOO',
      ],
      optional: ['DISIFY_API_KEY'],
      shared: SHARED,
      perWorker: [],
    });

    expect(selection).toEqual({
      ok: false,
      missing: ['TURNSTILE_SECRET_KEY', 'MISSING_TOO'],
    });
    const serialized = JSON.stringify(selection);
    for (const { value } of SHARED) expect(serialized).not.toContain(value);
  });

  test('同じキーはWorkerごとのフォルダの値を共通のフォルダの値より優先する', () => {
    const selection = selectWorkerSecrets({
      required: ['HASH_PEPPER', 'SENTRY_DSN'],
      optional: [],
      shared: SHARED,
      perWorker: PER_WORKER,
    });

    expect(selection).toEqual({
      ok: true,
      secrets: {
        HASH_PEPPER: 'fake-shared-pepper',
        SENTRY_DSN: 'fake-worker-sentry-dsn',
      },
    });
  });

  test('Workerごとに分けると定めたキーは、Workerごとのフォルダにあればその値を渡す', () => {
    const selection = selectWorkerSecrets({
      required: ['HASH_PEPPER', 'STRIPE_API_KEY'],
      optional: [],
      shared: SHARED,
      perWorker: PER_WORKER,
    });

    expect(selection).toEqual({
      ok: true,
      secrets: {
        HASH_PEPPER: 'fake-shared-pepper',
        STRIPE_API_KEY: 'fake-worker-stripe-key',
      },
    });
  });

  test('Workerごとに分けると定めた必須のキーが共通のフォルダにしか無ければ、欠落として返す', () => {
    const selection = selectWorkerSecrets({
      required: ['HASH_PEPPER', 'STRIPE_API_KEY'],
      optional: [],
      shared: SHARED,
      perWorker: [],
    });

    expect(selection).toEqual({ ok: false, missing: ['STRIPE_API_KEY'] });
  });

  test('Workerごとに分けると定めた任意のキーが共通のフォルダにしか無ければ、渡さない', () => {
    const selection = selectWorkerSecrets({
      required: ['HASH_PEPPER'],
      optional: ['STRIPE_API_KEY'],
      shared: SHARED,
      perWorker: [],
    });

    expect(selection).toEqual({
      ok: true,
      secrets: { HASH_PEPPER: 'fake-shared-pepper' },
    });
  });

  test('必須と任意の両方に宣言したキーや重複したキーは1つとして扱う', () => {
    const missing = selectWorkerSecrets({
      required: ['MISSING_KEY', 'MISSING_KEY'],
      optional: ['MISSING_KEY'],
      shared: SHARED,
      perWorker: [],
    });
    const present = selectWorkerSecrets({
      required: ['HASH_PEPPER', 'HASH_PEPPER'],
      optional: ['HASH_PEPPER'],
      shared: SHARED,
      perWorker: [],
    });

    expect(missing).toEqual({ ok: false, missing: ['MISSING_KEY'] });
    expect(present).toEqual({
      ok: true,
      secrets: { HASH_PEPPER: 'fake-shared-pepper' },
    });
  });
});
