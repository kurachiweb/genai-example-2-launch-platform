import type { CloudflareOptions } from '@sentry/cloudflare';
import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, test } from 'vitest';

import type { SearchIncident } from '../../application/search/ports.ts';
import {
  buildSentryOptions,
  withSentryForScheduledAndQueue,
} from '../../../lib/workers/observability/sentry.ts';
import { SentrySearchIncidentReporter } from './sentry-search-incident-reporter.ts';

interface SentItem {
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

const TEST_DSN = ['https://', 'publickey', '@', 'o0.sentry.example', '/1'].join(
  '',
);
const TARGET = 'fixture-product';
const SOURCE_TEXT = '非公開の製品の説明文';
const KEYWORDS = '秘密の キーワード';

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
function parseSentryEnvelope(text: string): SentItem[] {
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

// 実際の初期化(重複の除外と除去処理を含む)を通すため、計装した定期実行の中で通知する
async function reportWithSentry(
  incidents: readonly SearchIncident[],
): Promise<Record<string, unknown>[]> {
  const items: SentItem[] = [];
  const recordingFetch = (_input: RequestInfo | URL, init?: RequestInit) => {
    items.push(...parseSentryEnvelope(decodeBody(init?.body)));
    return Promise.resolve(new Response('{}', { status: 200 }));
  };
  const reporter = new SentrySearchIncidentReporter();
  const handler = withSentryForScheduledAndQueue<Env>(
    (): CloudflareOptions => ({
      ...buildSentryOptions({
        dsn: TEST_DSN,
        environment: 'test',
        tracesSampleRate: 0,
      }),
      cacheClient: false,
      transportOptions: { fetch: recordingFetch as typeof fetch },
    }),
    {
      scheduled: () => {
        for (const incident of incidents) {
          reporter.report(incident);
        }
      },
    },
  );
  const ctx = createExecutionContext();

  await handler.scheduled?.(createScheduledController(), env, ctx);
  await waitOnExecutionContext(ctx);

  return items
    .filter(({ type }) => type === 'event')
    .map(({ payload }) => payload);
}

async function reportOne(
  incident: SearchIncident,
): Promise<Record<string, unknown>> {
  const events = await reportWithSentry([incident]);
  expect(events).toHaveLength(1);
  return events[0] ?? {};
}

describe('SentrySearchIncidentReporter(未登録の検索対象)', () => {
  test('errorで、定型の文言と、種類と検索対象の指紋と、検索対象のタグを付けて送る', async () => {
    const event = await reportOne({
      kind: 'unregistered-target',
      target: TARGET,
    });

    expect(event).toMatchObject({
      level: 'error',
      logentry: { message: '検索対象が登録されていません' },
      fingerprint: ['search-unregistered-target', TARGET],
    });
    expect(event).not.toHaveProperty('message');
    expect(event.tags).toStrictEqual({ search_target: TARGET });
  });
});

describe('SentrySearchIncidentReporter(外部APIの設定の誤り)', () => {
  test('errorで、定型の文言と、種類と状態コードの指紋と、検索対象と状態コードのタグを付けて送る', async () => {
    const event = await reportOne({
      kind: 'extractor-misconfigured',
      target: TARGET,
      status: 403,
    });

    expect(event).toMatchObject({
      level: 'error',
      logentry: {
        message: 'キーワード抽出の外部APIの設定に誤りがあります',
      },
      fingerprint: ['search-extractor-misconfigured', '403'],
    });
    expect(event).not.toHaveProperty('message');
    expect(event.tags).toStrictEqual({ search_target: TARGET, status: '403' });
  });

  test('同じ設定の誤りが続けて起きても、重複の除外で捨てずに毎回送る', async () => {
    const incident: SearchIncident = {
      kind: 'extractor-misconfigured',
      target: TARGET,
      status: 401,
    };

    const events = await reportWithSentry([incident, incident]);

    expect(events.map(({ fingerprint }) => fingerprint)).toStrictEqual([
      ['search-extractor-misconfigured', '401'],
      ['search-extractor-misconfigured', '401'],
    ]);
  });
});

describe('SentrySearchIncidentReporter(送る値)', () => {
  test('検索対象の名前の形でない値はタグと指紋に入れず置き換え、本文とキーワードを送らない', async () => {
    const unsafeTarget = `${SOURCE_TEXT} ${KEYWORDS}`;

    const events = await reportWithSentry([
      { kind: 'unregistered-target', target: unsafeTarget },
      { kind: 'extractor-misconfigured', target: unsafeTarget, status: 400 },
    ]);

    expect(events).toHaveLength(2);
    expect(events.map(({ tags }) => tags)).toStrictEqual([
      { search_target: 'unknown' },
      { search_target: 'unknown', status: '400' },
    ]);
    expect(events.map(({ fingerprint }) => fingerprint)).toStrictEqual([
      ['search-unregistered-target', 'unknown'],
      ['search-extractor-misconfigured', '400'],
    ]);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(SOURCE_TEXT);
    expect(serialized).not.toContain('秘密の');
  });
});
