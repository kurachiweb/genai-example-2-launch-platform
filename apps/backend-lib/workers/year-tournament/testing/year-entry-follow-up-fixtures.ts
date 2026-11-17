import { asc, eq } from 'drizzle-orm';

import { yearTournamentEntries } from '../../../../db/schema/tournament/year-tournament-entries.ts';
import { formatWeekPeriodLabel } from '../../../../common-lib/tournament/week-period.ts';
import {
  TOURNAMENT_YEAR_ENTRY_REFUND_KIND,
  type YearEntryRefundEmailInput,
} from '../../../core/email/kinds/tournament-year.ts';
import type {
  EmailSender,
  EmailSendRequest,
} from '../../../core/email/ports.ts';
import type {
  PaymentRefunds,
  RefundRequestInput,
  RefundRequestResult,
} from '../../../core/payments/ports.ts';
import { D1UserContactDirectory } from '../../identity/d1-user-contact-directory.ts';
import { emailOf } from '../../identity/testing/identity-store-fixtures.ts';
import { db, T0 } from '../../product/testing/product-fixtures.ts';
import { D1YearEntryStore } from '../d1-year-entry-store.ts';
import { D1YearTournamentStore } from '../d1-year-tournament-store.ts';
import { YearTournamentCalendar } from '../year-calendar.ts';
import { YearEntryRefundFollowUp } from '../year-entry-follow-up.ts';
import {
  YEAR,
  type YearEntryFixture,
  yearEntryIdOf,
} from './year-tournament-fixtures.ts';

export const NOW = new Date('2026-11-25T19:21:00.000Z');

const CLIENT_SITE_ORIGIN = 'https://launch-stadium.example';

const BILLING_URL = `${CLIENT_SITE_ORIGIN}/settings/billing`;

export const FOLLOW_UP_CATEGORY = 'api.year-tournament.follow-up';

// 枠の既定のWeek優勝の週('2026-W47')の月曜日
const WEEK_START = '2026-11-16';

// 年ごとの読み取りを繰り返すことを少ない枠で確かめるため、読み取りの上限を小さくする
const READ_LIMIT = 3;

export const store = new D1YearEntryStore(db);

export function purchaseIdOf(index: number): string {
  return `01JD0PVRCHASE${String(index).padStart(13, '0')}`;
}

function refundRequestIdOf(index: number): string {
  return `01JD0REFVND${String(index).padStart(15, '0')}`;
}

export type RefundAnswer = (
  input: RefundRequestInput,
) => Promise<RefundRequestResult>;

export interface RecordingRefunds {
  readonly refunds: PaymentRefunds;
  readonly requests: RefundRequestInput[];
}

const notUsed = (): never => {
  throw new Error('この操作は使わない');
};

export const acceptAll: RefundAnswer = () =>
  Promise.resolve({
    kind: 'accepted',
    refundRequestId: refundRequestIdOf(1),
    duplicate: false,
  });

export function createRefunds(
  answer: RefundAnswer = acceptAll,
): RecordingRefunds {
  const requests: RefundRequestInput[] = [];
  return {
    requests,
    refunds: {
      request: (input) => {
        requests.push(input);
        return answer(input);
      },
      dispatch: notUsed,
      redispatch: notUsed,
    },
  };
}

export interface RecordingSender {
  readonly sender: EmailSender;
  readonly sent: EmailSendRequest<unknown>[];
}

// 実際の送信要求と同じく、入力が種別の検証規則に合わなければ拒否する
export function createSender(failure?: Error): RecordingSender {
  const sent: EmailSendRequest<unknown>[] = [];
  return {
    sent,
    sender: {
      send: <TInput>(request: EmailSendRequest<TInput>) => {
        if (failure !== undefined) {
          return Promise.reject(failure);
        }
        request.kind.inputSchema.parse(request.input);
        sent.push(request);
        return Promise.resolve(
          `01JC0EMA11${String(sent.length).padStart(16, '0')}`,
        );
      },
    },
  };
}

export function createFollowUp(
  refunds: PaymentRefunds,
  sender: EmailSender,
): YearEntryRefundFollowUp {
  return new YearEntryRefundFollowUp({
    appName: 'api',
    store,
    calendar: new YearTournamentCalendar(new D1YearTournamentStore(db)),
    refunds,
    contacts: new D1UserContactDirectory(db),
    emails: sender,
    clientSiteOrigin: CLIENT_SITE_ORIGIN,
    readLimit: READ_LIMIT,
  });
}

export const FORFEITED = {
  status: 'forfeited',
  closeReason: 'deleted',
  closedAt: T0,
  entitlementSource: 'payment',
  entitledAt: T0,
  refundStatus: 'pending',
} as const;

export const WITHDRAWN = { ...FORFEITED, closeReason: 'withdrawn' } as const;

export const SUSPENDED = {
  ...FORFEITED,
  status: 'excluded',
  closeReason: 'hidden_or_suspended',
  classifiedYear: YEAR,
} as const;

export const OVER_CAPACITY = {
  ...SUSPENDED,
  closeReason: 'over_capacity',
} as const;

export const NOTICE_PENDING = {
  refundStatus: 'requested',
  refundRequestedAt: T0,
  refundNoticeStatus: 'pending',
} as const;

export function followUpEntryOf(
  index: number,
  columns: YearEntryFixture['columns'] = {},
  { owner = 1 }: { owner?: number | null } = {},
): YearEntryFixture {
  return {
    index,
    launch: index,
    product: index,
    owner,
    columns: { ...FORFEITED, purchaseId: purchaseIdOf(index), ...columns },
  };
}

export async function readEntryRow(index: number) {
  const [row] = await db
    .select()
    .from(yearTournamentEntries)
    .where(eq(yearTournamentEntries.id, yearEntryIdOf(index)));
  return row;
}

export async function readEntryRows() {
  return db
    .select()
    .from(yearTournamentEntries)
    .orderBy(asc(yearTournamentEntries.id));
}

export async function pendingEntryIds(): Promise<string[]> {
  const records = await store.listPendingFollowUps(
    new Date(NOW.getTime() + 1),
    100,
  );
  return records.map(({ entryId }) => entryId);
}

export function refundEmailOf(
  reason: YearEntryRefundEmailInput['reason'],
  {
    year = YEAR,
    weekStart = WEEK_START,
    owner = 1,
  }: { year?: number; weekStart?: string; owner?: number } = {},
): EmailSendRequest<YearEntryRefundEmailInput> {
  return {
    kind: TOURNAMENT_YEAR_ENTRY_REFUND_KIND,
    to: emailOf(owner),
    input: {
      nickname: `利用者${String(owner)}`,
      yearLabel: `${String(year)}年`,
      weekLabel: formatWeekPeriodLabel(weekStart),
      reason,
      billingUrl: BILLING_URL,
    },
  };
}
