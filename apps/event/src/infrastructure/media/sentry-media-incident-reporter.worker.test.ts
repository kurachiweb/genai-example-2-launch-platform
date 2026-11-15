import type { CloudflareOptions } from '@sentry/cloudflare';
import {
  createExecutionContext,
  createScheduledController,
  waitOnExecutionContext,
} from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, test, vi } from 'vitest';

import type { MediaIncidentReporter } from '../../application/media/ports.ts';
import {
  buildSentryOptions,
  withSentryForScheduledAndQueue,
} from '../../../lib/workers/observability/sentry.ts';
import { RekognitionModerationProvider } from './rekognition-moderation-provider.ts';
import { SentryMediaIncidentReporter } from './sentry-media-incident-reporter.ts';

interface SentItem {
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

const TEST_DSN = ['https://', 'publickey', '@', 'o0.sentry.example', '/1'].join(
  '',
);
const FILE_ID = '01JC0000000000000000000000';
const OTHER_FILE_ID = '01JC0000000000000000000001';

// シークレット検出の誤検知を避けるため、資格情報の形をした値を直書きせずに組み立てる
const ACCESS_KEY_ID = ['sentry', 'rekognition', 'access', 'id'].join('-');
const SECRET_ACCESS_KEY = [
  'sentry',
  'rekognition',
  'secret',
  'must',
  'not',
  'leak',
].join('-');

function providerWith(
  respond: () => Promise<Response>,
): RekognitionModerationProvider {
  const fetcher = vi.fn(respond);
  return new RekognitionModerationProvider({
    accessKeyId: ACCESS_KEY_ID,
    secretAccessKey: SECRET_ACCESS_KEY,
    region: 'us-east-1',
    fetcher: fetcher as typeof fetcher & typeof fetch,
  });
}

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

interface CapturedSentry {
  readonly events: Record<string, unknown>[];
  readonly raw: string;
}

// 実際の初期化(重複の除外と除去処理を含む)を通すため、計装した定期実行の中で通知する
async function runWithSentry(
  run: (reporter: MediaIncidentReporter) => Promise<void> | void,
): Promise<CapturedSentry> {
  const items: SentItem[] = [];
  const bodies: string[] = [];
  const recordingFetch = (_input: RequestInfo | URL, init?: RequestInit) => {
    const text = decodeBody(init?.body);
    bodies.push(text);
    items.push(...parseSentryEnvelope(text));
    return Promise.resolve(new Response('{}', { status: 200 }));
  };
  const reporter = new SentryMediaIncidentReporter();
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
      scheduled: async () => {
        await run(reporter);
      },
    },
  );
  const ctx = createExecutionContext();

  await handler.scheduled?.(createScheduledController(), env, ctx);
  await waitOnExecutionContext(ctx);

  return {
    events: items
      .filter(({ type }) => type === 'event')
      .map(({ payload }) => payload),
    raw: bodies.join('\n'),
  };
}

async function reportOne(
  run: (reporter: MediaIncidentReporter) => void,
): Promise<Record<string, unknown>> {
  const { events } = await runWithSentry(run);
  expect(events).toHaveLength(1);
  return events[0] ?? {};
}

describe('SentryMediaIncidentReporter(未判定)', () => {
  test('warningで、定型の文言と、種類と理由の指紋と、ファイルの識別子と理由のタグを付けて送る', async () => {
    const event = await reportOne((reporter) => {
      reporter.undetermined(FILE_ID, 'throttled');
    });

    expect(event).toMatchObject({
      level: 'warning',
      logentry: { message: '画像を判定できず、未判定として記録しました' },
      fingerprint: ['media-moderation-undetermined', 'throttled'],
    });
    expect(event).not.toHaveProperty('message');
    expect(event.tags).toStrictEqual({
      media_file_id: FILE_ID,
      moderation_reason: 'throttled',
    });
  });

  test('別のファイルの同じ理由の未判定も、重複の除外で捨てずに1つの問題として送る', async () => {
    const { events } = await runWithSentry((reporter) => {
      reporter.undetermined(FILE_ID, 'timeout');
      reporter.undetermined(OTHER_FILE_ID, 'timeout');
    });

    expect(events.map(({ fingerprint }) => fingerprint)).toStrictEqual([
      ['media-moderation-undetermined', 'timeout'],
      ['media-moderation-undetermined', 'timeout'],
    ]);
    expect(events.map(({ tags }) => tags)).toStrictEqual([
      { media_file_id: FILE_ID, moderation_reason: 'timeout' },
      { media_file_id: OTHER_FILE_ID, moderation_reason: 'timeout' },
    ]);
  });
});

