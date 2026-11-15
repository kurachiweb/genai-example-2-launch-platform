import { describe, expect, test } from 'bun:test';

import {
  INQUIRY_ATTACHMENTS_LABEL,
  INQUIRY_AUTO_REFRESH_DESCRIPTION,
  INQUIRY_AUTO_REFRESH_LABEL,
} from './inquiry-display-messages.ts';

describe('問い合わせの表示部品の文言', () => {
  test('添付の一覧の名前は「添付ファイル」で、句点の無い体言止めにする', () => {
    expect(INQUIRY_ATTACHMENTS_LABEL).toBe('添付ファイル');
    expect(INQUIRY_ATTACHMENTS_LABEL).not.toMatch(/(?:。|です|ます)$/u);
  });

  test('自動更新のスイッチの名前は句点の無い「自動更新」にし、説明は定期再取得の間隔の秒数を示す', () => {
    expect(INQUIRY_AUTO_REFRESH_LABEL).toBe('自動更新');
    expect(INQUIRY_AUTO_REFRESH_DESCRIPTION).toBe(
      'オンの間は30秒ごとに新しいメッセージと対応ステータスを表示します。',
    );
  });
});
