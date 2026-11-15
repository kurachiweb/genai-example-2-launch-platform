import type { CloudflareOptions } from '@sentry/cloudflare';

import { ensureLoggingConfigured } from '../../lib/workers/logging/configure-logging.ts';
import {
  buildSentryOptions,
  type SentryEnv,
  type SentryOptionsFactory,
} from '../../lib/workers/observability/sentry.ts';

type ConsoleMethod = 'trace' | 'debug' | 'info' | 'warn' | 'error';

export interface LoggedObject {
  readonly level: string;
  readonly category: string;
  readonly message: string;
  readonly [property: string]: unknown;
}

export interface SentItem {
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

export interface RecordingFetch {
  readonly fetch: typeof fetch;
  readonly items: SentItem[];
}

export interface RecordingSentryOptions {
  readonly tracesSampleRate: number;
}

const TEST_DSN = ['https://', 'publickey', '@', 'o0.sentry.example', '/1'].join(
  '',
);

export function configureRecordingLogs(): LoggedObject[] {
  const logs: LoggedObject[] = [];
  const record = (...args: unknown[]) => {
    logs.push(args[0] as LoggedObject);
  };
  const methods: Record<ConsoleMethod, typeof record> = {
    trace: record,
    debug: record,
    info: record,
    warn: record,
    error: record,
  };
  ensureLoggingConfigured({
    appName: 'api',
    level: 'debug',
    console: methods as unknown as Console,
  });
  return logs;
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

export function createRecordingFetch(): RecordingFetch {
  const items: SentItem[] = [];
  const recordingFetch = (_input: RequestInfo | URL, init?: RequestInit) => {
    items.push(...parseEnvelope(decodeBody(init?.body)));
    return Promise.resolve(new Response('{}', { status: 200 }));
  };
  return { fetch: recordingFetch as typeof fetch, items };
}

// 送信前の除去処理を含む実際の初期化のオプションに、送信先の差し替えだけを加える
export function recordingSentryOptions(
  recording: RecordingFetch,
  options: RecordingSentryOptions,
): SentryOptionsFactory<SentryEnv> {
  return (): CloudflareOptions => ({
    ...buildSentryOptions({
      dsn: TEST_DSN,
      environment: 'test',
      tracesSampleRate: options.tracesSampleRate,
    }),
    cacheClient: false,
    transportOptions: { fetch: recording.fetch },
  });
}
