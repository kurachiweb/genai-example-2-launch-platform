import { describe, expect, test } from 'bun:test';

import {
  BOUNCED_EVENT_SAMPLE,
  COMPLAINED_EVENT_SAMPLE,
  DEFERRED_EVENT_SAMPLE,
  DELIVERED_EVENT_SAMPLE,
  FAILED_EVENT_SAMPLE,
  REJECTED_EVENT_SAMPLE,
} from './delivery-event.fixtures.ts';
import { type DeliveryEvent, parseDeliveryEvent } from './delivery-event.ts';
import {
  decideSuppressionEffect,
  isSuppressionActive,
  mergeSuppression,
  REJECTION_SUPPRESSION_DAYS,
  SEND_RECORD_RETENTION_DAYS,
  SUPPRESSION_REASONS,
  type SuppressionReason,
  type SuppressionState,
  UNLINKED_RETENTION_DAYS,
} from './suppression-policy.ts';

const OCCURRED_AT = new Date('2026-09-15T07:40:00.000Z');
const BASE = {
  eventId: '0190d0c4-7ea1-7af2-8b88-c1d2e3f4a5b6',
  recipient: 'user@recipient.example',
  occurredAt: OCCURRED_AT,
} as const;

function at(iso: string): Date {
  return new Date(iso);
}

function state(
  lastReason: SuppressionReason,
  lastEventAt: string,
  expiresAt: string | null,
): SuppressionState {
  return {
    lastReason,
    lastEventAt: at(lastEventAt),
    expiresAt: expiresAt === null ? null : at(expiresAt),
  };
}

describe('保持の定数', () => {
  test('受信者側の拒否は7日、利用者に紐づかない記録は1年、送信済みの記録は14日', () => {
    expect(REJECTION_SUPPRESSION_DAYS).toBe(7);
    expect(UNLINKED_RETENTION_DAYS).toBe(365);
    expect(SEND_RECORD_RETENTION_DAYS).toBe(14);
  });

  test('抑止の理由はDBスキーマのlast_reasonと同じ3つの値', () => {
    expect([...SUPPRESSION_REASONS].sort()).toEqual([
      'complaint',
      'hard_bounce',
      'rejected',
    ]);
  });
});

describe('decideSuppressionEffect', () => {
  test('恒久バウンスを期限なしの抑止にする', () => {
    expect(decideSuppressionEffect({ ...BASE, kind: 'hard-bounce' })).toEqual({
      kind: 'suppress',
      state: {
        lastReason: 'hard_bounce',
        lastEventAt: OCCURRED_AT,
        expiresAt: null,
      },
    });
  });

  test('苦情を期限なしの抑止にする', () => {
    expect(decideSuppressionEffect({ ...BASE, kind: 'complaint' })).toEqual({
      kind: 'suppress',
      state: {
        lastReason: 'complaint',
        lastEventAt: OCCURRED_AT,
        expiresAt: null,
      },
    });
  });

  test('受信者側の拒否を発生から7日を期限とする抑止にする', () => {
    const event: DeliveryEvent = {
      ...BASE,
      kind: 'rejected',
      party: 'recipient',
      reason: 'suppressed',
    };

    expect(decideSuppressionEffect(event)).toEqual({
      kind: 'suppress',
      state: {
        lastReason: 'rejected',
        lastEventAt: OCCURRED_AT,
        expiresAt: at('2026-09-22T07:40:00.000Z'),
      },
    });
  });

  test('受信者側以外の拒否を送信側の拒否として通知する', () => {
    const event: DeliveryEvent = {
      ...BASE,
      kind: 'rejected',
      party: 'other',
      reason: 'spam',
    };

    expect(decideSuppressionEffect(event)).toEqual({
      kind: 'report',
      category: 'sender-side-rejection',
      reason: 'spam',
    });
  });

  test('受付後の配送失敗を配送失敗として通知する', () => {
    expect(
      decideSuppressionEffect({
        ...BASE,
        kind: 'failed',
        reason: 'delivery_failed',
      }),
    ).toEqual({
      kind: 'report',
      category: 'delivery-failed',
      reason: 'delivery_failed',
    });
  });

  test('ソフトバウンスをログだけにする', () => {
    expect(decideSuppressionEffect({ ...BASE, kind: 'soft-bounce' })).toEqual({
      kind: 'log-only',
      category: 'soft-bounce',
    });
  });

  test.each(['delivered', 'deferred'] as const)('%sを無視する', (type) => {
    expect(decideSuppressionEffect({ ...BASE, kind: 'ignored', type })).toEqual(
      { kind: 'ignore' },
    );
  });
});

