import { encode } from 'uqr';
import { describe, expect, test } from 'vitest';

const TOTP_URI =
  'otpauth://totp/Example:user%40mail.example?issuer=Example&secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&algorithm=SHA1&digits=6&period=30';

const WITHOUT_BORDER = { ecc: 'M', border: 0 } as const;

// 型番ごとの1辺のセルの数は「17 + 4 × 型番」
function sizeOfVersion(version: number): number {
  return 17 + 4 * version;
}

describe('QRコードのパッケージ(Chromium)', () => {
  test('uqrがTOTPのURIを、1辺が型番に合う正方形のセルの行列にする', () => {
    const qr = encode(TOTP_URI, WITHOUT_BORDER);

    expect(qr.size).toBe(sizeOfVersion(qr.version));
    expect(qr.data).toHaveLength(qr.size);
    expect(qr.data.every((row) => row.length === qr.size)).toBe(true);
  });

  test('uqrは既定で行列の四辺に明るいセル1つ分の余白を加える', () => {
    const qr = encode(TOTP_URI, { ecc: 'M' });

    expect(qr.size).toBe(sizeOfVersion(qr.version) + 2);
    expect(qr.data[0]?.every((cell) => !cell)).toBe(true);
  });

  test('uqrの行列の3つの角に位置検出パターン(暗いセルの7×7の枠)がある', () => {
    const { data, size } = encode(TOTP_URI, WITHOUT_BORDER);
    const corners = [
      [0, 0],
      [0, size - 7],
      [size - 7, 0],
    ] as const;

    for (const [top, left] of corners) {
      const topEdge = data[top]?.slice(left, left + 7);
      const bottomEdge = data[top + 6]?.slice(left, left + 7);

      expect(topEdge).toEqual(Array.from({ length: 7 }, () => true));
      expect(bottomEdge).toEqual(Array.from({ length: 7 }, () => true));
    }
  });

  test('uqrが同じ入力から同じ行列を返す', () => {
    expect(encode(TOTP_URI, WITHOUT_BORDER).data).toEqual(
      encode(TOTP_URI, WITHOUT_BORDER).data,
    );
  });
});
