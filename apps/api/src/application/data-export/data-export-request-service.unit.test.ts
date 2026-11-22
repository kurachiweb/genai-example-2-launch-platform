import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';
import { Container } from 'inversify';

import {
  DATA_EXPORT_GENERATE_MESSAGE,
  DATA_EXPORT_WATCHDOG_MESSAGE,
  GENERATION_WATCHDOG_DELAY_SECONDS,
} from '../../../lib/core/data-export/data-export-messages.ts';
import { DATA_EXPORT_PLATFORM_TYPES } from '../../../lib/core/data-export/identifiers.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../lib/core/identity/identifiers.ts';
import { DATA_EXPORT_TYPES } from './data-export-types.ts';
import {
  type DataExportRequestService,
  StoreDataExportRequestService,
} from './data-export-request-service.ts';
import {
  createAccountGuard,
  createLimits,
  createPublisher,
  createStore,
  currentUserOf,
  FIXED_CLOCK,
  FIXED_IDS,
  GENERATED_ID,
  NOW,
  type Published,
  SESSION,
  USER_ID,
} from './testing/data-export-request-fakes.ts';

interface Options {
  readonly guardError?: Error;
  readonly user?: ReturnType<typeof currentUserOf>;
  readonly limitsError?: Error;
  readonly failingTypes?: readonly string[];
  readonly removeError?: Error;
  readonly createError?: Error;
}

function setup(options: Options = {}) {
  const calls: string[] = [];
  const published: Published[] = [];
  const fakeStore = createStore(calls, {
    ...(options.removeError === undefined
      ? {}
      : { removeError: options.removeError }),
    ...(options.createError === undefined
      ? {}
      : { createError: options.createError }),
  });
  const container = new Container();
  container.bind(IDENTITY_PLATFORM_TYPES.AccountGuard).toConstantValue(
    createAccountGuard(calls, {
      ...(options.guardError === undefined
        ? {}
        : { error: options.guardError }),
      ...(options.user === undefined ? {} : { user: options.user }),
    }),
  );
  container
    .bind(DATA_EXPORT_PLATFORM_TYPES.DataExportStore)
    .toConstantValue(fakeStore.store);
  container
    .bind(DATA_EXPORT_TYPES.DataExportRequestLimits)
    .toConstantValue(createLimits(calls, options.limitsError));
  container
    .bind(PLATFORM_TYPES.MessagePublisher)
    .toConstantValue(
      createPublisher(calls, published, options.failingTypes ?? []),
    );
  container.bind(PLATFORM_TYPES.IdGenerator).toConstantValue(FIXED_IDS);
  container.bind(PLATFORM_TYPES.Clock).toConstantValue(FIXED_CLOCK);
  container
    .bind<DataExportRequestService>(DATA_EXPORT_TYPES.DataExportRequestService)
    .to(StoreDataExportRequestService);
  return {
    service: container.get<DataExportRequestService>(
      DATA_EXPORT_TYPES.DataExportRequestService,
    ),
    calls,
    published,
    fakeStore,
  };
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('例外が発生しませんでした。');
}

const records: LogRecord[] = [];

function logsOf(level: LogRecord['level']): Record<string, unknown>[] {
  return records
    .filter(
      (record) =>
        record.category.join('.') === 'api.application.data-export' &&
        record.level === level,
    )
    .map(({ properties }) => properties);
}

beforeEach(() => {
  records.length = 0;
  configureSync({
    reset: true,
    sinks: {
      capture: (record) => {
        records.push(record);
      },
    },
    loggers: [
      { category: ['api'], sinks: ['capture'], lowestLevel: 'debug' },
      { category: ['logtape', 'meta'], sinks: [], lowestLevel: 'warning' },
    ],
  });
});

afterEach(() => {
  resetSync();
});

