import type { BusinessDateString } from './sponsorship-period.ts';

export const SPONSORSHIP_STATES = Object.freeze([
  'pending_payment',
  'paid',
  'terminated',
] as const);

export type SponsorshipState = (typeof SPONSORSHIP_STATES)[number];

export const SPONSORSHIP_STATUSES = Object.freeze([
  'pending_payment',
  'scheduled',
  'active',
  'paused',
  'ended',
  'terminated',
] as const);

export type SponsorshipStatus = (typeof SPONSORSHIP_STATUSES)[number];

// hiddenはプロダクトの非公開化または投稿者の停止
export type ProductAvailability = 'visible' | 'hidden' | 'deleted';

export const SPONSORSHIP_STATUS_LABELS: Readonly<
  Record<SponsorshipStatus, string>
> = Object.freeze({
  pending_payment: '未決済',
  scheduled: '掲載予定',
  active: '掲載中',
  paused: '表示停止中',
  ended: '終了',
  terminated: '強制終了',
});

export type SponsorshipExportStatus = Exclude<SponsorshipStatus, 'paused'>;

const derivePaidStatus = (input: {
  readonly startsOn: BusinessDateString;
  readonly endsOn: BusinessDateString;
  readonly product: ProductAvailability;
  readonly today: BusinessDateString;
}): SponsorshipStatus => {
  if (input.product === 'deleted' || input.today > input.endsOn) {
    return 'ended';
  }
  if (input.product === 'hidden') {
    return 'paused';
  }
  return input.today < input.startsOn ? 'scheduled' : 'active';
};

export const deriveSponsorshipStatus = (input: {
  readonly state: SponsorshipState;
  readonly startsOn: BusinessDateString;
  readonly endsOn: BusinessDateString;
  readonly product: ProductAvailability;
  readonly today: BusinessDateString;
}): SponsorshipStatus => {
  switch (input.state) {
    case 'pending_payment':
      return 'pending_payment';
    case 'terminated':
      return 'terminated';
    case 'paid':
      return derivePaidStatus(input);
  }
};

export const toExportStatus = (
  status: SponsorshipStatus,
  startsOn: BusinessDateString,
  today: BusinessDateString,
): SponsorshipExportStatus => {
  if (status !== 'paused') {
    return status;
  }
  return today < startsOn ? 'scheduled' : 'active';
};

export const isTerminable = (input: {
  readonly state: SponsorshipState;
  readonly endsOn: BusinessDateString;
  readonly product: ProductAvailability;
  readonly today: BusinessDateString;
}): boolean =>
  input.state === 'paid' &&
  input.endsOn >= input.today &&
  input.product !== 'deleted';
