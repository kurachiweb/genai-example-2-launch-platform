import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { findRawHtmlExceptions } from '../../lib/config/raw-html-exception.ts';

const SOURCE_DIR = join(import.meta.dirname, '..', '..', 'src');

describe('生のHTMLの例外の走査', () => {
  test('アプリのsrcには生のHTMLの規則の無効化もサニタイズ済みの型への型の主張も無い', async () => {
    const { scannedPaths, exceptions } =
      await findRawHtmlExceptions(SOURCE_DIR);

    expect(scannedPaths).toContain('router.tsx');
    expect(exceptions).toStrictEqual([]);
  });
});
