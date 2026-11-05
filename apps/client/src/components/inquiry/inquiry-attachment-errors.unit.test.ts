import { describe, expect, test } from 'bun:test';

import { inquiryAttachmentErrorsOf } from './inquiry-attachment-errors.ts';

const SENT = ['file-1', 'file-2', 'file-3'];

describe('inquiryAttachmentErrorsOf', () => {
  test('添付の位置の詳細から送った値のその位置のファイルを取り出し、最初の文言と他の詳細を分ける', () => {
    const errors = inquiryAttachmentErrorsOf(
      [
        { field: 'fileIds.2', code: 'invalid', message: '確認できません。' },
        { field: 'fileIds.0', code: 'invalid', message: '別の文言' },
        { field: 'reason', code: 'unknown', message: '欄に対応しない詳細' },
      ],
      SENT,
    );

    expect([...errors.invalidFileIds]).toEqual(['file-3', 'file-1']);
    expect(errors.message).toBe('確認できません。');
    expect(errors.others).toEqual([
      { field: 'reason', code: 'unknown', message: '欄に対応しない詳細' },
    ]);
  });

  test('送った値に無い位置は除き、添付の位置の詳細が無ければ文言をundefinedにする', () => {
    expect(
      inquiryAttachmentErrorsOf(
        [{ field: 'fileIds.9', code: 'invalid', message: '確認できません。' }],
        SENT,
      ).invalidFileIds.size,
    ).toBe(0);
    expect(inquiryAttachmentErrorsOf([], SENT)).toEqual({
      invalidFileIds: new Set(),
      message: undefined,
      others: [],
    });
  });
});
