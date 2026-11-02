import { describe, expect, test } from 'bun:test';

import type { UploadConstraints } from './upload-constraints.ts';
import {
  croppedFileTooLargeMessage,
  rejectionOf,
  selectionMessagesOf,
  selectionViolationMessage,
  UPLOAD_NETWORK_ERROR_MESSAGE,
  UPLOAD_RATE_LIMITED_MESSAGE,
  UPLOAD_UNAVAILABLE_MESSAGE,
} from './upload-messages.ts';

const LOGO: UploadConstraints = {
  purpose: 'product-logo',
  allowedTypes: [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
  ],
  maxBytes: 512_000,
  subjectLabel: 'ロゴ',
};

const SCREENSHOTS: UploadConstraints = {
  purpose: 'product-screenshot',
  allowedTypes: ['image/jpeg', 'image/png'],
  maxBytes: 5_242_880,
  subjectLabel: 'スクリーンショット',
  maxCount: 20,
  maxTotalBytes: 20_971_520,
};

const ATTACHMENTS: UploadConstraints = {
  purpose: 'inquiry-attachment',
  allowedTypes: ['image/png', 'application/pdf', 'text/plain'],
  maxBytes: 10_485_760,
  subjectLabel: '添付ファイル',
  maxCount: 1_000,
  maxTotalBytes: 20_971_520,
};

describe('選択の違反の文言', () => {
  test('形式の違反は、文言規則の「ファイル形式違反」の形で許可形式を「・」で並べる', () => {
    expect(
      selectionViolationMessage({ kind: 'type', fileName: 'a.bmp' }, LOGO),
    ).toBe('JPEG・PNG・GIF・WebP・SVGの画像を選択してください。');
  });

  test('画像以外を含む用途の形式の違反は「ファイル」と書く', () => {
    expect(
      selectionViolationMessage(
        { kind: 'type', fileName: 'a.zip' },
        ATTACHMENTS,
      ),
    ).toBe('PNG・PDF・テキストのファイルを選択してください。');
  });

  test('サイズの違反は、文言規則の「ファイルサイズ超過」の形で用途と上限を書く', () => {
    expect(
      selectionViolationMessage({ kind: 'size', fileName: 'a.png' }, LOGO),
    ).toBe('ロゴは500kB以内の画像を選択してください。');
    expect(
      selectionViolationMessage(
        { kind: 'size', fileName: 'a.pdf' },
        ATTACHMENTS,
      ),
    ).toBe('添付ファイルは10MB以内のファイルを選択してください。');
  });

  test('個数の違反は、画像だけの用途は「枚」、それ以外は「個」で上限を3桁区切りで書く', () => {
    expect(selectionViolationMessage({ kind: 'count' }, SCREENSHOTS)).toBe(
      '画像は20枚以内で選択してください。',
    );
    expect(selectionViolationMessage({ kind: 'count' }, ATTACHMENTS)).toBe(
      'ファイルは1,000個以内で選択してください。',
    );
  });

  test('合計の違反は、設計のエラーの表の「合計サイズの超過」の文言にする', () => {
    expect(selectionViolationMessage({ kind: 'total' }, SCREENSHOTS)).toBe(
      'ファイルは合計20MB以内で選択してください。',
    );
  });

  test('上限の指定が無い用途の個数・合計の違反は、呼び出し元の誤りとして拒否する', () => {
    expect(() => selectionViolationMessage({ kind: 'count' }, LOGO)).toThrow(
      RangeError,
    );
    expect(() => selectionViolationMessage({ kind: 'total' }, LOGO)).toThrow(
      RangeError,
    );
  });
});

describe('編集後のサイズ超過の文言', () => {
  test('設計のエラーの表の「編集後のサイズ超過」の文言に上限を入れる', () => {
    expect(croppedFileTooLargeMessage(LOGO)).toBe(
      '編集後の画像が500kBを超えました。切り取る範囲を狭めるか、別の画像を選択してください。',
    );
  });
});

describe('選択の違反の文言の一覧', () => {
  test('違反の順に文言を並べ、同じ文言は1つにまとめる', () => {
    expect(
      selectionMessagesOf(
        [
          { kind: 'size', fileName: 'a.png' },
          { kind: 'type', fileName: 'b.bmp' },
          { kind: 'size', fileName: 'c.png' },
          { kind: 'count' },
          { kind: 'total' },
        ],
        SCREENSHOTS,
      ),
    ).toEqual([
      'スクリーンショットは5MB以内の画像を選択してください。',
      'JPEG・PNGの画像を選択してください。',
      '画像は20枚以内で選択してください。',
      'ファイルは合計20MB以内で選択してください。',
    ]);
  });

  test('作り直したファイルのサイズの違反は、編集後のサイズ超過の文言にする', () => {
    expect(
      selectionMessagesOf(
        [
          { kind: 'size', fileName: 'photo.png' },
          { kind: 'size', fileName: 'logo.svg' },
        ],
        LOGO,
        new Set(['photo.png']),
      ),
    ).toEqual([
      '編集後の画像が500kBを超えました。切り取る範囲を狭めるか、別の画像を選択してください。',
      'ロゴは500kB以内の画像を選択してください。',
    ]);
  });

  test('違反が無ければ文言も無い', () => {
    expect(selectionMessagesOf([], LOGO)).toEqual([]);
  });
});