describe('DataExportRequestService.request', () => {
  test('本人・確認・回数・記録・生成の依頼・見張りの依頼の順に進め、作成中の要求をダウンロードのパス無しで返す', async () => {
    const { service, calls, published, fakeStore } = setup();

    const view = await service.request(SESSION);

    expect(calls).toEqual([
      'guard.requireUser',
      `limits.consume:${USER_ID}`,
      'store.create',
      'publish:data-export.generate-archive',
      'publish:data-export.check-generation',
    ]);
    expect(fakeStore.created).toHaveLength(1);
    expect(fakeStore.created).toEqual([view.record]);
    expect(view.record.status).toBe('queued');
    expect(view.record.id).toBe(GENERATED_ID);
    expect(view.record.userId).toBe(USER_ID);
    expect(view.record.requestedAt).toEqual(NOW);
    expect(view.downloadPath).toBeNull();
    expect(published).toEqual([
      {
        type: DATA_EXPORT_GENERATE_MESSAGE.type,
        body: { exportId: GENERATED_ID },
        options: undefined,
      },
      {
        type: DATA_EXPORT_WATCHDOG_MESSAGE.type,
        body: { exportId: GENERATED_ID },
        options: { delaySeconds: 7200 },
      },
    ]);
    expect(GENERATION_WATCHDOG_DELAY_SECONDS).toBe(7200);
  });

  test('未ログインなど本人を確かめられない要求は、回数を数えず記録も依頼も作らずにそのままの例外で拒否する', async () => {
    const denial = new AppError({
      kind: 'unauthenticated',
      code: 'unauthenticated',
      message: 'ログインしてください。',
    });
    const { service, calls } = setup({ guardError: denial });

    const error = await rejectionOf(service.request(SESSION));

    expect(error).toBe(denial);
    expect(calls).toEqual(['guard.requireUser']);
  });

  test('メールアドレスが未確認の利用者を403のemail_not_verifiedで拒否し、回数を数えず記録も依頼も作らない', async () => {
    const { service, calls } = setup({
      user: currentUserOf({ emailVerifiedAt: null }),
    });

    const error = await rejectionOf(service.request(SESSION));

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).kind).toBe('forbidden');
    expect((error as AppError).code).toBe('email_not_verified');
    expect(calls).toEqual(['guard.requireUser']);
  });

  test('停止中の利用者の要求も、確認済みなら受け付ける', async () => {
    const { service, calls, published } = setup({
      user: currentUserOf({ status: 'suspended' }),
    });

    const view = await service.request(SESSION);

    expect(view.record.status).toBe('queued');
    expect(calls).toContain('store.create');
    expect(published).toHaveLength(2);
  });

  test('作成中の要求があっても新しい要求を受け付ける', async () => {
    const { service, fakeStore } = setup();

    await service.request(SESSION);
    await service.request(SESSION);

    expect(fakeStore.created).toHaveLength(2);
  });

  test('回数の上限を超えた429はそのまま伝え、記録も依頼も作らない', async () => {
    const exceeded = new AppError({
      kind: 'rate_limited',
      code: 'rate_limit_exceeded',
      message: '操作が集中しています。しばらく待ってから再度お試しください。',
      retryAfterSeconds: 3600,
    });
    const { service, calls } = setup({ limitsError: exceeded });

    const error = await rejectionOf(service.request(SESSION));

    expect(error).toBe(exceeded);
    expect((error as AppError).retryAfterSeconds).toBe(3600);
    expect(calls).toEqual(['guard.requireUser', `limits.consume:${USER_ID}`]);
  });

  test('回数を数えた後に記録を作れなければ、その例外のまま拒否し、依頼を送らず、回数は戻さない', async () => {
    const failure = new Error('記録の作成に失敗');
    const { service, calls, published } = setup({ createError: failure });

    const error = await rejectionOf(service.request(SESSION));

    expect(error).toBe(failure);
    expect(published).toEqual([]);
    expect(calls).toEqual([
      'guard.requireUser',
      `limits.consume:${USER_ID}`,
      'store.create',
    ]);
  });

  test('生成の依頼を送れなければ記録を消して503の利用できない旨を返し、見張りは送らず、回数は戻さない', async () => {
    const { service, calls, published, fakeStore } = setup({
      failingTypes: [DATA_EXPORT_GENERATE_MESSAGE.type],
    });

    const error = await rejectionOf(service.request(SESSION));

    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).kind).toBe('unavailable');
    expect((error as AppError).code).toBe('data_export_unavailable');
    expect(fakeStore.removed).toEqual([GENERATED_ID]);
    expect(published).toEqual([]);
    expect(calls).toEqual([
      'guard.requireUser',
      `limits.consume:${USER_ID}`,
      'store.create',
      'publish:data-export.generate-archive',
      `store.remove:${GENERATED_ID}`,
    ]);
    expect(logsOf('error').map(({ exportId }) => exportId)).toEqual([
      GENERATED_ID,
    ]);
  });

  test('生成の依頼の失敗の後に記録を消せなくても503を返し、残った記録を記録のIDつきのエラーのログに残す', async () => {
    const { service, fakeStore } = setup({
      failingTypes: [DATA_EXPORT_GENERATE_MESSAGE.type],
      removeError: new Error('D1に書けません'),
    });

    const error = await rejectionOf(service.request(SESSION));

    expect((error as AppError).code).toBe('data_export_unavailable');
    expect(fakeStore.removed).toEqual([GENERATED_ID]);
    expect(logsOf('error')).toHaveLength(2);
  });

  test('見張りの依頼を送れなくても要求を受け付け、警告のログだけを残す', async () => {
    const { service, published, fakeStore } = setup({
      failingTypes: [DATA_EXPORT_WATCHDOG_MESSAGE.type],
    });

    const view = await service.request(SESSION);

    expect(view.record.id).toBe(GENERATED_ID);
    expect(fakeStore.removed).toEqual([]);
    expect(published.map(({ type }) => type)).toEqual([
      DATA_EXPORT_GENERATE_MESSAGE.type,
    ]);
    expect(logsOf('warning').map(({ exportId }) => exportId)).toEqual([
      GENERATED_ID,
    ]);
  });
});
