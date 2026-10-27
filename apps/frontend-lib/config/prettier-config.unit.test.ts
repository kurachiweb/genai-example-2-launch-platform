import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { format, resolveConfig } from 'prettier';

const APP_DIR = join(import.meta.dirname, '..');

const SAMPLE_FILE = join(APP_DIR, 'components/sample/sample.tsx');

describe('共通部品の整形設定', () => {
  test('ルートの設定を引き継ぎ、Tailwind CSSのクラス名を推奨の順に整列する', async () => {
    const options = await resolveConfig(SAMPLE_FILE, {
      editorconfig: false,
      useCache: false,
    });

    const formatted = await format(
      'export const Sample = () => <div className="p-4 hover:underline flex mt-2" />;\n',
      { ...options, filepath: SAMPLE_FILE },
    );

    expect(formatted).toBe(
      'export const Sample = () => <div className="mt-2 flex p-4 hover:underline" />;\n',
    );
    expect(options?.singleQuote).toBe(true);
  });
});
