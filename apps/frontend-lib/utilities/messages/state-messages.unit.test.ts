import { describe, expect, test } from 'bun:test';

import {
  CONTACT_GUIDANCE,
  CONTACT_LABEL,
  LOADING_LABEL,
  NOT_FOUND_DESCRIPTION,
  NOT_FOUND_TITLE,
  RETRY_GUIDANCE,
  RETRY_LABEL,
  RETRY_LATER_GUIDANCE,
  UNAVAILABLE_TITLE,
  UNEXPECTED_ERROR_MESSAGE,
  UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT,
  UNEXPECTED_ERROR_TITLE,
} from './state-messages.ts';

describe('状態表示の文言', () => {
  test('存在しないページの見出しと説明をつなげると、文言規則の表の404の文言になる', () => {
    expect(`${NOT_FOUND_TITLE}${NOT_FOUND_DESCRIPTION}`).toBe(
      'ページが見つかりません。お探しのページは見つかりませんでした。URLをご確認ください。',
    );
  });

  test('再試行の案内は、時間をおいた再試行の案内と問い合わせの案内をつなげたもの', () => {
    expect(RETRY_LATER_GUIDANCE).toBe('時間をおいて再度お試しください。');
    expect(CONTACT_GUIDANCE).toBe('解決しない場合はお問い合わせください。');
    expect(RETRY_GUIDANCE).toBe(`${RETRY_LATER_GUIDANCE}${CONTACT_GUIDANCE}`);
  });

  test('想定外のエラーの文言は、静的なエラー画面と同じ設計の定数で、見出しと再試行の案内をつなげたもの', () => {
    expect(UNEXPECTED_ERROR_MESSAGE).toBe(
      'ページを表示できませんでした。時間をおいて再度お試しください。解決しない場合はお問い合わせください。',
    );
    expect(UNEXPECTED_ERROR_MESSAGE).toBe(
      `${UNEXPECTED_ERROR_TITLE}${RETRY_GUIDANCE}`,
    );
  });

  test('問い合わせの導線が無い側の想定外のエラーの文言は、見出しと時間をおいた再試行の案内だけで、問い合わせを促さない', () => {
    expect(UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT).toBe(
      'ページを表示できませんでした。時間をおいて再度お試しください。',
    );
    expect(UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT).toBe(
      `${UNEXPECTED_ERROR_TITLE}${RETRY_LATER_GUIDANCE}`,
    );
    expect(UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT).not.toContain(
      '問い合わせ',
    );
  });

  test('縮退運転中の表示は、文言規則の表の書き出しの「現在ご利用いただけません。」で始まる', () => {
    expect(UNAVAILABLE_TITLE).toBe('現在ご利用いただけません。');
  });

  test('エラーと案内の文言はすべて「です・ます」調で末尾に「。」を持つ', () => {
    for (const message of [
      NOT_FOUND_TITLE,
      NOT_FOUND_DESCRIPTION,
      UNEXPECTED_ERROR_TITLE,
      RETRY_GUIDANCE,
      RETRY_LATER_GUIDANCE,
      CONTACT_GUIDANCE,
      UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT,
      UNAVAILABLE_TITLE,
    ]) {
      expect(message).toMatch(/(?:ください|ません|でした)。$/u);
    }
  });

  test('操作と読み込み中の名前は、句点の無い短い語にする', () => {
    expect([LOADING_LABEL, RETRY_LABEL, CONTACT_LABEL]).toStrictEqual([
      '読み込み中',
      '再試行',
      'お問い合わせ',
    ]);
  });
});
