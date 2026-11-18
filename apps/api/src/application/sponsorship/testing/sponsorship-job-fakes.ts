import type { ScheduledJobContext } from '../../../../lib/core/scheduling/cron-registry.ts';
import type {
  DisplayStopStore,
  NoticeRequester,
  NoticeScheduler,
  SponsorshipRecord,
  SponsorshipStore,
} from '../../../../lib/core/sponsorship/ports.ts';
import {
  type BusinessDate,
  type BusinessTimeOfDay,
  fromBusinessDateTime,
  toBusinessDateTime,
  toUtcCronExpression,
} from '../../../../lib/core/time/business-time.ts';

// 呼び出しの順を1つの列に記録し、手順の順序を確かめる
export type JobCall =
  | {
      readonly kind: 'deleteExpiredUnpaid';
      readonly today: BusinessDate;
      readonly limit: number;
    }
  | {
      readonly kind: 'listUnsettledEnded';
      readonly today: BusinessDate;
      readonly limit: number;
    }
  | { readonly kind: 'markDue'; readonly today: BusinessDate }
  | { readonly kind: 'hasPending' }
  | { readonly kind: 'request' }
  | { readonly kind: 'requestSettlement' }
  | {
      readonly kind: 'deleteEndedBefore';
      readonly cutoff: Date;
      readonly limit: number;
    };

export type JobStep = JobCall['kind'];

export interface JobFakeOptions {
  // deleteExpiredUnpaidが呼ばれるたびに順に返す件数。尽きたら0
  readonly deletedUnpaidCounts?: readonly number[];
  readonly unsettled?: readonly SponsorshipRecord[];
  readonly pending?: boolean;
  readonly deletedDisplayStops?: number;
  readonly failures?: Partial<Readonly<Record<JobStep, Error>>>;
}

export interface JobFakes {
  readonly calls: JobCall[];
  readonly store: SponsorshipStore;
  readonly scheduler: NoticeScheduler;
  readonly requester: NoticeRequester;
  readonly displayStops: DisplayStopStore;
}

const unexpected = (): Promise<never> =>
  Promise.reject(new Error('呼ばれない想定です'));

export function createJobFakes(options: JobFakeOptions = {}): JobFakes {
  const calls: JobCall[] = [];
  const deletedCounts = [...(options.deletedUnpaidCounts ?? [])];
  const record = <T>(call: JobCall, value: () => T): Promise<T> => {
    calls.push(call);
    const failure = options.failures?.[call.kind];
    return failure === undefined
      ? Promise.resolve(value())
      : Promise.reject(failure);
  };
  const store: SponsorshipStore = {
    create: unexpected,
    findById: unexpected,
    hasPaidOverlap: unexpected,
    listPaidPeriods: unexpected,
    listByOwner: unexpected,
    listForAdmin: unexpected,
    countActiveForProduct: unexpected,
    deleteUnpaid: unexpected,
    deleteExpiredUnpaid: (today, limit) =>
      record(
        { kind: 'deleteExpiredUnpaid', today, limit },
        () => deletedCounts.shift() ?? 0,
      ),
    listUnsettledEnded: (today, limit) =>
      record({ kind: 'listUnsettledEnded', today, limit }, () =>
        (options.unsettled ?? []).slice(0, limit),
      ),
  };
  const scheduler: NoticeScheduler = {
    markDue: (today) => record({ kind: 'markDue', today }, () => undefined),
    hasPending: () =>
      record({ kind: 'hasPending' }, () => options.pending ?? false),
  };
  const requester: NoticeRequester = {
    request: () => record({ kind: 'request' }, () => undefined),
    requestSettlement: () =>
      record({ kind: 'requestSettlement' }, () => undefined),
  };
  const displayStops: DisplayStopStore = {
    listOverlapping: unexpected,
    deleteSubject: unexpected,
    deleteEndedBefore: (cutoff, limit) =>
      record(
        { kind: 'deleteEndedBefore', cutoff, limit },
        () => options.deletedDisplayStops ?? 0,
      ),
  };
  return { calls, store, scheduler, requester, displayStops };
}

export function jobContextOf(
  date: BusinessDate,
  time: BusinessTimeOfDay,
): ScheduledJobContext {
  const scheduledTime = fromBusinessDateTime(date, time);
  return {
    scheduledTime,
    cron: toUtcCronExpression(time),
    business: toBusinessDateTime(scheduledTime),
  };
}
