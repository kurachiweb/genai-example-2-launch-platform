import { describe, expect, test } from 'bun:test';

import { INQUIRY_CURSOR_MAX } from '../../../common-lib/inquiry/inquiry-input-rules.ts';
import { myInquirySearchAt, toMyInquirySearch } from './my-inquiry-search.ts';

describe('toMyInquirySearch', () => {
  test('ページの位置のカーソルを受け取り、他の検索パラメータを持たない', () => {
    expect(
      toMyInquirySearch({ after: 'cursor-2', utm_source: 'mail' }),
    ).toStrictEqual({ after: 'cursor-2' });
  });

  test('カーソルが無ければ空にする', () => {
    expect(toMyInquirySearch({})).toStrictEqual({});
  });

  test.each([
    ['空の文字列', ''],
    ['文字列でない値', 12],
    ['上限を超える長さ', 'a'.repeat(INQUIRY_CURSOR_MAX + 1)],
  ])('%sのカーソルは1ページ目として扱う', (_label, after) => {
    expect(toMyInquirySearch({ after })).toStrictEqual({});
  });

  test('上限ちょうどの長さのカーソルは受け取る', () => {
    const after = 'a'.repeat(INQUIRY_CURSOR_MAX);

    expect(toMyInquirySearch({ after })).toStrictEqual({ after });
  });
});

describe('myInquirySearchAt', () => {
  test('カーソルのページの検索パラメータにし、undefinedは項目の無い1ページ目にする', () => {
    expect(myInquirySearchAt('cursor-3')).toStrictEqual({ after: 'cursor-3' });
    expect(myInquirySearchAt(undefined)).toStrictEqual({});
  });
});
