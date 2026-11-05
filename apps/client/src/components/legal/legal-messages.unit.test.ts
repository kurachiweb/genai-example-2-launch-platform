import { describe, expect, test } from 'bun:test';

import { pastVersionNotice } from './legal-messages.ts';

describe('版番号を含む法務文書の文言', () => {
  test('過去版の案内は版の呼び名と最新版ではないことを示す', () => {
    expect(pastVersionNotice(2)).toBe(
      'これは第2版です。最新版ではありません。',
    );
  });
});
