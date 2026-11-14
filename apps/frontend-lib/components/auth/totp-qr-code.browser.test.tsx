import { encode } from 'uqr';
import { afterEach, describe, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles/base.css';
import { runAxe } from '../../test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
  tokenColorOf,
} from '../../test/computed-style.ts';
import { TOTP_QR_CODE_LABEL } from '../../utilities/messages/auth-messages.ts';
import { TotpQrCode } from './totp-qr-code.tsx';

// 秘密鍵らしい文字列をソースに書かないよう、Base32の秘密鍵は実行時に組み立てる
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const SAMPLE_KEY = Array.from(
  { length: 32 },
  (_, index) => BASE32_ALPHABET[(index * 7) % BASE32_ALPHABET.length],
).join('');

const totpUriOf = (account: string): string =>
  `otpauth://totp/Example:${encodeURIComponent(account)}?issuer=Example&secret=${SAMPLE_KEY}&algorithm=SHA1&digits=6&period=30`;

const TOTP_URI = totpUriOf('user@mail.example');

const LABEL = TOTP_QR_CODE_LABEL;

// QRコードの規格が求める四辺の余白のセルの数
const MINIMUM_QUIET_ZONE = 4;

const RUN_PATTERN = /M(\d+) (\d+)h(\d+)v1h-\d+z/gy;

const qrCode = () => page.getByRole('img', { name: LABEL });

const darkCellsOfPath = (d: string): Set<string> => {
  const cells = new Set<string>();
  let consumed = 0;
  for (const match of d.matchAll(RUN_PATTERN)) {
    const [whole, x, y, length] = match;
    consumed += whole.length;
    for (let offset = 0; offset < Number(length); offset += 1) {
      cells.add(`${String(Number(x) + offset)},${String(Number(y))}`);
    }
  }
  expect(consumed).toBe(d.length);
  return cells;
};

const darkCellsOfMatrix = (uri: string, quietZone: number): Set<string> => {
  const { data } = encode(uri, { ecc: 'M', border: 0 });
  const cells = new Set<string>();
  data.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) {
        cells.add(`${String(x + quietZone)},${String(y + quietZone)}`);
      }
    });
  });
  return cells;
};

interface DrawnQrCode {
  readonly viewBoxSize: number;
  readonly quietZone: number;
  readonly darkCells: Set<string>;
}

const drawnQrCodeOf = (svg: Element): DrawnQrCode => {
  const viewBox = svg.getAttribute('viewBox')?.split(' ').map(Number) ?? [];
  const [minX, minY, width, height] = viewBox;
  expect([minX, minY]).toStrictEqual([0, 0]);
  expect(width).toBe(height);
  const viewBoxSize = width ?? 0;
  const matrixSize = encode(TOTP_URI, { ecc: 'M', border: 0 }).size;
  const path = svg.querySelector('path');
  expect(path).not.toBeNull();
  return {
    viewBoxSize,
    quietZone: (viewBoxSize - matrixSize) / 2,
    darkCells: darkCellsOfPath(path?.getAttribute('d') ?? ''),
  };
};

afterEach(() => {
  applyColorScheme('light');
});

describe('TotpQrCode', () => {
  test('URIのQRコードを、名前を持つ画像のSVGとして描画する', async () => {
    await render(<TotpQrCode uri={TOTP_URI} label={LABEL} />);

    await expect.element(qrCode()).toBeVisible();
    expect(qrCode().element().tagName.toLowerCase()).toBe('svg');
  });

  test('暗いセルの位置が、URIから作ったQRコードの行列と一致する', async () => {
    await render(<TotpQrCode uri={TOTP_URI} label={LABEL} />);
    const { quietZone, darkCells } = drawnQrCodeOf(qrCode().element());

    expect(darkCells).toStrictEqual(darkCellsOfMatrix(TOTP_URI, quietZone));
  });

  test('四辺に規格どおり4セル以上の明るい余白を取る', async () => {
    await render(<TotpQrCode uri={TOTP_URI} label={LABEL} />);
    const { viewBoxSize, quietZone, darkCells } = drawnQrCodeOf(
      qrCode().element(),
    );

    expect(Number.isInteger(quietZone)).toBe(true);
    expect(quietZone).toBeGreaterThanOrEqual(MINIMUM_QUIET_ZONE);
    const outside = [...darkCells].filter((cell) => {
      const [x, y] = cell.split(',').map(Number);
      return [x, y].some(
        (value) =>
          value === undefined ||
          value < quietZone ||
          value >= viewBoxSize - quietZone,
      );
    });
    expect(outside).toStrictEqual([]);
  });

  test('URIが変わると描画し直す', async () => {
    const other = totpUriOf('other@mail.example');
    const { rerender } = await render(
      <TotpQrCode uri={TOTP_URI} label={LABEL} />,
    );
    const before = qrCode().element().querySelector('path')?.getAttribute('d');

    await rerender(<TotpQrCode uri={other} label={LABEL} />);
    const after = qrCode().element().querySelector('path')?.getAttribute('d');

    expect(after).not.toBe(before);
  });

  test('読み取れるよう、配色によらず明るい地に暗いセルを描く', async () => {
    const colors: string[][] = [];
    for (const scheme of COLOR_SCHEMES) {
      applyColorScheme(scheme);
      const { unmount } = await render(
        <TotpQrCode uri={TOTP_URI} label={LABEL} />,
      );
      const svg = qrCode().element();
      const background = svg.querySelector('rect');
      const cells = svg.querySelector('path');
      expect(background).not.toBeNull();
      expect(cells).not.toBeNull();
      colors.push([
        getComputedStyle(background ?? svg).fill,
        getComputedStyle(cells ?? svg).fill,
      ]);
      await unmount();
    }

    applyColorScheme('light');
    const expected = [
      tokenColorOf('qr-code-background'),
      tokenColorOf('qr-code'),
    ];
    expect(colors).toStrictEqual(COLOR_SCHEMES.map(() => expected));
  });

  test('受け取ったクラス名で大きさを変えられる', async () => {
    await render(
      <TotpQrCode uri={TOTP_URI} label={LABEL} className="size-64" />,
    );

    expect(qrCode().element().getBoundingClientRect().width).toBe(256);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await render(
        <div className="bg-background p-4 text-foreground">
          <TotpQrCode uri={TOTP_URI} label={LABEL} />
        </div>,
      );

      expect(await runAxe(container)).toStrictEqual([]);
    });
  });
});
