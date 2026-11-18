import { describe, expect, test } from 'bun:test';

import { STATUS_BY_KIND } from '../../../lib/core/errors/app-error.ts';
import { SPONSORSHIP_OFFER_REJECTION_MESSAGES } from '../../../lib/core/sponsorship/offer-rejection.ts';
import {
  SPONSORSHIP_ERRORS,
  sponsorshipError,
  sponsorshipPeriodValidationError,
} from './sponsorship-errors.ts';

const START_MESSAGE = '開始日は今日から1年以内の日付を選んでください。';
const END_MESSAGE =
  '終了日は開始日から366日以内の、開始日以降の日付を選んでください。';

describe('sponsorshipError', () => {
  test.each([
    ['sponsorship_product_ineligible', 'unprocessable', 422],
    ['sponsorship_overlap', 'conflict', 409],
    ['sponsorship_not_payable', 'conflict', 409],
  ] as const)(
    '%sは購入の可否の口の拒否の文言を%s(%d)で返す',
    (code, kind, status) => {
      const error = sponsorshipError(code);

      expect(error.kind).toBe(kind);
      expect(STATUS_BY_KIND[error.kind]).toBe(status);
      expect(error.code).toBe(code);
      expect(error.message).toBe(SPONSORSHIP_OFFER_REJECTION_MESSAGES[code]);
    },
  );

  test('sponsorship_not_foundは他人と存在しない申込を区別しない文言をnot_found(404)で返す', () => {
    const error = sponsorshipError('sponsorship_not_found');

    expect(STATUS_BY_KIND[error.kind]).toBe(404);
    expect(error.message).toBe('この申込は見つかりませんでした。');
  });

  test('sponsorship_not_terminableは一覧の再読み込みを促す文言をconflict(409)で返す', () => {
    const error = sponsorshipError('sponsorship_not_terminable');

    expect(STATUS_BY_KIND[error.kind]).toBe(409);
    expect(error.code).toBe('sponsorship_not_terminable');
    expect(error.message).toBe(
      'この広告は強制終了できません。一覧を再読み込みしてください。',
    );
  });

  test('定義は実行時に書き換えられない', () => {
    expect(Object.isFrozen(SPONSORSHIP_ERRORS)).toBe(true);
  });
});

describe('sponsorshipPeriodValidationError', () => {
  test('開始日と終了日の違反を、項目ごとの理由と文言の詳細を持つvalidation_error(400)にする', () => {
    const error = sponsorshipPeriodValidationError({
      startsOn: 'too-far',
      endsOn: 'too-long',
    });

    expect(STATUS_BY_KIND[error.kind]).toBe(400);
    expect(error.code).toBe('validation_error');
    expect(error.message).toBe('入力内容を確認してください。');
    expect(error.details).toStrictEqual([
      { field: 'startsOn', code: 'too_far', message: START_MESSAGE },
      { field: 'endsOn', code: 'too_long', message: END_MESSAGE },
    ]);
  });

  test.each([
    ['invalid', 'invalid'],
    ['past', 'past'],
    ['too-far', 'too_far'],
  ] as const)(
    '開始日だけの違反%sは開始日の詳細だけを持つ',
    (violation, code) => {
      expect(
        sponsorshipPeriodValidationError({ startsOn: violation }).details,
      ).toStrictEqual([{ field: 'startsOn', code, message: START_MESSAGE }]);
    },
  );

  test.each([
    ['invalid', 'invalid'],
    ['before-start', 'before_start'],
    ['too-long', 'too_long'],
  ] as const)(
    '終了日だけの違反%sは終了日の詳細だけを持つ',
    (violation, code) => {
      expect(
        sponsorshipPeriodValidationError({ endsOn: violation }).details,
      ).toStrictEqual([{ field: 'endsOn', code, message: END_MESSAGE }]);
    },
  );
});
