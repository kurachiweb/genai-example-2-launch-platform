import { describe, expect, test } from 'bun:test';

import type { MessageContract } from '../messaging/message-contract.ts';
import { assertRetryPolicy } from '../messaging/retry-policy.ts';
import {
  BUSY_DEFER_SECONDS,
  DATA_EXPORT_GENERATE_MESSAGE,
  DATA_EXPORT_WATCHDOG_MESSAGE,
  GENERATION_LEASE_SECONDS,
  GENERATION_MAX_ATTEMPTS,
  GENERATION_RETRY_POLICY,
  GENERATION_STALL_SECONDS,
  GENERATION_WATCHDOG_DELAY_SECONDS,
  type DataExportMessageBody,
} from './data-export-messages.ts';

const EXPORT_ID = '01M7BNN5000000000000000001';

const CONTRACT_CASES: readonly (readonly [
  string,
  MessageContract<string, DataExportMessageBody>,
  string,
])[] = [
  ['生成の契約', DATA_EXPORT_GENERATE_MESSAGE, 'data-export.generate-archive'],
  [
    '見張りの契約',
    DATA_EXPORT_WATCHDOG_MESSAGE,
    'data-export.check-generation',
  ],
];

describe.each(CONTRACT_CASES)('%s', (_label, contract, type) => {
  test(`種別${type}の凍結済みの契約である`, () => {
    expect(contract.type).toBe(type);
    expect(Object.isFrozen(contract)).toBe(true);
  });

  test('要求のIDだけの本文を受け付ける', () => {
    expect(contract.schema.safeParse({ exportId: EXPORT_ID })).toEqual({
      success: true,
      data: { exportId: EXPORT_ID },
    });
  });

  test('本文にメールアドレスや利用者のIDを持ち込めない', () => {
    expect(
      contract.schema.parse({
        exportId: EXPORT_ID,
        email: 'maker@launch.example',
        userId: EXPORT_ID,
      }),
    ).toEqual({ exportId: EXPORT_ID });
  });

  test.each([
    ['IDの欠落', {}],
    ['空のID', { exportId: '' }],
    ['ULIDでないID', { exportId: 'export-1' }],
    ['小文字のULID', { exportId: EXPORT_ID.toLowerCase() }],
    ['数値のID', { exportId: 1 }],
    ['nullのID', { exportId: null }],
    ['本文がnull', null],
    ['本文が文字列', EXPORT_ID],
  ])('%sの本文を拒否する', (_label, body) => {
    expect(contract.schema.safeParse(body).success).toBe(false);
  });
});

describe('生成の時間の定数', () => {
  test('見張りは要求の2時間後に確かめる', () => {
    expect(GENERATION_WATCHDOG_DELAY_SECONDS).toBe(7200);
  });

  test('日次の受け皿は3時間を過ぎた生成を拾い、見張りの遅延より後になる', () => {
    expect(GENERATION_STALL_SECONDS).toBe(10_800);
    expect(GENERATION_STALL_SECONDS).toBeGreaterThan(
      GENERATION_WATCHDOG_DELAY_SECONDS,
    );
  });

  test('リースは20分である', () => {
    expect(GENERATION_LEASE_SECONDS).toBe(1200);
  });

  test('他の生成が使用中のときの待ちは1200秒である', () => {
    expect(BUSY_DEFER_SECONDS).toBe(1200);
  });

  test('見張りの遅延はQueuesの遅延の上限12時間に収まる', () => {
    expect(GENERATION_WATCHDOG_DELAY_SECONDS).toBeLessThanOrEqual(43_200);
  });
});

describe('GENERATION_RETRY_POLICY', () => {
  test('試行は3回まで、間隔は60秒から600秒までで、Queueの再配信の上限に収まる', () => {
    expect(GENERATION_MAX_ATTEMPTS).toBe(3);
    expect(GENERATION_RETRY_POLICY).toEqual({
      maxAttempts: 3,
      baseDelaySeconds: 60,
      maxDelaySeconds: 600,
    });
    expect(GENERATION_RETRY_POLICY.maxAttempts).toBe(GENERATION_MAX_ATTEMPTS);
    expect(Object.isFrozen(GENERATION_RETRY_POLICY)).toBe(true);
    expect(() => {
      assertRetryPolicy(GENERATION_RETRY_POLICY);
    }).not.toThrow();
  });
});
