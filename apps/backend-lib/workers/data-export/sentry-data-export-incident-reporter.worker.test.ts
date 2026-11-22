import { resetSync } from '@logtape/logtape';
import type { CloudflareOptions } from '@sentry/cloudflare';
import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterAll, describe, expect, test } from 'vitest';

import type { DataExportIncident } from '../../core/data-export/ports.ts';
import { AppError } from '../../core/errors/app-error.ts';
import {
  ensureLoggingConfigured,
  type LoggingOptions,
} from '../logging/configure-logging.ts';
import {
  buildSentryOptions,
  withSentryForScheduledAndQueue,
} from '../observability/sentry.ts';
import { SentryDataExportIncidentReporter } from './sentry-data-export-incident-reporter.ts';
import { exportIdOf } from './testing/data-export-fixtures.ts';

interface SentItem {
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

interface LoggedObject {
  readonly level: string;
  readonly category: string;
  readonly message: string;
  readonly [property: string]: unknown;
}

const TEST_DSN = ['https://', 'publickey', '@', 'o0.sentry.example', '/1'].join(
  '',
);

const EXPORT_ID = exportIdOf(1);

const JOB = 'data-export.archive-expiry';

const EMAIL = 'exporter1@mail.example';

const FILE_NAME = 'launch-stadium-export-太郎.zip';

const OBJECT_KEY = 'data-exports/01JE0DXPT00000000000000001.zip';

const LEAKED_VALUES = [EMAIL, FILE_NAME, OBJECT_KEY];

function decodeBody(body: RequestInit['body']): string {
  if (typeof body === 'string') {
    return body;
  }
  if (body instanceof Uint8Array) {
    return new TextDecoder().decode(body);
  }
  throw new TypeError('想定外の送信本文の形式です');
}

// エンベロープは改行区切りのJSONで、先頭のヘッダーの後に項目のヘッダーと本体が交互に並ぶ
function parseEnvelope(text: string): SentItem[] {
  const [, ...lines] = text.split('\n').filter((line) => line !== '');
  const items: SentItem[] = [];
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const header = JSON.parse(lines[index] ?? '') as { type: string };
    const payload = JSON.parse(lines[index + 1] ?? '') as Record<
      string,
      unknown
    >;
    items.push({ type: header.type, payload });
  }
  return items;
}

// 実際の初期化(重複の除外と除去処理を含む)を通し、送信先だけを差し替えて計装した定期実行の中で報告する
async function reportWithSentry(
  incidents: readonly DataExportIncident[],
): Promise<Record<string, unknown>[]> {
  const items: SentItem[] = [];
  const recordingFetch = (_input: RequestInfo | URL, init?: RequestInit) => {
    items.push(...parseEnvelope(decodeBody(init?.body)));
    return Promise.resolve(new Response('{}', { status: 200 }));
  };
  const options = (): CloudflareOptions => ({
    ...buildSentryOptions({
      dsn: TEST_DSN,
      environment: 'test',
      tracesSampleRate: 0,
    }),
    cacheClient: false,
    transportOptions: { fetch: recordingFetch as typeof fetch },
  });
  const reporter = new SentryDataExportIncidentReporter('api');
  const handler = withSentryForScheduledAndQueue<typeof env>(options, {
    scheduled: () => {
      for (const incident of incidents) {
        reporter.report(incident);
      }
    },
  });
  const ctx = createExecutionContext();

  await handler.scheduled?.(createScheduledController(), env, ctx);
  await waitOnExecutionContext(ctx);

  return items
    .filter(({ type }) => type === 'event')
    .map(({ payload }) => payload);
}

async function reportOne(
  incident: DataExportIncident,
): Promise<Record<string, unknown>> {
  const events = await reportWithSentry([incident]);
  expect(events).toHaveLength(1);
  return events[0] ?? {};
}

function configureRecordingLogs(
  appName: LoggingOptions['appName'],
): LoggedObject[] {
  const logs: LoggedObject[] = [];
  const record = (logged: unknown) => {
    logs.push(logged as LoggedObject);
  };
  ensureLoggingConfigured({
    appName,
    level: 'debug',
    console: {
      trace: record,
      debug: record,
      info: record,
      warn: record,
      error: record,
    } as unknown as Console,
  });
  return logs;
}

afterAll(() => {
  resetSync();
});

