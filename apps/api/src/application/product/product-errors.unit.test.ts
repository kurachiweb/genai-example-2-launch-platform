import { describe, expect, test } from 'bun:test';

import { STATUS_BY_KIND } from '../../../lib/core/errors/app-error.ts';
import {
  type BusinessDate,
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../../lib/core/time/business-time.ts';
import { LAUNCH_PLAN_MESSAGES } from '../../domain/product/launch-plan.ts';
import { IDENTITY_ERRORS } from '../identity/identity-errors.ts';
import {
  launchDateUnavailableError,
  PRODUCT_ERRORS,
  productCategoryInputRejectedError,
  productCategoryNotFoundError,
  productDescriptionRejectedError,
  productError,
  relaunchBlockedError,
} from './product-errors.ts';

const HANDLE_TAKEN_MESSAGE =
  'このハンドルは既に使われています。別の文字列を入力してください。';

// 文言規則(docs/GUIDES/service/design/003-text-and-copy-rules.md)のエラーメッセージと一字一句同じ値
const EXPECTED = [
  ['handle_unavailable', 'conflict', 409, HANDLE_TAKEN_MESSAGE],
  [
    'product_hidden',
    'conflict',
    409,
    'このプロダクトは公開が停止されているため、説明文を更新できません。',
  ],
  [
    'product_locked',
    'conflict',
    409,
    'マッチ直前・マッチ中のため、ローンチ日・カテゴリの変更と削除はできません。',
  ],
  [
    'decision_unavailable',
    'unavailable',
    503,
    'ローンチの状態を確認できませんでした。時間をおいて再度お試しください。',
  ],
  [
    'product_update_conflict',
    'conflict',
    409,
    'プロダクトが別の画面で変更されました。最新の内容を読み込んでから操作してください。',
  ],
  ['product_not_found', 'not_found', 404, 'プロダクトが見つかりません。'],
  [
    'category_not_found',
    'unprocessable',
    422,
    'カテゴリをもう一度選択してください。',
  ],
  ['invalid_upload', 'unprocessable', 422, '画像をもう一度選択してください。'],
  [
    'screenshot_limit_exceeded',
    'unprocessable',
    422,
    'スクリーンショットは20枚・合計10MB以内にしてください。',
  ],
  [
    'product_category_name_taken',
    'conflict',
    409,
    'このカテゴリ名は既に使われています。',
  ],
  ['product_category_handle_taken', 'conflict', 409, HANDLE_TAKEN_MESSAGE],
  [
    'product_category_protected',
    'unprocessable',
    422,
    '標準カテゴリ「その他」は変更・削除できません。',
  ],
  [
    'product_category_in_use',
    'conflict',
    409,
    'このカテゴリにはプロダクトが紐付いているため削除できません。削除から14日以内のプロダクトも含みます。',
  ],
  [
    'account_unavailable',
    'forbidden',
    403,
    'このアカウントは現在ご利用いただけません。詳しくはお問い合わせください。',
  ],
] as const;

const day = (value: string): BusinessDate => parseBusinessDate(value);

const NOW = fromBusinessDateTime(day('2026-10-23'), { hour: 12, minute: 0 });

describe('productError', () => {
  test('対応表は文言規則の表のコードだけを持つ', () => {
    expect(Object.keys(PRODUCT_ERRORS).toSorted()).toEqual(
      EXPECTED.map(([code]) => code).toSorted(),
    );
  });

  test.each(EXPECTED)(
    '%sは%s(%i)のAppErrorで、文言は文言規則と一致する',
    (code, kind, status, message) => {
      const error = productError(code);

      expect(error.code).toBe(code);
      expect(error.kind).toBe(kind);
      expect(STATUS_BY_KIND[error.kind]).toBe(status);
      expect(error.message).toBe(message);
      expect(PRODUCT_ERRORS[code].message).toBe(message);
    },
  );

  test.each(['handle_unavailable', 'product_category_handle_taken'] as const)(
    '%sはハンドル欄の詳細を持つ',
    (code) => {
      expect(productError(code).details).toEqual([
        { field: 'handle', code: 'unavailable', message: HANDLE_TAKEN_MESSAGE },
      ]);
    },
  );

  test('カテゴリ名の重複はカテゴリ名の欄の詳細を持つ', () => {
    expect(productError('product_category_name_taken').details).toEqual([
      {
        field: 'name',
        code: 'unavailable',
        message: 'このカテゴリ名は既に使われています。',
      },
    ]);
  });

  test('ハンドルとカテゴリ名以外のコードは詳細を持たない', () => {
    expect(productError('invalid_upload').details).toBeUndefined();
    expect(productError('category_not_found').details).toBeUndefined();
  });

  test('account_unavailableの文言はidentity-authと同じである', () => {
    expect(PRODUCT_ERRORS.account_unavailable).toBe(
      IDENTITY_ERRORS.account_unavailable,
    );
  });
});

describe('launchDateUnavailableError', () => {
  test('ペアリングの締め切りを過ぎた日は、選べる期間を示す422で、今年でない日だけ年を付ける', () => {
    const error = launchDateUnavailableError(
      {
        reason: 'pairing_deadline',
        earliest: day('2026-10-25'),
        latest: day('2027-01-21'),
      },
      NOW,
    );

    expect(error.code).toBe('launch_date_unavailable');
    expect(error.kind).toBe('unprocessable');
    expect(STATUS_BY_KIND[error.kind]).toBe(422);
    expect(error.message).toBe(
      'ローンチ日は10月25日〜2027年1月21日の間で選んでください。',
    );
    expect(error.details).toEqual([
      {
        field: 'launchDate',
        code: 'pairing_deadline',
        message: 'ローンチ日は10月25日〜2027年1月21日の間で選んでください。',
      },
    ]);
  });

  test('選べる期間の外の日も、選べる期間を示す', () => {
    const error = launchDateUnavailableError(
      {
        reason: 'out_of_range',
        earliest: day('2026-10-24'),
        latest: day('2026-12-31'),
      },
      NOW,
    );

    expect(error.message).toBe(
      'ローンチ日は10月24日〜12月31日の間で選んでください。',
    );
    expect(error.details?.[0]?.code).toBe('out_of_range');
  });

  test('敗北後の間隔に掛かる日は、再ローンチ制限の文言で選べる最も早い日を示す', () => {
    const error = launchDateUnavailableError(
      {
        reason: 'relaunch_interval',
        earliest: day('2026-09-28'),
        latest: day('2026-12-21'),
      },
      fromBusinessDateTime(day('2026-09-22'), { hour: 9, minute: 0 }),
    );

    expect(error.message).toBe(
      'このプロダクトは9月28日以降のローンチ日を選べます。',
    );
    expect(error.details).toEqual([
      {
        field: 'launchDate',
        code: 'relaunch_interval',
        message: 'このプロダクトは9月28日以降のローンチ日を選べます。',
      },
    ]);
  });

  test('今年は業務日付の年で決める', () => {
    const lastDayOfYear = fromBusinessDateTime(day('2026-12-31'), {
      hour: 23,
      minute: 59,
    });

    const error = launchDateUnavailableError(
      {
        reason: 'pairing_deadline',
        earliest: day('2027-01-02'),
        latest: day('2027-03-31'),
      },
      lastDayOfYear,
    );

    expect(error.message).toBe(
      'ローンチ日は2027年1月2日〜2027年3月31日の間で選んでください。',
    );
  });
});

describe('relaunchBlockedError', () => {
  test.each([
    [
      'launch_scheduled',
      'このプロダクトはローンチ予定があるため再ローンチできません。',
    ],
    [
      'qualifier_in_progress',
      'このプロダクトは予選マッチに参加中のため再ローンチできません。',
    ],
  ] as const)(
    '本specの禁止の理由%sは、理由の文言のrelaunch_blocked(409)にする',
    (code, message) => {
      const error = relaunchBlockedError({
        code,
        message: LAUNCH_PLAN_MESSAGES[code],
        releaseAt: null,
      });

      expect(error.code).toBe('relaunch_blocked');
      expect(error.kind).toBe('conflict');
      expect(STATUS_BY_KIND[error.kind]).toBe(409);
      expect(error.message).toBe(message);
      expect(error.details).toBeUndefined();
    },
  );

  test('供給元の禁止の理由は、供給元の文言のrelaunch_blockedにする', () => {
    const message =
      'このプロダクトはWeekトーナメント参加中のため再ローンチできません。';

    const error = relaunchBlockedError({
      code: 'week_tournament',
      message,
      releaseAt: new Date('2026-11-20T15:00:00.000Z'),
    });

    expect(error.code).toBe('relaunch_blocked');
    expect(error.kind).toBe('conflict');
    expect(error.message).toBe(message);
  });

  test('非公開化中の禁止は、予約の文言のproduct_hidden(409)にする', () => {
    const error = relaunchBlockedError({
      code: 'product_hidden',
      message: LAUNCH_PLAN_MESSAGES.product_hidden,
      releaseAt: null,
    });

    expect(error.code).toBe('product_hidden');
    expect(error.kind).toBe('conflict');
    expect(error.message).toBe(
      'このプロダクトは公開が停止されているため、ローンチを予約できません。',
    );
  });
});

describe('productDescriptionRejectedError', () => {
  test('説明文の欄の詳細を持つvalidation_error(400)にする', () => {
    const error = productDescriptionRejectedError('説明文を入力してください。');

    expect(error.code).toBe('validation_error');
    expect(error.kind).toBe('bad_request');
    expect(STATUS_BY_KIND[error.kind]).toBe(400);
    expect(error.message).toBe('入力内容を確認してください。');
    expect(error.details).toEqual([
      {
        field: 'descriptionMarkdown',
        code: 'custom',
        message: '説明文を入力してください。',
      },
    ]);
  });
});

describe('productCategoryNotFoundError', () => {
  test('操作する問い合わせカテゴリが無い場合と同じ文言のnot_found(404)にする', () => {
    const error = productCategoryNotFoundError();

    expect(error.code).toBe('not_found');
    expect(error.kind).toBe('not_found');
    expect(STATUS_BY_KIND[error.kind]).toBe(404);
    expect(error.message).toBe('カテゴリが見つかりません。');
    expect(error.details).toBeUndefined();
  });
});

describe('productCategoryInputRejectedError', () => {
  test('受け取った欄の詳細を順に持つvalidation_error(400)にする', () => {
    const details = [
      {
        field: 'name',
        code: 'empty',
        message: 'カテゴリ名を入力してください。',
      },
      {
        field: 'handle',
        code: 'too-long',
        message: 'ハンドルは50文字以内で入力してください。',
      },
    ] as const;

    const error = productCategoryInputRejectedError(details);

    expect(error.code).toBe('validation_error');
    expect(error.kind).toBe('bad_request');
    expect(STATUS_BY_KIND[error.kind]).toBe(400);
    expect(error.message).toBe('入力内容を確認してください。');
    expect(error.details).toEqual(details);
  });
});
