import { describe, expect, test } from 'bun:test';

import {
  type ContractViolation,
  formatViolationMarkdown,
  formatViolationTable,
} from './violation.ts';

const R2_JURISDICTION: ContractViolation = {
  rule: 'C3',
  file: 'apps/api/wrangler.jsonc',
  path: 'env.staging.r2_buckets[IMAGES_BUCKET].jurisdiction',
  actual: '',
  expected: 'us',
};

const UNPINNED_ACTION: ContractViolation = {
  rule: 'W1',
  file: '.github/workflows/checks.yml',
  path: 'jobs.quality.steps[0].uses',
  actual: 'actions/checkout@v4',
  expected: 'コミットSHA(40桁)で固定した参照',
};

describe('formatViolationTable', () => {
  test('件数と、規則・ファイル・項目・実際・期待の見出しと各違反の行を、列をそろえて返す', () => {
    const table = formatViolationTable([R2_JURISDICTION, UNPINNED_ACTION]);

    const lines = table.trimEnd().split('\n');
    expect(lines[0]).toBe('違反が2件あります。');
    expect(lines[1]?.split(/\s{2,}/)).toEqual([
      '規則',
      'ファイル',
      '項目',
      '実際',
      '期待',
    ]);
    expect(lines[2]?.split(/\s{2,}/)).toEqual([
      'C3',
      'apps/api/wrangler.jsonc',
      'env.staging.r2_buckets[IMAGES_BUCKET].jurisdiction',
      '(なし)',
      'us',
    ]);
    expect(lines[3]?.split(/\s{2,}/)).toEqual([
      'W1',
      '.github/workflows/checks.yml',
      'jobs.quality.steps[0].uses',
      'actions/checkout@v4',
      'コミットSHA(40桁)で固定した参照',
    ]);
    const columnStarts = lines.slice(1).map((line) => {
      const pathColumn = line.split(/\s{2,}/)[2] ?? '';
      return Bun.stringWidth(line.slice(0, line.indexOf(pathColumn)));
    });
    expect(new Set(columnStarts).size).toBe(1);
  });

  test('値の改行は1行の表示を崩さないよう\\nと表記する', () => {
    const table = formatViolationTable([
      { ...UNPINNED_ACTION, actual: 'a\nb' },
    ]);

    expect(table).toContain(String.raw`a\nb`);
    expect(table.trimEnd().split('\n')).toHaveLength(3);
  });

  test('違反が無ければ違反が無い旨だけを返す', () => {
    expect(formatViolationTable([])).toBe('違反はありません。\n');
  });
});

describe('formatViolationMarkdown', () => {
  test('見出しと、規則・ファイル・項目・実際・期待の表を返す', () => {
    const markdown = formatViolationMarkdown('構成検査', [R2_JURISDICTION]);

    expect(markdown).toBe(
      [
        '### 構成検査',
        '',
        '違反が1件あります。',
        '',
        '| 規則 | ファイル | 項目 | 実際 | 期待 |',
        '| --- | --- | --- | --- | --- |',
        '| C3 | apps/api/wrangler.jsonc | env.staging.r2_buckets[IMAGES_BUCKET].jurisdiction | (なし) | us |',
        '',
      ].join('\n'),
    );
  });

  test('表の区切りの縦線と改行を値から取り除いて表を崩さない', () => {
    const markdown = formatViolationMarkdown('ワークフローの検査', [
      { ...UNPINNED_ACTION, actual: 'a|b\nc' },
    ]);

    expect(markdown).toContain(String.raw`| a\|b<br>c |`);
  });

  test('違反が無ければ見出しと違反が無い旨を返す', () => {
    expect(formatViolationMarkdown('構成検査', [])).toBe(
      '### 構成検査\n\n違反はありません。\n',
    );
  });
});
