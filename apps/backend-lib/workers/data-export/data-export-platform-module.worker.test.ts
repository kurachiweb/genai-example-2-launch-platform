import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Hono } from 'hono';
import type { Container } from 'inversify';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  test,
} from 'vitest';

import type { AppModule } from '../../core/di/app-module.ts';
import type { InvocationScopeInfo } from '../../core/di/identifiers.ts';
import { DATA_EXPORT_PLATFORM_TYPES } from '../../core/data-export/identifiers.ts';
import type {
  DataExportIncidentReporter,
  DataExportNotifier,
  DataExportStore,
  DataExportTerminator,
} from '../../core/data-export/ports.ts';
import type { LogObject } from '../../core/logging/log-record.ts';
import { createInvocationContainer } from '../di/invocation-container.ts';
import { EMAIL_PLATFORM_MODULE } from '../email/email-platform-module.ts';
import type { PlatformHonoEnv } from '../http/hono-env.ts';
import { IDENTITY_PLATFORM_MODULE } from '../identity/identity-platform-module.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';
import {
  installRecordingSentry,
  recordLogs,
  resetObservability,
} from '../tournament/testing/observability-fixtures.ts';
import { createDataExportPlatformModule } from './data-export-platform-module.ts';
import {
  clearDataExportState,
  expiredColumnsOf,
  exportIdOf,
  insertUsers,
  minutesAfter,
  queuedRowOf,
  seed,
} from './testing/data-export-fixtures.ts';
import { DATA_EXPORT_IMPLEMENTATIONS } from './testing/data-export-platform-implementations.ts';

const EXPORT = 1;

const OWNER = 1;

function createContainer(
  options: {
    readonly kind?: InvocationScopeInfo['kind'];
    readonly appName?: LoggingOptions['appName'];
  } = {},
): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: options.kind ?? 'fetch',
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    [
      EMAIL_PLATFORM_MODULE,
      IDENTITY_PLATFORM_MODULE,
      createDataExportPlatformModule(options.appName ?? 'api'),
    ],
  );
}

let logs: LogObject[] = [];

beforeEach(async () => {
  logs = recordLogs();
  installRecordingSentry();
  await clearDataExportState();
  await insertUsers([OWNER]);
});

afterEach(() => {
  resetObservability();
});

describe('createDataExportPlatformModule', () => {
  test('両アプリのモジュールの一覧へ環境を指定した型のまま加えられ、経路を持たない', () => {
    const module = createDataExportPlatformModule('api');
    const modules: readonly AppModule<Hono<PlatformHonoEnv<typeof env>>>[] = [
      module,
      createDataExportPlatformModule('event'),
    ];

    expectTypeOf(modules).toEqualTypeOf<
      readonly AppModule<Hono<PlatformHonoEnv<typeof env>>>[]
    >();
    expect(module.name).toBe('data-export-platform');
    expect('routes' in module).toBe(false);
  });

  test('解決を確かめる識別子はDATA_EXPORT_PLATFORM_TYPESの全てである', () => {
    expect(
      DATA_EXPORT_IMPLEMENTATIONS.map(([name]) => name).toSorted(),
    ).toEqual(Object.keys(DATA_EXPORT_PLATFORM_TYPES).toSorted());
  });

  describe.each(['api', 'event'] as const)('アプリの名前が%s', (appName) => {
    test.each(
      (['fetch', 'queue', 'scheduled'] as const).flatMap((kind) =>
        DATA_EXPORT_IMPLEMENTATIONS.map(
          ([name, implementation]) => [kind, name, implementation] as const,
        ),
      ),
    )(
      '%sの処理単位のコンテナから%sを実装に解決する',
      (kind, name, implementation) => {
        expect(
          createContainer({ kind, appName }).get(
            DATA_EXPORT_PLATFORM_TYPES[name],
          ),
        ).toBeInstanceOf(implementation);
      },
    );

    test('通知・失敗の確定・エラートラッキングへの送信のログは、アプリの名前のカテゴリに出る', async () => {
      logs = recordLogs(appName);
      await seed([
        queuedRowOf(EXPORT, OWNER, {
          ...expiredColumnsOf(),
          noticeStatus: 'pending',
        }),
        queuedRowOf(2, OWNER, {
          status: 'generating',
          runToken: 'run-token-a',
          leaseExpiresAt: minutesAfter(30),
          attempts: 1,
          uploadId: 'upload-without-object',
          objectKey: 'data-exports/unknown.zip',
        }),
      ]);
      const container = createContainer({ appName });

      await container
        .get<DataExportNotifier>(DATA_EXPORT_PLATFORM_TYPES.DataExportNotifier)
        .notify(exportIdOf(EXPORT));
      await container
        .get<DataExportTerminator>(
          DATA_EXPORT_PLATFORM_TYPES.DataExportTerminator,
        )
        .fail({
          exportId: exportIdOf(2),
          kind: 'error',
          now: minutesAfter(60),
          notify: false,
        });
      container
        .get<DataExportIncidentReporter>(
          DATA_EXPORT_PLATFORM_TYPES.DataExportIncidentReporter,
        )
        .report({ kind: 'notice-redispatch-failed', count: 1 });

      expect(logs.length).toBeGreaterThanOrEqual(2);
      expect(new Set(logs.map(({ category }) => category))).toStrictEqual(
        new Set([`${appName}.infrastructure.data-export`]),
      );
    });
  });

  test('1つの処理単位では同じインスタンスを使い回し、処理単位をまたいで共有しない', () => {
    const first = createContainer();
    const second = createContainer();

    for (const [name] of DATA_EXPORT_IMPLEMENTATIONS) {
      expect(first.get(DATA_EXPORT_PLATFORM_TYPES[name])).toBe(
        first.get(DATA_EXPORT_PLATFORM_TYPES[name]),
      );
      expect(first.get(DATA_EXPORT_PLATFORM_TYPES[name])).not.toBe(
        second.get(DATA_EXPORT_PLATFORM_TYPES[name]),
      );
    }
  });

  test('要求の記録は処理単位のD1から読める', async () => {
    await seed([queuedRowOf(EXPORT, OWNER)]);

    const record = await createContainer()
      .get<DataExportStore>(DATA_EXPORT_PLATFORM_TYPES.DataExportStore)
      .find(exportIdOf(EXPORT));

    expect(record).toMatchObject({ id: exportIdOf(EXPORT), status: 'queued' });
  });
});