describe('サーバーの拒否のエラーコードの文言', () => {
  test.each([
    ['unauthenticated', 'ログインし直してから、もう一度お試しください。'],
    ['upload_forbidden', 'この操作はできません。'],
    [
      'account_unavailable',
      'このアカウントは現在ご利用いただけません。詳しくはお問い合わせください。',
    ],
    [
      'email_not_verified',
      'この操作にはメールアドレスの確認が必要です。確認メールをご確認ください。',
    ],
    ['file_too_large', 'ロゴは500kB以内の画像を選択してください。'],
    [
      'unsupported_file_type',
      'JPEG・PNG・GIF・WebP・SVGの画像を選択してください。',
    ],
    [
      'unsupported_media_type',
      'JPEG・PNG・GIF・WebP・SVGの画像を選択してください。',
    ],
    ...[
      'file_type_mismatch',
      'invalid_svg',
      'invalid_text_file',
      'image_unreadable',
    ].map((code) => [
      code,
      'ファイルを読み込めませんでした。ファイルが壊れていないか確認して、もう一度選択してください。',
    ]),
    [
      'svg_declaration_not_allowed',
      'このSVGは読み込めません。編集ソフトでSVGとして書き出し直してから選択してください。',
    ],
    [
      'image_dimensions_exceeded',
      '画像の縦横の大きさが上限を超えています。小さくしてから選択してください。',
    ],
  ])(
    '%sは、選び直す拒否として設計のエラーの表の文言にする',
    (code, message) => {
      expect(rejectionOf(code, LOGO)).toEqual({ message, retryable: false });
    },
  );

  test('中継の415(unsupported_media_type)はAPIのunsupported_file_typeと同じ文言にする', () => {
    expect(rejectionOf('unsupported_media_type', ATTACHMENTS)).toEqual(
      rejectionOf('unsupported_file_type', ATTACHMENTS),
    );
  });

  test('停止中・メール未確認の拒否は、同じファイルで再試行させない', () => {
    expect(rejectionOf('account_unavailable', LOGO)?.retryable).toBe(false);
    expect(rejectionOf('email_not_verified', LOGO)?.retryable).toBe(false);
  });

  test.each([
    'content_length_required',
    'invalid_content_length',
    'content_length_mismatch',
  ])('送信の途中の失敗%sは、同じファイルで再試行できる拒否にする', (code) => {
    expect(rejectionOf(code, LOGO)).toEqual({
      message: 'ファイルを送信できませんでした。もう一度お試しください。',
      retryable: true,
    });
  });

  test('保存先の一時的な障害storage_unavailableは、同じファイルで再試行できる拒否にする', () => {
    expect(rejectionOf('storage_unavailable', LOGO)).toEqual({
      message: UPLOAD_UNAVAILABLE_MESSAGE,
      retryable: true,
    });
  });

  test.each([
    'upload_purpose_not_found',
    'csrf_rejected',
    'internal_error',
    'toString',
    '',
  ])('エラーの表で文言を作るコードに当たらないコード%pは対応が無い', (code) => {
    expect(rejectionOf(code, LOGO)).toBeUndefined();
  });
});

describe('一時的な失敗の文言', () => {
  test('一時的に利用できない時は、設計のエラーの表の503の文言にする', () => {
    expect(UPLOAD_UNAVAILABLE_MESSAGE).toBe(
      '現在ご利用いただけません。しばらく待ってから再度お試しください。',
    );
  });

  test('要求の集中は、文言規則の「レート制限(429)」の文言にする', () => {
    expect(UPLOAD_RATE_LIMITED_MESSAGE).toBe(
      '操作が集中しています。しばらく待ってから再度お試しください。',
    );
  });

  test('通信の失敗は、文言規則の共通のエラー応答の「ブラウザからの通信の失敗」の文言にする', () => {
    expect(UPLOAD_NETWORK_ERROR_MESSAGE).toBe(
      '通信に失敗しました。時間をおいて再度お試しください。',
    );
  });
});
