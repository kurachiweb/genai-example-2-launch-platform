import { captureException, getClient } from '@sentry/cloudflare';
import { afterEach, describe, expect, test } from 'vitest';

import {
  installRecordingSentry,
  resetObservability,
} from './observability-fixtures.ts';

type RecordingTransport = NonNullable<
  ReturnType<NonNullable<ReturnType<typeof getClient>>['getTransport']>
>;

type TransportEnvelope = Parameters<RecordingTransport['send']>[0];

const EMPTY_ENVELOPE = [{}, []] as unknown as TransportEnvelope;

const transportOf = (): RecordingTransport => {
  const transport = getClient()?.getTransport();
  if (!transport) {
    throw new Error('記録用のSentryの送信の口がありません');
  }
  return transport;
};

describe('観測の補助', () => {
  afterEach(() => {
    resetObservability();
  });

  test('記録用のSentryは送られる例外のイベントを記録する', () => {
    const events = installRecordingSentry();

    captureException(new Error('記録の確認'));

    expect(events).toHaveLength(1);
    expect(events[0]?.exception?.values?.[0]?.value).toBe('記録の確認');
  });

  test('記録用のSentryの送信の口は、送信と送り出しの待ちを何もせずに成功で返す', async () => {
    installRecordingSentry();
    const transport = transportOf();

    await expect(transport.send(EMPTY_ENVELOPE)).resolves.toStrictEqual({});
    await expect(transport.flush()).resolves.toBe(true);
  });

  test('後片付けの後は、記録用のSentryが外れる', () => {
    installRecordingSentry();

    resetObservability();

    expect(getClient()).toBeUndefined();
  });
});
