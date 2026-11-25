import { describe, expect, test } from 'bun:test';

import {
  DEGRADED_SERVICES_ENV_KEY,
  resolveDegradedReads,
} from './degraded-reads-plan.ts';

describe('resolveDegradedReads', () => {
  test('止めたサービスの環境変数が未設定か空白だけなら対象外にし、理由に変数名を含める', () => {
    for (const env of [
      {},
      { [DEGRADED_SERVICES_ENV_KEY]: '' },
      { [DEGRADED_SERVICES_ENV_KEY]: ' , ' },
    ]) {
      const result = resolveDegradedReads(env);

      expect(result.kind).toBe('skip');
      expect(result.kind === 'skip' && result.reason).toContain(
        DEGRADED_SERVICES_ENV_KEY,
      );
    }
  });

  test('カンマ区切りのサービスを空白を除いて並べ、重複を除く', () => {
    const result = resolveDegradedReads({
      [DEGRADED_SERVICES_ENV_KEY]: 'stripe, email,stripe,disify',
    });

    expect(result).toEqual({
      kind: 'run',
      services: ['stripe', 'email', 'disify'],
      paymentsStopped: true,
    });
  });

  test('Stripeを止めていなければ決済の縮退の案内を確かめない', () => {
    const result = resolveDegradedReads({
      [DEGRADED_SERVICES_ENV_KEY]: 'rekognition,gcp-nl',
    });

    expect(result).toEqual({
      kind: 'run',
      services: ['rekognition', 'gcp-nl'],
      paymentsStopped: false,
    });
  });

  test('未知のサービス名は黙って無視せず、名前を挙げて失敗する', () => {
    expect(() =>
      resolveDegradedReads({
        [DEGRADED_SERVICES_ENV_KEY]: 'stripe,unknown-service',
      }),
    ).toThrow('unknown-service');
  });
});