describe('SentryDataExportIncidentReporter(エラートラッキング)', () => {
  test('AppError以外の元の例外で生成が失敗したとき、元の例外をerrorで要求のIDと試行の回数を添えて送る', async () => {
    const event = await reportOne({
      kind: 'generation-failed',
      exportId: EXPORT_ID,
      attempts: 3,
      error: new TypeError('生成の途中で想定外の失敗'),
    });

    expect(event).toMatchObject({ level: 'error' });
    expect(event.exception).toMatchObject({
      values: [expect.objectContaining({ type: 'TypeError' })],
    });
    expect(event.tags).toStrictEqual({
      data_export_incident: 'generation-failed',
    });
    expect(event.contexts).toMatchObject({
      data_export_incident: { export_id: EXPORT_ID, attempts: 3 },
    });
  });

  test('AppErrorで生成が失敗したとき、例外としては送らず、定型の通知でerrorとして送る', async () => {
    const event = await reportOne({
      kind: 'generation-failed',
      exportId: EXPORT_ID,
      attempts: 3,
      error: new AppError({
        kind: 'unavailable',
        code: 'archive_unavailable',
        message: 'ファイルの保存先が利用できません',
      }),
    });

    expect(event).toMatchObject({
      level: 'error',
      logentry: {
        message: 'データエクスポートの生成が再試行の上限まで失敗しました',
      },
      fingerprint: ['data-export', 'generation-failed'],
    });
    expect(event.exception).toBeUndefined();
    expect(event.tags).toStrictEqual({
      data_export_incident: 'generation-failed',
    });
    expect(event.contexts).toMatchObject({
      data_export_incident: { export_id: EXPORT_ID, attempts: 3 },
    });
  });

  test.each([['watchdog' as const], ['recovery' as const]])(
    '進まない要求の失敗の確定(%s)を、warningで要求のIDと確定した主体を添えて送る',
    async (by) => {
      const event = await reportOne({
        kind: 'generation-abandoned',
        exportId: EXPORT_ID,
        by,
      });

      expect(event).toMatchObject({
        level: 'warning',
        logentry: {
          message:
            '進んでいないデータエクスポートの要求を失敗として確定しました',
        },
        fingerprint: ['data-export', 'generation-abandoned'],
      });
      expect(event.tags).toStrictEqual({
        data_export_incident: 'generation-abandoned',
      });
      expect(event.contexts).toMatchObject({
        data_export_incident: { export_id: EXPORT_ID, by },
      });
    },
  );

  test('ファイルの削除の失敗を、errorでジョブのタグと失敗した件数を添えて送る', async () => {
    const event = await reportOne({
      kind: 'archive-deletion-failed',
      job: JOB,
      count: 4,
    });

    expect(event).toMatchObject({
      level: 'error',
      logentry: {
        message: '期限切れのデータエクスポートのファイルを削除できませんでした',
      },
      fingerprint: ['data-export', 'archive-deletion-failed'],
    });
    expect(event.tags).toStrictEqual({
      data_export_incident: 'archive-deletion-failed',
      job: JOB,
    });
    expect(event.contexts).toMatchObject({
      data_export_incident: { count: 4 },
    });
  });

  test('通知の送り直しの失敗を、errorで失敗した件数を添えて送る', async () => {
    const event = await reportOne({
      kind: 'notice-redispatch-failed',
      count: 2,
    });

    expect(event).toMatchObject({
      level: 'error',
      logentry: {
        message: 'データエクスポートの通知の送り直しに失敗したものがあります',
      },
      fingerprint: ['data-export', 'notice-redispatch-failed'],
    });
    expect(event.tags).toStrictEqual({
      data_export_incident: 'notice-redispatch-failed',
    });
    expect(event.contexts).toMatchObject({
      data_export_incident: { count: 2 },
    });
  });

  test('ファイルの無い完了の記録へのダウンロードを、warningで要求のIDを添えて送る', async () => {
    const event = await reportOne({
      kind: 'archive-missing',
      exportId: EXPORT_ID,
    });

    expect(event).toMatchObject({
      level: 'warning',
      logentry: {
        message: 'データエクスポートのファイルが保存先に見つかりませんでした',
      },
      fingerprint: ['data-export', 'archive-missing'],
    });
    expect(event.tags).toStrictEqual({
      data_export_incident: 'archive-missing',
    });
    expect(event.contexts).toMatchObject({
      data_export_incident: { export_id: EXPORT_ID },
    });
  });

  test.each(LEAKED_VALUES)(
    'IDやジョブの名前の形でない値(%s)は、タグとコンテキストに入れずunknownに置き換える',
    async (value) => {
      const events = await reportWithSentry([
        {
          kind: 'generation-failed',
          exportId: value,
          attempts: 3,
          error: new AppError({
            kind: 'unavailable',
            code: 'archive_unavailable',
            message: value,
          }),
        },
        { kind: 'generation-abandoned', exportId: value, by: 'watchdog' },
        { kind: 'archive-deletion-failed', job: value, count: 1 },
        { kind: 'archive-missing', exportId: value },
      ]);

      expect(events).toHaveLength(4);
      expect(events.map(({ tags }) => tags)).toStrictEqual([
        { data_export_incident: 'generation-failed' },
        { data_export_incident: 'generation-abandoned' },
        { data_export_incident: 'archive-deletion-failed', job: 'unknown' },
        { data_export_incident: 'archive-missing' },
      ]);
      expect(events[0]?.contexts).toMatchObject({
        data_export_incident: { export_id: 'unknown' },
      });
      expect(events[1]?.contexts).toMatchObject({
        data_export_incident: { export_id: 'unknown' },
      });
      expect(events[3]?.contexts).toMatchObject({
        data_export_incident: { export_id: 'unknown' },
      });
      expect(JSON.stringify(events)).not.toContain(value);
    },
  );

  test('同じ報告が続けて起きても、重複の除外で捨てずに毎回送る', async () => {
    const incident: DataExportIncident = {
      kind: 'notice-redispatch-failed',
      count: 1,
    };

    const events = await reportWithSentry([incident, incident, incident]);

    expect(events).toHaveLength(3);
  });
});

