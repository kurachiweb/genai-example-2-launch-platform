import { describe, expect, test } from 'bun:test';

import {
  API_SERVER_TIME_LABEL,
  API_UNREACHABLE_MESSAGE,
  BROWSER_RESULT_HEADING,
  DATABASE_LABEL,
  DATABASE_REACHABLE_LABEL,
  DATABASE_UNREACHABLE_LABEL,
  RECHECK_GUIDANCE,
  RECHECK_LABEL,
  RECHECKING_LABEL,
  SERVER_RESULT_HEADING,
  SYSTEM_STATUS_TITLE,
} from './system-status-messages.ts';

describe('疎通確認の文言', () => {
  test('項目と状態の名前は設計の文言と同じ', () => {
    expect([
      API_SERVER_TIME_LABEL,
      DATABASE_LABEL,
      DATABASE_REACHABLE_LABEL,
      DATABASE_UNREACHABLE_LABEL,
      RECHECK_LABEL,
    ]).toStrictEqual([
      'APIサーバーの時刻',
      'データベース',
      '到達可能',
      '到達できません',
      '再確認',
    ]);
  });

  test('APIサーバーへ到達できない時の文言は、エラーとして「です・ます」調で末尾に「。」を持つ', () => {
    expect(API_UNREACHABLE_MESSAGE).toBe('APIサーバーへ到達できません。');
  });

  test('案内の文言は「です・ます」調で末尾に「。」を持つ', () => {
    expect(RECHECK_GUIDANCE).toMatch(/ます。$/u);
  });

  test('見出し・項目・操作・処理中の名前は、句点の無い体言止めにする', () => {
    for (const label of [
      SYSTEM_STATUS_TITLE,
      SERVER_RESULT_HEADING,
      BROWSER_RESULT_HEADING,
      API_SERVER_TIME_LABEL,
      DATABASE_LABEL,
      RECHECK_LABEL,
      RECHECKING_LABEL,
    ]) {
      expect(label).not.toMatch(/(?:。|です|ます)$/u);
    }
  });

  test('サーバー側の描画時とブラウザからの再確認の見出しは互いに異なる', () => {
    expect(SERVER_RESULT_HEADING).not.toBe(BROWSER_RESULT_HEADING);
  });
});