describe('decideSuppressionEffect(文書の標本)', () => {
  test.each([
    [DELIVERED_EVENT_SAMPLE, 'ignore'],
    [DEFERRED_EVENT_SAMPLE, 'ignore'],
    [BOUNCED_EVENT_SAMPLE, 'suppress'],
    [FAILED_EVENT_SAMPLE, 'report'],
    [REJECTED_EVENT_SAMPLE, 'suppress'],
    [COMPLAINED_EVENT_SAMPLE, 'suppress'],
  ] as const)('%#: 標本の効果は%p', (sample, expected) => {
    const parsed = parseDeliveryEvent(sample, OCCURRED_AT);
    if (!parsed.ok) {
      throw new Error(`標本を正規化できない: ${sample.type}`);
    }

    expect(decideSuppressionEffect(parsed.event).kind).toBe(expected);
  });
});

describe('mergeSuppression(個別の規則)', () => {
  test('既存の記録が無ければ新しい契機をそのまま使う', () => {
    const incoming = state(
      'rejected',
      '2026-09-15T07:40:00Z',
      '2026-09-22T07:40:00Z',
    );

    expect(mergeSuppression(undefined, incoming)).toEqual(incoming);
  });

  test('期限なしの抑止を後の期限付きの契機で期限付きに戻さず、最後の契機を更新する', () => {
    const existing = state('hard_bounce', '2026-09-15T07:40:00Z', null);
    const incoming = state(
      'rejected',
      '2026-09-16T07:40:00Z',
      '2026-09-23T07:40:00Z',
    );

    expect(mergeSuppression(existing, incoming)).toEqual(
      state('rejected', '2026-09-16T07:40:00Z', null),
    );
  });

  test('期限付きの抑止を後の契機の遅い期限へ延ばす', () => {
    const existing = state(
      'rejected',
      '2026-09-15T07:40:00Z',
      '2026-09-22T07:40:00Z',
    );
    const incoming = state(
      'rejected',
      '2026-09-18T07:40:00Z',
      '2026-09-25T07:40:00Z',
    );

    expect(mergeSuppression(existing, incoming)).toEqual(incoming);
  });

  test('遅れて届いた前の契機では期限も最後の契機も戻さない', () => {
    const existing = state(
      'rejected',
      '2026-09-18T07:40:00Z',
      '2026-09-25T07:40:00Z',
    );
    const incoming = state(
      'rejected',
      '2026-09-15T07:40:00Z',
      '2026-09-22T07:40:00Z',
    );

    expect(mergeSuppression(existing, incoming)).toEqual(existing);
  });

  test('遅れて届いた前の期限なしの契機は期限なしにするが、最後の契機は戻さない', () => {
    const existing = state(
      'rejected',
      '2026-09-18T07:40:00Z',
      '2026-09-25T07:40:00Z',
    );
    const incoming = state('complaint', '2026-09-15T07:40:00Z', null);

    expect(mergeSuppression(existing, incoming)).toEqual(
      state('rejected', '2026-09-18T07:40:00Z', null),
    );
  });

  test.each([
    ['complaint', 'hard_bounce', 'complaint'],
    ['complaint', 'rejected', 'complaint'],
    ['hard_bounce', 'rejected', 'hard_bounce'],
  ] as const)(
    '同時刻の%sと%sでは強い方の%sを最後の契機にする',
    (first, second, expected) => {
      const a = state(first, '2026-09-15T07:40:00Z', null);
      const b = state(second, '2026-09-15T07:40:00Z', null);

      expect(mergeSuppression(a, b).lastReason).toBe(expected);
      expect(mergeSuppression(b, a).lastReason).toBe(expected);
    },
  );

  test('入力の記録を書き換えない', () => {
    const existing = state(
      'rejected',
      '2026-09-15T07:40:00Z',
      '2026-09-22T07:40:00Z',
    );
    const incoming = state('complaint', '2026-09-16T07:40:00Z', null);
    const snapshot = structuredClone(existing);

    mergeSuppression(existing, incoming);

    expect(existing).toEqual(snapshot);
  });
});

