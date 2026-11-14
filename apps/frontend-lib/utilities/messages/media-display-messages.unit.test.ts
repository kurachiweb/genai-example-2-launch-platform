import { describe, expect, test } from 'bun:test';

import {
  IMAGE_UNAVAILABLE_TEXT,
  privateFileSizeNote,
  unavailableImageLabel,
} from './media-display-messages.ts';

describe('画像の表示とダウンロードのリンクの文言', () => {
  test('表示できない画像の案内は、状態の表示として「。」を付けない', () => {
    expect(IMAGE_UNAVAILABLE_TEXT).toBe('画像を表示できません');
  });

  test('表示できない画像の名前は、代替テキストの後に表示できないことを添える', () => {
    expect(unavailableImageLabel('Pitch Notesのスクリーンショット')).toBe(
      'Pitch Notesのスクリーンショット(画像を表示できません)',
    );
  });

  test('ダウンロードのリンクのサイズは、ファイル名に続けて括弧で示す', () => {
    expect(privateFileSizeNote(Math.round(3.4 * 1024 * 1024))).toBe('(3.4MB)');
    expect(privateFileSizeNote(2048)).toBe('(2kB)');
  });
});
