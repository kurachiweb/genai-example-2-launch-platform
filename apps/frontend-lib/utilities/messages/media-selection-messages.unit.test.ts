import { describe, expect, test } from 'bun:test';

import {
  FILE_DROP_ACTIVE_HINT,
  FILE_DROP_HINT,
  fileSelectionAnnouncement,
  SELECTED_FILES_LABEL,
  UNKNOWN_FILE_TYPE_LABEL,
} from './media-selection-messages.ts';

describe('ファイルの選択の文言', () => {
  test('案内は文末に「。」を付け、名前とラベルは体言止めにする', () => {
    expect(FILE_DROP_HINT).toBe('ここにドラッグ&ドロップしても選択できます。');
    expect(FILE_DROP_ACTIVE_HINT).toBe('ここでドロップすると選択できます。');
    expect(SELECTED_FILES_LABEL).toBe('選択したファイル');
    expect(UNKNOWN_FILE_TYPE_LABEL).toBe('不明な形式');
  });

  test('1件の選択は、ファイル名を選んだことを伝える', () => {
    expect(fileSelectionAnnouncement(['logo.png'])).toBe(
      'logo.pngを選択しました。',
    );
  });

  test('複数の選択は、ファイル名を「、」でつなぎ、件数を3桁区切りで添える', () => {
    expect(fileSelectionAnnouncement(['a.png', 'b.pdf'])).toBe(
      'a.png、b.pdfの2件を選択しました。',
    );
    expect(
      fileSelectionAnnouncement(
        Array.from({ length: 1000 }, (_, index) => `${String(index)}.txt`),
      ),
    ).toMatch(/の1,000件を選択しました。$/u);
  });

  test('選んだファイルが無いときは何も伝えない', () => {
    expect(fileSelectionAnnouncement([])).toBe('');
  });
});
