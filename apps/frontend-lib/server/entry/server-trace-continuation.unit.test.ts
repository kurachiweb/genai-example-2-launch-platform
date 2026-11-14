import { afterEach, describe, expect, test } from 'bun:test';

import { resetSync } from '@logtape/logtape';
import {
  captureException,
  type CloudflareOptions,
  getTraceData,
  withSentry,
} from '@sentry/cloudflare';

import {
  firstCall,
  okResponse,
  respondingWith,
} from '../../test/relay-route-fixtures.ts';
import {
  APP_SECURITY_POLICY,
  baseEnvOf,
  CLIENT_TEST_PROFILE,
  limiterOf,
  sameOriginPost,
} from '../../test/server-entry-fixtures.ts';
import { buildServerSentryOptions } from '../observability/server-sentry-options.ts';
import { GRAPHQL_RELAY_ROUTE } from '../relay/relay-route.ts';
import { createFrontendServerEntry } from './create-frontend-server-entry.ts';

type SentryTransport = NonNullable<CloudflareOptions['transport']>;

const BROWSER_TRACE_ID = '0af7651916cd43dd8448eb211c80319c';
const BROWSER_SPAN_ID = 'b7ad6b7169203331';
const BROWSER_SENTRY_TRACE = `${BROWSER_TRACE_ID}-${BROWSER_SPAN_ID}-1`;
const BROWSER_BAGGAGE = [
  `sentry-trace_id=${BROWSER_TRACE_ID}`,
  'sentry-environment=prod',
  'sentry-public_key=public-dsn-part',
  'sentry-sample_rate=0.1',
  'sentry-sampled=true',
].join(',');

// SDKはDSNの公開鍵に英数字と_だけを受け付け、それ以外では送信できないクライアントになりトレースを続けない
const VALID_SENTRY_DSN = 'https://0123456789abcdef@o1.ingest.sentry.example/1';

const SENTRY_TRACE_PATTERN =
  /^(?<traceId>[0-9a-f]{32})-(?<spanId>[0-9a-f]{16})-(?<sampled>[01])$/u;

// 実際のエラートラッキングへ送らないよう、送信を記録するだけの偽物に差し替える
const recordingTransport =
  (sent: unknown[]): SentryTransport =>
  () => ({
    send: (envelope) => {
      sent.push(envelope);
      return Promise.resolve({});
    },
    flush: () => Promise.resolve(true),
  });

const silentConsole = (): Console => {
  const ignore = (): void => undefined;
  return {
    trace: ignore,
    debug: ignore,
    info: ignore,
    warn: ignore,
    error: ignore,
  } as unknown as Console;
};

afterEach(() => {
  resetSync();
});

describe('createFrontendServerEntry(トレースの引き継ぎ)', () => {
  test('本物のwithSentryで包むと、ブラウザのsentry-traceのトレースIDを中継先への要求へ引き継ぐ', async () => {
    const api = respondingWith(okResponse);
    const env = {
      ...baseEnvOf(api, limiterOf(true)),
      SENTRY_DSN: VALID_SENTRY_DSN,
    };
    const sent: unknown[] = [];
    const pending: Promise<unknown>[] = [];
    const entry = withSentry(
      (rawEnv) => ({
        ...buildServerSentryOptions(rawEnv),
        transport: recordingTransport(sent),
      }),
      createFrontendServerEntry({
        profile: CLIENT_TEST_PROFILE,
        startHandler: {
          fetch: () => Promise.reject(new Error('描画は呼ばれない')),
        },
        relayRoutes: [GRAPHQL_RELAY_ROUTE],
        securityPolicy: APP_SECURITY_POLICY,
        reportUnexpected: captureException,
        traceHeaders: () => ({ ...getTraceData() }),
        console: silentConsole(),
      }),
    );

    const response = await entry.fetch(
      sameOriginPost('/_bff/graphql', {
        'sentry-trace': BROWSER_SENTRY_TRACE,
        baggage: BROWSER_BAGGAGE,
      }),
      env,
      {
        waitUntil: (promise) => {
          pending.push(promise);
        },
      },
    );
    await Promise.all(pending);

    expect(response.status).toBe(200);
    const relayed = SENTRY_TRACE_PATTERN.exec(
      firstCall(api).headers['sentry-trace'] ?? '',
    )?.groups;
    expect(relayed?.['traceId']).toBe(BROWSER_TRACE_ID);
    expect(relayed?.['spanId']).not.toBe(BROWSER_SPAN_ID);
    expect(relayed?.['sampled']).toBe('1');
    expect(firstCall(api).headers['baggage']).toContain(
      `sentry-trace_id=${BROWSER_TRACE_ID}`,
    );
  });
});
