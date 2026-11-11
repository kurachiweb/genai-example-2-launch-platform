import { afterEach, describe, expect, mock, test } from 'bun:test';

import { writeToClipboard } from './write-to-clipboard.ts';

const stubClipboard = (clipboard: Pick<Clipboard, 'writeText'> | undefined) => {
  Object.defineProperty(navigator, 'clipboard', {
    value: clipboard,
    configurable: true,
  });
};

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
});

describe('writeToClipboard', () => {
  test('書き込めた時は文字列をそのまま渡してtrueを返す', async () => {
    const writeText = mock<Clipboard['writeText']>(() => Promise.resolve());
    stubClipboard({ writeText });

    const written = await writeToClipboard('AAAA-BBBB\nCCCC-DDDD');

    expect(written).toBe(true);
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText).toHaveBeenCalledWith('AAAA-BBBB\nCCCC-DDDD');
  });

  test('クリップボードのAPIが無い時はfalseを返す', async () => {
    stubClipboard(undefined);

    const written = await writeToClipboard('text');

    expect(written).toBe(false);
  });

  test('書き込みが拒まれた時は例外を投げずにfalseを返す', async () => {
    stubClipboard({
      writeText: () =>
        Promise.reject(new DOMException('拒否', 'NotAllowedError')),
    });

    const written = await writeToClipboard('text');

    expect(written).toBe(false);
  });
});