describe('mergeSuppression(可換性と冪等性)', () => {
  const instants = [
    '2026-09-15T07:40:00Z',
    '2026-09-15T07:40:00.001Z',
    '2026-09-16T07:40:00Z',
  ];
  const expiries = [null, '2026-09-22T07:40:00Z', '2026-09-23T07:40:00Z'];
  const candidates: readonly SuppressionState[] = SUPPRESSION_REASONS.flatMap(
    (reason) =>
      instants.flatMap((instant) =>
        expiries.map((expiry) => state(reason, instant, expiry)),
      ),
  );

  function fold(
    states: readonly SuppressionState[],
  ): SuppressionState | undefined {
    return states.reduce<SuppressionState | undefined>(
      (merged, incoming) => mergeSuppression(merged, incoming),
      undefined,
    );
  }

  function permutations<T>(items: readonly T[]): T[][] {
    if (items.length <= 1) {
      return [[...items]];
    }
    return items.flatMap((item, index) =>
      permutations([...items.slice(0, index), ...items.slice(index + 1)]).map(
        (rest) => [item, ...rest],
      ),
    );
  }

  test('すべての組で順序を入れ替えても同じ結果になる', () => {
    for (const a of candidates) {
      for (const b of candidates) {
        expect(mergeSuppression(a, b)).toEqual(mergeSuppression(b, a));
      }
    }
  });

  test('同じ契機を重ねても結果が変わらない', () => {
    for (const a of candidates) {
      expect(mergeSuppression(a, a)).toEqual(a);
      for (const b of candidates) {
        const merged = mergeSuppression(a, b);

        expect(mergeSuppression(merged, b)).toEqual(merged);
        expect(mergeSuppression(merged, a)).toEqual(merged);
      }
    }
  });

  test('3つの契機のすべての到着順で同じ結果になる', () => {
    for (const a of candidates) {
      for (const b of candidates) {
        for (const c of candidates) {
          const [first, ...rest] = permutations([a, b, c]).map(fold);

          for (const result of rest) {
            expect(result).toEqual(first);
          }
        }
      }
    }
  });

  test('重複を含む到着順でも重複の無い場合と同じ結果になる', () => {
    const a = state('rejected', '2026-09-15T07:40:00Z', '2026-09-22T07:40:00Z');
    const b = state('hard_bounce', '2026-09-16T07:40:00Z', null);
    const c = state('rejected', '2026-09-17T07:40:00Z', '2026-09-24T07:40:00Z');

    expect(fold([c, a, b, a, c, b])).toEqual(fold([a, b, c]));
  });
});

describe('isSuppressionActive', () => {
  const now = at('2026-09-22T07:40:00.000Z');

  test('期限なしの抑止は有効', () => {
    expect(
      isSuppressionActive(
        state('complaint', '2020-01-01T00:00:00Z', null),
        now,
      ),
    ).toBe(true);
  });

  test('期限の1ミリ秒前は有効', () => {
    expect(
      isSuppressionActive(
        state('rejected', '2026-09-15T07:40:00Z', '2026-09-22T07:40:00.001Z'),
        now,
      ),
    ).toBe(true);
  });

  test('期限ちょうどは有効でない', () => {
    expect(
      isSuppressionActive(
        state('rejected', '2026-09-15T07:40:00Z', '2026-09-22T07:40:00.000Z'),
        now,
      ),
    ).toBe(false);
  });

  test('期限を過ぎた抑止は有効でない', () => {
    expect(
      isSuppressionActive(
        state('rejected', '2026-09-15T07:40:00Z', '2026-09-22T07:39:59.999Z'),
        now,
      ),
    ).toBe(false);
  });
});
