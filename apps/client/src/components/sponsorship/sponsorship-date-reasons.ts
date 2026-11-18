import type {
  BusinessDateString,
  SponsorshipDateUnavailableReason,
} from '../../../common-lib/sponsorship/sponsorship-period.ts';

export type SponsorshipDateFieldKind = 'start' | 'end';

// サーバーが返す選べる範囲。重なりの範囲の理由は1種類だけのため、範囲の両端だけを読む
export interface SponsorshipDateWindowView {
  readonly earliest: BusinessDateString;
  readonly latest: BusinessDateString;
  readonly unavailable: readonly {
    readonly from: BusinessDateString;
    readonly to: BusinessDateString;
  }[];
}

export interface SponsorshipPeriodWindowsView {
  readonly start: SponsorshipDateWindowView;
  // 開始日を渡さなかったときと、渡した開始日が選べなかったときはnull
  readonly end: SponsorshipDateWindowView | null;
}

export interface SponsorshipPeriodSelection {
  readonly startsOn: BusinessDateString | null;
  readonly endsOn: BusinessDateString | null;
}

export interface SponsorshipPeriodSelectionReasons {
  readonly startsOn: SponsorshipDateUnavailableReason | undefined;
  readonly endsOn: SponsorshipDateUnavailableReason | undefined;
}

const BEFORE_EARLIEST_REASONS: Readonly<
  Record<SponsorshipDateFieldKind, SponsorshipDateUnavailableReason>
> = Object.freeze({ start: 'past', end: 'before_start' });

const AFTER_LATEST_REASONS: Readonly<
  Record<SponsorshipDateFieldKind, SponsorshipDateUnavailableReason>
> = Object.freeze({ start: 'out_of_range', end: 'too_long' });

// 業務日付はYYYY-MM-DDの固定長のため、文字列の比較が日付の前後と一致する。終了日の重なりの範囲は最も遅い日より後に並ぶため、重なりを先に判定する
export const sponsorshipUnavailableReasonOn = (
  window: SponsorshipDateWindowView,
  date: BusinessDateString,
  kind: SponsorshipDateFieldKind,
): SponsorshipDateUnavailableReason | undefined => {
  if (window.unavailable.some(({ from, to }) => from <= date && date <= to)) {
    return 'overlap';
  }
  if (date < window.earliest) {
    return BEFORE_EARLIEST_REASONS[kind];
  }
  return date > window.latest ? AFTER_LATEST_REASONS[kind] : undefined;
};

// 終了日の範囲が返らない間は終了日のカレンダーを閉じるため、選んでいる終了日に理由を付けない
export const selectedSponsorshipDateReasons = (
  windows: SponsorshipPeriodWindowsView,
  { startsOn, endsOn }: SponsorshipPeriodSelection,
): SponsorshipPeriodSelectionReasons => ({
  startsOn:
    startsOn === null
      ? undefined
      : sponsorshipUnavailableReasonOn(windows.start, startsOn, 'start'),
  endsOn:
    endsOn === null || windows.end === null
      ? undefined
      : sponsorshipUnavailableReasonOn(windows.end, endsOn, 'end'),
});
