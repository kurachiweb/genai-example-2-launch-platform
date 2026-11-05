import { describe, expect, test } from 'bun:test';

import { INQUIRY_ATTACHMENTS_LABEL } from './inquiry-display-messages.ts';

describe('問い合わせの表示部品の文言', () => {
  test('添付の一覧の名前は「添付ファイル」で、句点の無い体言止めにする', () => {
    expect(INQUIRY_ATTACHMENTS_LABEL).toBe('添付ファイル');
    expect(INQUIRY_ATTACHMENTS_LABEL).not.toMatch(/(?:。|です|ます)$/u);
  });
});
