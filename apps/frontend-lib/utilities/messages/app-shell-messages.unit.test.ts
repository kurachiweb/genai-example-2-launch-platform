import { describe, expect, test } from 'bun:test';

import {
  SKIP_TO_MAIN_LABEL,
  SWITCH_TO_DARK_LABEL,
  SWITCH_TO_LIGHT_LABEL,
} from './app-shell-messages.ts';

describe('画面シェルの文言', () => {
  test('スキップリンクと配色の切替ボタンの名前は設計の文言と同じ', () => {
    expect([
      SKIP_TO_MAIN_LABEL,
      SWITCH_TO_DARK_LABEL,
      SWITCH_TO_LIGHT_LABEL,
    ]).toStrictEqual([
      '本文へ移動',
      'ダークモードに切り替え',
      'ライトモードに切り替え',
    ]);
  });

  test('操作の名前は句点の無い体言止めにする', () => {
    for (const label of [
      SKIP_TO_MAIN_LABEL,
      SWITCH_TO_DARK_LABEL,
      SWITCH_TO_LIGHT_LABEL,
    ]) {
      expect(label).not.toMatch(/(?:。|です|ます)$/u);
    }
  });

  test('配色の切替ボタンの名前は切り替え先ごとに異なる', () => {
    expect(SWITCH_TO_DARK_LABEL).not.toBe(SWITCH_TO_LIGHT_LABEL);
  });
});