describe('SentryDataExportIncidentReporter(ログ)', () => {
  test('報告を、重大度に合わせたレベルで種類と識別子と件数だけを添えてアプリの名前のカテゴリに出す', () => {
    const logs = configureRecordingLogs('event');
    const reporter = new SentryDataExportIncidentReporter('event');

    reporter.report({
      kind: 'generation-failed',
      exportId: EXPORT_ID,
      attempts: 3,
      error: new TypeError('生成の途中で想定外の失敗'),
    });
    reporter.report({
      kind: 'generation-abandoned',
      exportId: EXPORT_ID,
      by: 'recovery',
    });
    reporter.report({ kind: 'archive-deletion-failed', job: JOB, count: 4 });
    reporter.report({ kind: 'notice-redispatch-failed', count: 2 });
    reporter.report({ kind: 'archive-missing', exportId: EXPORT_ID });

    expect(logs).toStrictEqual([
      expect.objectContaining({
        level: 'error',
        category: 'event.infrastructure.data-export',
        message: 'データエクスポートの生成が再試行の上限まで失敗しました',
        incident: 'generation-failed',
        exportId: EXPORT_ID,
        attempts: 3,
      }),
      expect.objectContaining({
        level: 'warning',
        category: 'event.infrastructure.data-export',
        incident: 'generation-abandoned',
        exportId: EXPORT_ID,
        by: 'recovery',
      }),
      expect.objectContaining({
        level: 'error',
        category: 'event.infrastructure.data-export',
        incident: 'archive-deletion-failed',
        job: JOB,
        count: 4,
      }),
      expect.objectContaining({
        level: 'error',
        category: 'event.infrastructure.data-export',
        incident: 'notice-redispatch-failed',
        count: 2,
      }),
      expect.objectContaining({
        level: 'warning',
        category: 'event.infrastructure.data-export',
        incident: 'archive-missing',
        exportId: EXPORT_ID,
      }),
    ]);
  });

  test('IDやジョブの名前の形でない値は、ログにも出さない', () => {
    const logs = configureRecordingLogs('api');
    const reporter = new SentryDataExportIncidentReporter('api');

    for (const value of LEAKED_VALUES) {
      reporter.report({
        kind: 'generation-abandoned',
        exportId: value,
        by: 'watchdog',
      });
      reporter.report({
        kind: 'archive-deletion-failed',
        job: value,
        count: 1,
      });
      reporter.report({ kind: 'archive-missing', exportId: value });
    }

    expect(logs).toHaveLength(LEAKED_VALUES.length * 3);
    for (const value of LEAKED_VALUES) {
      expect(JSON.stringify(logs)).not.toContain(value);
    }
  });
});
