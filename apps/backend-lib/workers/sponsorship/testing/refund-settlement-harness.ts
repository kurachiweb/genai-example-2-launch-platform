import type { Event } from '@sentry/cloudflare';
import type { BatchItem } from 'drizzle-orm/batch';

import type {
  PaymentRefunds,
  RefundRequestInput,
} from '../../../core/payments/ports.ts';
import type { RefundRejectionCode } from '../../../core/payments/refund-rejection.ts';
import type {
  DisplayStopInterval,
  DisplayStopStore,
  SponsorshipRecord,
} from '../../../core/sponsorship/ports.ts';
import {
  type BusinessDate,
  parseBusinessDate,
} from '../../../core/time/business-time.ts';
import type { PaymentRefundStatements } from '../../payments/statement-contracts.ts';
import { D1RefundSettlement } from '../refund-settlement.ts';

export type Prepared = Awaited<ReturnType<PaymentRefundStatements['prepare']>>;

export type Respond = (input: RefundRequestInput) => Prepared | Error;

interface ListInput {
  readonly productId: string;
  readonly userId: string;
  readonly from: Date;
  readonly to: Date;
}

export const SPONSORSHIP_ID = '01JD0SP0NS0000000000000001';
export const USER_ID = '01JD0VSER00000000000000001';
export const PRODUCT_ID = '01JD0PR0DVCT00000000000001';
export const PURCHASE_ID = '01JD0SPVRCH000000000000001';
export const AMOUNT_TOTAL = 10_000;

export const TERMINATION_KEY = `sponsorship:${PURCHASE_ID}:sponsorship_terminated`;
export const DISPLAY_STOP_KEY = `sponsorship:${PURCHASE_ID}:sponsorship_display_stopped`;

const NOT_SETTLED = Object.freeze({
  status: 'none',
  days: null,
  amount: null,
  refundRequestId: null,
} as const);

export const date = (value: string): BusinessDate => parseBusinessDate(value);

// 基準時刻(UTC-08:00)の日付と時刻を時点にする
export const at = (value: string): Date => new Date(`${value}-08:00`);

// 2026-12-04 10:00から2026-12-06 9:00まで(3日)
export const THREE_DAY_STOP: DisplayStopInterval = Object.freeze({
  startedAt: at('2026-12-04T10:00:00'),
  endedAt: at('2026-12-06T09:00:00'),
});

// 12-01〜12-10の10日間・10,000セント
export function recordOf(
  overrides: Partial<SponsorshipRecord> = {},
): SponsorshipRecord {
  return {
    id: SPONSORSHIP_ID,
    userId: USER_ID,
    productId: PRODUCT_ID,
    tier: 'gold',
    startsOn: date('2026-12-01'),
    endsOn: date('2026-12-10'),
    days: 10,
    state: 'paid',
    purchaseId: PURCHASE_ID,
    paymentRecordId: '01JD0SPREC0000000000000001',
    amountTotal: AMOUNT_TOTAL,
    paidAt: at('2026-11-20T10:00:00'),
    terminatedAt: null,
    terminationReason: null,
    productDeletedAt: null,
    terminationRefund: NOT_SETTLED,
    stopRefund: NOT_SETTLED,
    createdAt: at('2026-11-20T09:00:00'),
    ...overrides,
  };
}

// 単体テストでは文を実行しないため、依頼の識別子を持つ目印で文の受け渡しを確かめる
export function statementOf(refundRequestId: string): BatchItem<'sqlite'> {
  return { refundRequestId } as unknown as BatchItem<'sqlite'>;
}

export function accepted(refundRequestId: string, duplicate = false): Prepared {
  return {
    kind: 'accepted',
    refundRequestId,
    duplicate,
    statements: duplicate ? [] : [statementOf(refundRequestId)],
  };
}

export function rejected(code: RefundRejectionCode): Prepared {
  return { kind: 'rejected', code };
}

// 金額nullの依頼し直しだけを受け付ける
export const acceptRemainingOnly: Respond = (input) =>
  input.amount === null
    ? accepted('refund-remaining')
    : rejected('amount_exceeds_refundable');

class FakeRefundStatements implements PaymentRefundStatements {
  readonly calls: RefundRequestInput[] = [];

  constructor(private readonly respond: Respond) {}

  prepare(input: RefundRequestInput): Promise<Prepared> {
    this.calls.push(input);
    const result = this.respond(input);
    return result instanceof Error
      ? Promise.reject(result)
      : Promise.resolve(result);
  }

  prepareForReflection(): never {
    throw new Error('テストでは使わない');
  }
}

class FakeRefunds implements PaymentRefunds {
  readonly dispatched: string[] = [];

  constructor(private readonly failing: ReadonlySet<string>) {}

  request(): never {
    throw new Error('テストでは使わない');
  }

  dispatch(refundRequestId: string): Promise<void> {
    this.dispatched.push(refundRequestId);
    return this.failing.has(refundRequestId)
      ? Promise.reject(new Error('送信できない'))
      : Promise.resolve();
  }

  redispatch(): never {
    throw new Error('テストでは使わない');
  }
}

class FakeDisplayStopStore implements DisplayStopStore {
  readonly inputs: ListInput[] = [];

  constructor(private readonly intervals: readonly DisplayStopInterval[]) {}

  listOverlapping(input: ListInput): Promise<readonly DisplayStopInterval[]> {
    this.inputs.push(input);
    return Promise.resolve(this.intervals);
  }

  deleteSubject(): never {
    throw new Error('テストでは使わない');
  }

  deleteEndedBefore(): never {
    throw new Error('テストでは使わない');
  }
}

export interface SettlementHarness {
  readonly settlement: D1RefundSettlement;
  readonly statements: FakeRefundStatements;
  readonly refunds: FakeRefunds;
  readonly displayStops: FakeDisplayStopStore;
}

// 既定では全ての依頼をrefund-<理由>の識別子で受け付ける
export function settlementHarness(
  options: {
    readonly intervals?: readonly DisplayStopInterval[];
    readonly respond?: Respond;
    readonly failingDispatch?: ReadonlySet<string>;
  } = {},
): SettlementHarness {
  const statements = new FakeRefundStatements(
    options.respond ?? ((input) => accepted(`refund-${input.reason}`)),
  );
  const refunds = new FakeRefunds(options.failingDispatch ?? new Set());
  const displayStops = new FakeDisplayStopStore(options.intervals ?? []);
  const settlement = new D1RefundSettlement({
    appName: 'api',
    displayStops,
    refundStatements: statements,
    refunds,
  });
  return { settlement, statements, refunds, displayStops };
}

export function tagsOf(event: Event | undefined): Event['tags'] {
  return event?.tags;
}
