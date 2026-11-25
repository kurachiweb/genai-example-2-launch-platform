import type { SponsorshipRequestBody } from '../../../../lib/core/messaging/contracts/sponsorship.ts';
import type {
  MessageHandler,
  MessageMeta,
} from '../../../../lib/core/messaging/message-contract.ts';
import type {
  NoticeRequester,
  NoticeScheduler,
  RefundOutcome,
  SponsorshipRecord,
  SponsorshipStore,
} from '../../../../lib/core/sponsorship/ports.ts';
import {
  type BusinessDate,
  parseBusinessDate,
} from '../../../../lib/core/time/business-time.ts';
import type { Clock } from '../../../../lib/core/time/clock.ts';
import { PeriodEndSettlementHandler } from '../period-end-settlement-handler.ts';
import type {
  PeriodEndSettlementCommitter,
  PeriodEndSettlementFailureReporter,
  PeriodEndSettlementResult,
} from '../ports.ts';
import { NOW, recordOf } from './notice-dispatch-fakes.ts';

export { NOW, recordOf };

export const TODAY: BusinessDate = parseBusinessDate('2026-11-25');

export const REQUESTED_OUTCOME: RefundOutcome = Object.freeze({
  kind: 'display_stop',
  days: 2,
  amount: 2_000,
  status: 'requested',
  refundRequestId: '01JD0SPRFND000000000000001',
});

// 申込IDごとの精算の結果。Errorは精算の例外。無い申込は精算される
export type SettlementBehavior = 'settled' | 'skipped' | Error;

export interface SettlementScenario {
  // 未精算の終了した広告を、終了日とIDの昇順で
  readonly unsettled: readonly SponsorshipRecord[];
  readonly behaviors?: Readonly<Record<string, SettlementBehavior>>;
  readonly listFailure?: Error;
}

export type SettlementCall =
  | {
      readonly op: 'listUnsettledEnded';
      readonly today: BusinessDate;
      readonly limit: number;
    }
  | { readonly op: 'settle'; readonly sponsorshipId: string; readonly at: Date }
  | {
      readonly op: 'report';
      readonly sponsorshipId: string;
      readonly error: unknown;
    }
  | { readonly op: 'markDue'; readonly today: BusinessDate }
  | { readonly op: 'request' };

export interface SettlementHarness {
  // メッセージの処理の一覧と同じく、契約の型を通して呼ぶ
  readonly handler: MessageHandler<SponsorshipRequestBody>;
  readonly calls: readonly SettlementCall[];
}

function notUsed(): Promise<never> {
  return Promise.reject(new Error('想定外の呼び出し'));
}

// 精算と取り消しは条件の崩れで未精算の一覧から外れ、例外の広告は未精算のまま残る
function createStore(
  scenario: SettlementScenario,
  remaining: Set<string>,
  calls: SettlementCall[],
): SponsorshipStore {
  return {
    listUnsettledEnded: (today, limit) => {
      calls.push({ op: 'listUnsettledEnded', today, limit });
      if (scenario.listFailure !== undefined) {
        return Promise.reject(scenario.listFailure);
      }
      return Promise.resolve(
        scenario.unsettled
          .filter(({ id }) => remaining.has(id))
          .slice(0, limit),
      );
    },
    create: notUsed,
    findById: notUsed,
    hasPaidOverlap: notUsed,
    listPaidPeriods: notUsed,
    listByOwner: notUsed,
    listForAdmin: notUsed,
    countActiveForProduct: notUsed,
    deleteUnpaid: notUsed,
    deleteExpiredUnpaid: notUsed,
  };
}

function createCommitter(
  scenario: SettlementScenario,
  remaining: Set<string>,
  calls: SettlementCall[],
): PeriodEndSettlementCommitter {
  return {
    settle: (record, at) => {
      calls.push({ op: 'settle', sponsorshipId: record.id, at });
      const behavior = scenario.behaviors?.[record.id] ?? 'settled';
      if (behavior instanceof Error) {
        return Promise.reject(behavior);
      }
      remaining.delete(record.id);
      return Promise.resolve<PeriodEndSettlementResult>(
        behavior === 'settled'
          ? { kind: 'settled', displayStop: REQUESTED_OUTCOME }
          : { kind: 'skipped' },
      );
    },
  };
}

export function createSettlementHarness(
  scenario: SettlementScenario,
): SettlementHarness {
  const calls: SettlementCall[] = [];
  const remaining = new Set(scenario.unsettled.map(({ id }) => id));
  const clock: Clock = { now: () => NOW };
  const scheduler: NoticeScheduler = {
    markDue: (today) => {
      calls.push({ op: 'markDue', today });
      return Promise.resolve();
    },
    hasPending: notUsed,
  };
  const requester: NoticeRequester = {
    request: () => {
      calls.push({ op: 'request' });
      return Promise.resolve();
    },
    requestSettlement: notUsed,
  };
  const failures: PeriodEndSettlementFailureReporter = {
    report: ({ sponsorshipId, error }) => {
      calls.push({ op: 'report', sponsorshipId, error });
    },
  };
  return {
    calls,
    handler: new PeriodEndSettlementHandler({
      sponsorships: createStore(scenario, remaining, calls),
      committer: createCommitter(scenario, remaining, calls),
      scheduler,
      requester,
      failures,
      clock,
    }),
  };
}

export function recordsOf(from: number, count: number): SponsorshipRecord[] {
  return Array.from({ length: count }, (_, offset) =>
    recordOf(from + offset, {
      startsOn: parseBusinessDate('2026-11-18'),
      endsOn: parseBusinessDate('2026-11-24'),
    }),
  );
}

export const MESSAGE_META: MessageMeta = Object.freeze({
  id: '01JD0SPMSG0000000000000002',
  type: 'sponsorship.settle-period-end',
  attempts: 1,
  sentAt: NOW,
});

export const REQUEST_BODY: SponsorshipRequestBody = Object.freeze({
  requestedAt: NOW.toISOString(),
});
