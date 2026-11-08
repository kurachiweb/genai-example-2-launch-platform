import { describe, expect, test } from 'bun:test';

import {
  previousHandleGuidanceOf,
  websiteRemoveLabelOf,
  websiteRowLabelOf,
} from './profile-form-messages.ts';

describe('プロフィール編集フォームの文言の組み立て', () => {
  test('外部Webサイトの行の名前は位置を番号にして示す', () => {
    expect(websiteRowLabelOf(1)).toBe('外部Webサイト1');
    expect(websiteRowLabelOf(10)).toBe('外部Webサイト10');
  });

  test('外部Webサイトの行の削除の名前は行の名前に続けて削除を示す', () => {
    expect(websiteRemoveLabelOf(3)).toBe('外部Webサイト3を削除');
  });

  test('以前のハンドルの案内は先頭に@を付けたハンドルと転送の条件を示す', () => {
    const guidance = previousHandleGuidanceOf('old-name');

    expect(guidance).toContain('以前のハンドル@old-nameは');
    expect(guidance).toContain('新しいURLへ転送されます');
    expect(guidance).toContain('転送は止まります');
  });
});