describe('SentryMediaIncidentReporter(判定サービスが受け付けない画像)', () => {
  test('warningで、定型の文言と、種類と理由の指紋と、ファイルの識別子と理由のタグを付けて送る', async () => {
    const event = await reportOne((reporter) => {
      reporter.rejectedByService(FILE_ID, 'too-large');
    });

    expect(event).toMatchObject({
      level: 'warning',
      logentry: { message: '判定サービスが画像を受け付けず、隔離しました' },
      fingerprint: ['media-moderation-rejected', 'too-large'],
    });
    expect(event).not.toHaveProperty('message');
    expect(event.tags).toStrictEqual({
      media_file_id: FILE_ID,
      moderation_reason: 'too-large',
    });
  });
});

describe('SentryMediaIncidentReporter(設定の誤り)', () => {
  test('errorで、定型の文言と、種類と理由の指紋と、理由のタグを付けて送る', async () => {
    const event = await reportOne((reporter) => {
      reporter.misconfigured('misconfigured');
    });

    expect(event).toMatchObject({
      level: 'error',
      logentry: { message: '判定サービスの設定に誤りがあります' },
      fingerprint: ['media-moderation-misconfigured', 'misconfigured'],
    });
    expect(event).not.toHaveProperty('message');
    expect(event.tags).toStrictEqual({ moderation_reason: 'misconfigured' });
  });

  test('同じ設定の誤りが続けて起きても、重複の除外で捨てずに毎回送る', async () => {
    const { events } = await runWithSentry((reporter) => {
      reporter.misconfigured('misconfigured');
      reporter.misconfigured('misconfigured');
    });

    expect(events).toHaveLength(2);
  });
});

describe('SentryMediaIncidentReporter(送る値)', () => {
  test('識別子の形でないファイルの識別子と、判定の結果の分類でない理由は、タグと指紋に入れず置き換える', async () => {
    const unsafe = 'avatar-of-someone@example.example.png';

    const { events, raw } = await runWithSentry((reporter) => {
      reporter.undetermined(unsafe, unsafe);
      reporter.rejectedByService(unsafe, unsafe);
      reporter.misconfigured(unsafe);
    });

    expect(events.map(({ tags }) => tags)).toStrictEqual([
      { media_file_id: 'unknown', moderation_reason: 'unknown' },
      { media_file_id: 'unknown', moderation_reason: 'unknown' },
      { moderation_reason: 'unknown' },
    ]);
    expect(events.map(({ fingerprint }) => fingerprint)).toStrictEqual([
      ['media-moderation-undetermined', 'unknown'],
      ['media-moderation-rejected', 'unknown'],
      ['media-moderation-misconfigured', 'unknown'],
    ]);
    expect(raw).not.toContain('avatar-of-someone');
  });

  test('判定サービスの資格情報を含む失敗で通知しても、送信の内容に資格情報が出ない', async () => {
    const provider = providerWith(() =>
      Promise.reject(new Error(`denied ${ACCESS_KEY_ID} ${SECRET_ACCESS_KEY}`)),
    );
    const deniedProvider = providerWith(() =>
      Promise.resolve(
        Response.json(
          {
            __type: 'UnrecognizedClientException',
            Message: `The security token ${ACCESS_KEY_ID} ${SECRET_ACCESS_KEY} is invalid.`,
          },
          { status: 400 },
        ),
      ),
    );
    const image = { bytes: Uint8Array.from([1, 2, 3]), format: 'png' } as const;

    const { events, raw } = await runWithSentry(async (reporter) => {
      const network = await provider.detect(image, 60);
      const denied = await deniedProvider.detect(image, 60);
      if (network.kind === 'transient') {
        reporter.undetermined(FILE_ID, network.reason);
      }
      if (denied.kind === 'transient') {
        reporter.undetermined(FILE_ID, denied.reason);
        reporter.misconfigured(denied.reason);
      }
    });

    expect(events).toHaveLength(3);
    expect(raw).not.toContain(ACCESS_KEY_ID);
    expect(raw).not.toContain(SECRET_ACCESS_KEY);
  });
});
