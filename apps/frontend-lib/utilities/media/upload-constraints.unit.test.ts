import { describe, expect, test } from 'bun:test';

import {
  checkSelection,
  type UploadConstraints,
} from './upload-constraints.ts';

const LOGO: UploadConstraints = {
  purpose: 'product-logo',
  allowedTypes: ['image/jpeg', 'image/png', 'image/svg+xml'],
  maxBytes: 512_000,
  subjectLabel: 'ロゴ',
};

const SCREENSHOTS: UploadConstraints = {
  purpose: 'product-screenshot',
  allowedTypes: ['image/jpeg', 'image/png'],
  maxBytes: 5_242_880,
  subjectLabel: 'スクリーンショット',
  maxCount: 3,
  maxTotalBytes: 10_485_760,
  existingCount: 1,
  existingTotalBytes: 4_000_000,
};

const fileOf = (name: string, type: string, size: number) => ({
  name,
  type,
  size,
});

describe('選択の検査', () => {
  test('許可形式で上限以内のファイルは違反が無い', () => {
    expect(
      checkSelection([fileOf('logo.png', 'image/png', 512_000)], LOGO),
    ).toEqual([]);
  });

  test('許可形式に無いファイルを、ファイル名付きの形式の違反にする', () => {
    expect(
      checkSelection([fileOf('logo.gif', 'image/gif', 100)], LOGO),
    ).toEqual([{ kind: 'type', fileName: 'logo.gif' }]);
  });

  test('ブラウザが形式を判定できなかった空の形式は形式の違反にする', () => {
    expect(checkSelection([fileOf('logo', '', 100)], LOGO)).toEqual([
      { kind: 'type', fileName: 'logo' },
    ]);
  });

  test('形式は大文字小文字を区別せず、引数を除いて照合する', () => {
    expect(
      checkSelection([fileOf('logo.png', 'IMAGE/PNG; x=1', 100)], LOGO),
    ).toEqual([]);
  });

  test('上限ちょうどは受け付け、1バイト超えるとファイル名付きのサイズの違反にする', () => {
    expect(
      checkSelection(
        [
          fileOf('a.png', 'image/png', 512_000),
          fileOf('b.png', 'image/png', 512_001),
        ],
        LOGO,
      ),
    ).toEqual([{ kind: 'size', fileName: 'b.png' }]);
  });

  test('形式の違反のファイルにはサイズの違反を重ねない', () => {
    expect(
      checkSelection([fileOf('big.gif', 'image/gif', 999_999_999)], LOGO),
    ).toEqual([{ kind: 'type', fileName: 'big.gif' }]);
  });

  test('作り直す形式に指定したファイルは、選択の時点でサイズを判定しない', () => {
    expect(
      checkSelection([fileOf('photo.jpg', 'image/jpeg', 9_000_000)], LOGO, {
        editedTypes: ['image/jpeg', 'image/png'],
      }),
    ).toEqual([]);
  });

  test('作り直す形式に無いSVGは、選んだファイルのサイズで判定する', () => {
    expect(
      checkSelection([fileOf('logo.svg', 'image/svg+xml', 512_001)], LOGO, {
        editedTypes: ['image/jpeg', 'image/png'],
      }),
    ).toEqual([{ kind: 'size', fileName: 'logo.svg' }]);
  });

  test('既存の個数と合わせて上限ちょうどは受け付け、超えると個数の違反を1つだけ返す', () => {
    const small = fileOf('a.png', 'image/png', 1);

    expect(checkSelection([small, small], SCREENSHOTS)).toEqual([]);
    expect(checkSelection([small, small, small], SCREENSHOTS)).toEqual([
      { kind: 'count' },
    ]);
  });

  test('既存の合計と合わせて上限ちょうどは受け付け、超えると合計の違反を1つだけ返す', () => {
    const remaining = 10_485_760 - 4_000_000;

    expect(
      checkSelection(
        [
          fileOf('a.png', 'image/png', 5_242_880),
          fileOf('b.png', 'image/png', remaining - 5_242_880),
        ],
        SCREENSHOTS,
      ),
    ).toEqual([]);
    expect(
      checkSelection(
        [
          fileOf('a.png', 'image/png', 5_242_880),
          fileOf('b.png', 'image/png', remaining - 5_242_880 + 1),
        ],
        SCREENSHOTS,
      ),
    ).toEqual([{ kind: 'total' }]);
  });

  test('作り直す形式のファイルは、選択の時点の合計に数えない', () => {
    expect(
      checkSelection([fileOf('a.png', 'image/png', 10_485_760)], SCREENSHOTS, {
        editedTypes: ['image/png'],
      }),
    ).toEqual([]);
  });

  test('サイズの違反のファイルは合計に数えない', () => {
    expect(
      checkSelection([fileOf('a.png', 'image/png', 6_485_761)], SCREENSHOTS),
    ).toEqual([{ kind: 'size', fileName: 'a.png' }]);
  });

  test('形式の違反のファイルも個数に数え、合計には数えない', () => {
    expect(
      checkSelection(
        [
          fileOf('a.gif', 'image/gif', 10_485_760),
          fileOf('b.png', 'image/png', 1),
          fileOf('c.png', 'image/png', 1),
        ],
        SCREENSHOTS,
      ),
    ).toEqual([{ kind: 'type', fileName: 'a.gif' }, { kind: 'count' }]);
  });

  test('既存の個数と合計の指定が無ければ0とみなす', () => {
    const constraints: UploadConstraints = {
      ...LOGO,
      maxCount: 1,
      maxTotalBytes: 100,
    };

    expect(
      checkSelection([fileOf('a.png', 'image/png', 100)], constraints),
    ).toEqual([]);
  });

  test('ファイルごとの違反を選んだ順に並べ、その後に個数・合計の違反を並べる', () => {
    expect(
      checkSelection(
        [
          fileOf('a.png', 'image/png', 6_000_000),
          fileOf('b.gif', 'image/gif', 1),
          fileOf('c.png', 'image/png', 5_242_880),
          fileOf('d.png', 'image/png', 5_242_880),
        ],
        SCREENSHOTS,
      ),
    ).toEqual([
      { kind: 'size', fileName: 'a.png' },
      { kind: 'type', fileName: 'b.gif' },
      { kind: 'count' },
      { kind: 'total' },
    ]);
  });

  test('何も選ばなければ違反は無い', () => {
    expect(checkSelection([], SCREENSHOTS)).toEqual([]);
  });
});
