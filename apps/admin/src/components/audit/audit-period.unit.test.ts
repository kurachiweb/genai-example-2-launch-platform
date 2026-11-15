import { describe, expect, test } from 'bun:test';

import {
  AUDIT_PERIOD_MAX_DATE,
  AUDIT_PERIOD_MIN_DATE,
  checkAuditPeriodInput,
  isCalendarDate,
  toAuditPeriod,
} from './audit-period.ts';

describe('isCalendarDate', () => {
  test.each(['2026-11-04', '2024-02-29', '0001-01-01', '9998-12-31'])(
    '暦に存在する0001〜9998年の年月日の%pを受け付ける',
    (value) => {
      expect(isCalendarDate(value)).toBe(true);
    },
  );

  test.each([
    '',
    '2026-11-4',
    '2026/11/04',
    '2026-02-29',
    '2026-13-01',
    '2026-00-10',
    '2026-11-31',
    '+02026-11-04',
    '2026-11-04T00:00',
    ' 2026-11-04',
  ])('暦に無い日付や別の形式の%pを拒む', (value) => {
    expect(isCalendarDate(value)).toBe(false);
  });

  test.each(['0000-01-01', '9999-01-01', '9999-12-31'])(
    '期間の境界の時刻がAPIの日時(西暦4桁)の外になり得る年の%pを拒む',
    (value) => {
      expect(isCalendarDate(value)).toBe(false);
    },
  );
});

describe('toAuditPeriod', () => {
  test('開始日の0時を含む時刻と、終了日の翌日0時を含まない時刻を、閲覧者の地域の暦でUTCの時刻にする', () => {
    expect(
      toAuditPeriod({ from: '2026-11-01', to: '2026-11-04' }, 'Asia/Tokyo'),
    ).toStrictEqual({
      occurredFrom: '2026-10-31T15:00:00.000Z',
      occurredBefore: '2026-11-04T15:00:00.000Z',
    });
  });

  test('UTCの地域では暦の日付の0時がそのままUTCの時刻になる', () => {
    expect(
      toAuditPeriod({ from: '2026-11-01', to: '2026-11-01' }, 'UTC'),
    ).toStrictEqual({
      occurredFrom: '2026-11-01T00:00:00.000Z',
      occurredBefore: '2026-11-02T00:00:00.000Z',
    });
  });

  test('月末・年末の終了日は翌月・翌年の1日の0時の手前までにする', () => {
    expect(toAuditPeriod({ to: '2026-12-31' }, 'Asia/Tokyo')).toStrictEqual({
      occurredBefore: '2026-12-31T15:00:00.000Z',
    });
    expect(toAuditPeriod({ to: '2028-02-28' }, 'UTC')).toStrictEqual({
      occurredBefore: '2028-02-29T00:00:00.000Z',
    });
  });

  test('夏時間の終わる日は、開始の0時と翌日の0時でそれぞれの時差を使う', () => {
    expect(
      toAuditPeriod(
        { from: '2026-11-01', to: '2026-11-01' },
        'America/New_York',
      ),
    ).toStrictEqual({
      occurredFrom: '2026-11-01T04:00:00.000Z',
      occurredBefore: '2026-11-02T05:00:00.000Z',
    });
  });

  test('0時が存在しない夏時間の始まる日は、その日の最初の時刻(1時)から含める', () => {
    expect(
      toAuditPeriod(
        { from: '2026-09-06', to: '2026-09-05' },
        'America/Santiago',
      ),
    ).toStrictEqual({
      occurredFrom: '2026-09-06T04:00:00.000Z',
      occurredBefore: '2026-09-06T04:00:00.000Z',
    });
  });

  test('0時に前日の23時へ戻る夏時間の終わる日は、戻った後の0時から含める', () => {
    expect(
      toAuditPeriod({ from: '2026-04-05' }, 'America/Santiago'),
    ).toStrictEqual({ occurredFrom: '2026-04-05T04:00:00.000Z' });
  });

  test('片方だけの期間は指定した側だけを返し、どちらも無ければ空にする', () => {
    expect(toAuditPeriod({ from: '2026-11-01' }, 'UTC')).toStrictEqual({
      occurredFrom: '2026-11-01T00:00:00.000Z',
    });
    expect(toAuditPeriod({}, 'Asia/Tokyo')).toStrictEqual({});
  });

  test('受け付ける範囲の端の日付は、時差の最も大きい地域(UTC-12・UTC+14)でもAPIの日時(西暦4桁)で表せる時刻にする', () => {
    expect(toAuditPeriod({ to: '9998-12-31' }, 'Etc/GMT+12')).toStrictEqual({
      occurredBefore: '9999-01-01T12:00:00.000Z',
    });
    expect(toAuditPeriod({ from: '0001-01-01' }, 'Etc/GMT-14')).toStrictEqual({
      occurredFrom: '0000-12-31T10:00:00.000Z',
    });
  });

  test('APIの日時の外になり得る年の日付は期間に含めない', () => {
    expect(
      toAuditPeriod({ from: '0000-01-01', to: '9999-12-31' }, 'Asia/Tokyo'),
    ).toStrictEqual({});
  });

  test('暦に無い日付は期間に含めない', () => {
    expect(
      toAuditPeriod({ from: '2026-02-30', to: 'invalid' }, 'UTC'),
    ).toStrictEqual({});
  });
});

describe('checkAuditPeriodInput', () => {
  test('空・範囲内で順序の正しい期間には誤りが無い', () => {
    expect(checkAuditPeriodInput({})).toStrictEqual({});
    expect(checkAuditPeriodInput({ from: '', to: '' })).toStrictEqual({});
    expect(
      checkAuditPeriodInput({ from: '2026-11-01', to: '2026-11-01' }),
    ).toStrictEqual({});
    expect(
      checkAuditPeriodInput({
        from: AUDIT_PERIOD_MIN_DATE,
        to: AUDIT_PERIOD_MAX_DATE,
      }),
    ).toStrictEqual({});
  });

  test('範囲の外の日付は、その欄の誤りにする', () => {
    expect(
      checkAuditPeriodInput({ from: '9999-01-01', to: '9999-12-31' }),
    ).toStrictEqual({ from: 'out-of-range', to: 'out-of-range' });
    expect(
      checkAuditPeriodInput({ from: '2026-11-01', to: '275760-09-13' }),
    ).toStrictEqual({ to: 'out-of-range' });
  });

  test('終了日が開始日より前なら終了日の欄の誤りにする', () => {
    expect(
      checkAuditPeriodInput({ from: '2026-11-05', to: '2026-11-01' }),
    ).toStrictEqual({ to: 'reversed' });
  });
});
