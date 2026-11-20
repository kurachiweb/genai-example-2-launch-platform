import { describe, expect, test } from 'bun:test';

import { MODERATION_REASON_MAX } from '../../../common-lib/moderation/moderation-actions.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import { normalizeModerationReason } from './moderation-reason.ts';

const captureError = (run: () => unknown): AppError => {
  try {
    run();
  } catch (error) {
    if (error instanceof AppError) {
      return error;
    }
    throw error;
  }
  throw new Error('例外が投げられませんでした');
};

const FAMILY = '👨‍👩‍👧‍👦';

describe('normalizeModerationReason', () => {
  test('前後の空白(半角・全角・タブ・改行)を除いた理由を返し、途中の空白と改行は残す', () => {
    expect(
      normalizeModerationReason(
        'user.suspend',
        ' 　\t規約違反の投稿\n繰り返し\r\n ',
      ),
    ).toBe('規約違反の投稿\n繰り返し');
  });

  test.each([
    ['未指定', undefined],
    ['空文字', ''],
    ['空白だけ', ' 　\t\n'],
  ] as const)(
    '理由を必須とする措置で%sの理由は未入力の違反になる',
    (_label, reason) => {
      const error = captureError(() =>
        normalizeModerationReason('product.hide', reason),
      );

      expect(error.kind).toBe('bad_request');
      expect(error.code).toBe('validation_error');
      expect(error.message).toBe('入力内容を確認してください。');
      expect(error.details).toStrictEqual([
        {
          field: 'reason',
          code: 'required',
          message: '理由を入力してください。',
        },
      ]);
    },
  );

  test('上限ちょうどの書記素の理由は受け付け、結合した絵文字を1文字として数える', () => {
    const reason = FAMILY.repeat(MODERATION_REASON_MAX);

    expect(normalizeModerationReason('comment.hide', ` ${reason} `)).toBe(
      reason,
    );
  });

  test('上限を1つ超えた理由は上限の違反になる', () => {
    const error = captureError(() =>
      normalizeModerationReason(
        'rating.invalidate',
        'あ'.repeat(MODERATION_REASON_MAX + 1),
      ),
    );

    expect(error.kind).toBe('bad_request');
    expect(error.code).toBe('validation_error');
    expect(error.details).toStrictEqual([
      {
        field: 'reason',
        code: 'too_long',
        message: '理由は500文字以内で入力してください。',
      },
    ]);
  });

  test.each([
    ['未指定', undefined],
    ['空文字', ''],
    ['空白だけ', ' 　\t\n'],
  ] as const)(
    '理由を任意とする画像の操作で%sの理由は理由なしとして受け付ける',
    (_label, reason) => {
      expect(normalizeModerationReason('image.approve', reason)).toBeNull();
    },
  );

  test('理由を任意とする画像の操作でも、入力した理由は前後の空白を除いて返す', () => {
    expect(normalizeModerationReason('image.delete', '  不適切な画像  ')).toBe(
      '不適切な画像',
    );
  });

  test('理由を任意とする画像の操作でも、上限を超えた理由は上限の違反になる', () => {
    const error = captureError(() =>
      normalizeModerationReason(
        'image.quarantine',
        'あ'.repeat(MODERATION_REASON_MAX + 1),
      ),
    );

    expect(error.details?.[0]?.code).toBe('too_long');
  });

  test('上限の長さの空白の連続を含む理由も短い時間で判定する', () => {
    const reason = `a${' '.repeat(100_000)}b`;
    const startedAt = performance.now();

    const error = captureError(() =>
      normalizeModerationReason('user.unsuspend', reason),
    );

    expect(error.details?.[0]?.code).toBe('too_long');
    expect(performance.now() - startedAt).toBeLessThan(1000);
  });
});
