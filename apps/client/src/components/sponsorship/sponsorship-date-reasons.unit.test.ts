import { describe, expect, test } from 'bun:test';

import {
  selectedSponsorshipDateReasons,
  type SponsorshipDateWindowView,
  sponsorshipUnavailableReasonOn,
} from './sponsorship-date-reasons.ts';

// 今日が2026-11-18で、2026-12-01〜2026-12-07と2027-01-10〜2027-01-10に決済済みの掲載期間がある開始日の範囲
const START_WINDOW: SponsorshipDateWindowView = {
  earliest: '2026-11-18',
  latest: '2027-11-18',
  unavailable: [
    { from: '2026-12-01', to: '2026-12-07' },
    { from: '2027-01-10', to: '2027-01-10' },
  ],
};

// 開始日2026-11-20の終了日の範囲。最初の決済済みの掲載期間の開始日の前日までが選べ、そこから開始日+365日までは重なる
const END_WINDOW: SponsorshipDateWindowView = {
  earliest: '2026-11-20',
  latest: '2026-11-30',
  unavailable: [{ from: '2026-12-01', to: '2027-11-20' }],
};

describe('sponsorshipUnavailableReasonOn', () => {
  test('開始日の欄は、決済済みの掲載期間の日(両端を含む)を重なり、最も早い日より前を過去、最も遅い日より後を範囲の外とする', () => {
    expect(
      sponsorshipUnavailableReasonOn(START_WINDOW, '2026-12-01', 'start'),
    ).toBe('overlap');
    expect(
      sponsorshipUnavailableReasonOn(START_WINDOW, '2026-12-07', 'start'),
    ).toBe('overlap');
    expect(
      sponsorshipUnavailableReasonOn(START_WINDOW, '2027-01-10', 'start'),
    ).toBe('overlap');
    expect(
      sponsorshipUnavailableReasonOn(START_WINDOW, '2026-11-17', 'start'),
    ).toBe('past');
    expect(
      sponsorshipUnavailableReasonOn(START_WINDOW, '2025-12-31', 'start'),
    ).toBe('past');
    expect(
      sponsorshipUnavailableReasonOn(START_WINDOW, '2027-11-19', 'start'),
    ).toBe('out_of_range');
  });

  test('終了日の欄は、最も早い日より前を開始日より前、最も遅い日より後を長すぎる期間とし、重なりの範囲は最も遅い日より後でも重なりとする', () => {
    expect(
      sponsorshipUnavailableReasonOn(END_WINDOW, '2026-11-19', 'end'),
    ).toBe('before_start');
    expect(
      sponsorshipUnavailableReasonOn(END_WINDOW, '2026-12-01', 'end'),
    ).toBe('overlap');
    expect(
      sponsorshipUnavailableReasonOn(END_WINDOW, '2027-11-20', 'end'),
    ).toBe('overlap');
    expect(
      sponsorshipUnavailableReasonOn(END_WINDOW, '2027-11-21', 'end'),
    ).toBe('too_long');
  });

  test('最も早い日から最も遅い日までの、重なりの範囲に無い日は選べる', () => {
    expect(
      sponsorshipUnavailableReasonOn(START_WINDOW, '2026-11-18', 'start'),
    ).toBeUndefined();
    expect(
      sponsorshipUnavailableReasonOn(START_WINDOW, '2026-11-30', 'start'),
    ).toBeUndefined();
    expect(
      sponsorshipUnavailableReasonOn(START_WINDOW, '2026-12-08', 'start'),
    ).toBeUndefined();
    expect(
      sponsorshipUnavailableReasonOn(START_WINDOW, '2027-11-18', 'start'),
    ).toBeUndefined();
    expect(
      sponsorshipUnavailableReasonOn(END_WINDOW, '2026-11-20', 'end'),
    ).toBeUndefined();
    expect(
      sponsorshipUnavailableReasonOn(END_WINDOW, '2026-11-30', 'end'),
    ).toBeUndefined();
  });

  test('月末・年末をまたぐ日も業務日付の前後で判定する', () => {
    const window: SponsorshipDateWindowView = {
      earliest: '2026-12-31',
      latest: '2027-01-01',
      unavailable: [],
    };

    expect(sponsorshipUnavailableReasonOn(window, '2026-12-30', 'start')).toBe(
      'past',
    );
    expect(
      sponsorshipUnavailableReasonOn(window, '2026-12-31', 'start'),
    ).toBeUndefined();
    expect(
      sponsorshipUnavailableReasonOn(window, '2027-01-01', 'end'),
    ).toBeUndefined();
    expect(sponsorshipUnavailableReasonOn(window, '2027-01-02', 'end')).toBe(
      'too_long',
    );
  });
});

describe('selectedSponsorshipDateReasons', () => {
  test('選んでいる開始日と終了日の理由を、それぞれの欄の範囲から求める', () => {
    expect(
      selectedSponsorshipDateReasons(
        { start: START_WINDOW, end: END_WINDOW },
        { startsOn: '2026-11-17', endsOn: '2026-12-02' },
      ),
    ).toEqual({ startsOn: 'past', endsOn: 'overlap' });
  });

  test('選べる日を選んでいれば、どちらも理由を持たない', () => {
    expect(
      selectedSponsorshipDateReasons(
        { start: START_WINDOW, end: END_WINDOW },
        { startsOn: '2026-11-20', endsOn: '2026-11-30' },
      ),
    ).toEqual({ startsOn: undefined, endsOn: undefined });
  });

  test('選んでいない日と、終了日の範囲が返らない間の終了日は理由を持たない', () => {
    expect(
      selectedSponsorshipDateReasons(
        { start: START_WINDOW, end: null },
        { startsOn: '2026-12-03', endsOn: '2026-12-31' },
      ),
    ).toEqual({ startsOn: 'overlap', endsOn: undefined });
    expect(
      selectedSponsorshipDateReasons(
        { start: START_WINDOW, end: null },
        { startsOn: null, endsOn: null },
      ),
    ).toEqual({ startsOn: undefined, endsOn: undefined });
  });
});
