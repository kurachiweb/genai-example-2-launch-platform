import { describe, expect, test } from 'bun:test';

import type { UploadErrorCode } from '../../../common-lib/media/media-error-codes.ts';
import {
  IMAGE_MEDIA_TYPES,
  IMAGE_STORAGE_MAX_BYTES,
  MAX_UPLOAD_BYTES,
} from '../../../common-lib/media/media-types.ts';
import {
  AppError,
  type AppErrorStatus,
  STATUS_BY_KIND,
} from '../errors/app-error.ts';
import { precheckUpload, type PrecheckResult } from './upload-precheck.ts';
import { defineUploadPurpose, type UploadPurpose } from './upload-purpose.ts';

const logo = defineUploadPurpose({
  name: 'product-logo',
  storage: 'images',
  uploaderKinds: ['user'],
  allowedTypes: ['image/png', 'image/jpeg', 'image/svg+xml'],
  maxBytes: 512_000,
});

const attachment = defineUploadPurpose({
  name: 'inquiry-attachment',
  storage: 'files',
  uploaderKinds: ['user'],
  allowedTypes: ['application/pdf', 'text/plain'],
  maxBytes: 10_485_760,
});

const largestFile = defineUploadPurpose({
  name: 'largest-file',
  storage: 'files',
  uploaderKinds: ['admin'],
  allowedTypes: ['application/pdf'],
  maxBytes: MAX_UPLOAD_BYTES,
});

const largestImage = defineUploadPurpose({
  name: 'largest-image',
  storage: 'images',
  uploaderKinds: ['admin'],
  allowedTypes: IMAGE_MEDIA_TYPES,
  maxBytes: IMAGE_STORAGE_MAX_BYTES,
});

const precheck = (
  purpose: UploadPurpose,
  contentLength: string | null,
  contentType: string | null,
): PrecheckResult => precheckUpload(purpose, { contentLength, contentType });

const rejectionOf = (result: PrecheckResult) => {
  if (result.ok) {
    throw new Error('拒否を期待したが受け付けられた');
  }
  return result.rejection;
};

const expectRejected = (
  result: PrecheckResult,
  status: AppErrorStatus,
  code: UploadErrorCode,
): void => {
  const rejection = rejectionOf(result);
  expect(STATUS_BY_KIND[rejection.kind]).toBe(status);
  expect(rejection.code).toBe(code);
};

describe('precheckUpload', () => {
  describe('受け付け', () => {
    test('許可形式で上限以内の要求は、申告の長さと形式を返す', () => {
      expect(precheck(logo, '1024', 'image/png')).toEqual({
        ok: true,
        declaredLength: 1024,
        mediaType: 'image/png',
      });
    });

    test('形式は引数を除き小文字にした値を返す', () => {
      expect(precheck(attachment, '10', 'Text/Plain; charset=UTF-8')).toEqual({
        ok: true,
        declaredLength: 10,
        mediaType: 'text/plain',
      });
    });

    test('1バイトの要求を受け付ける', () => {
      expect(precheck(logo, '1', 'image/jpeg')).toMatchObject({
        ok: true,
        declaredLength: 1,
      });
    });

    test('先頭に0の付いた整数を10進数として解釈する', () => {
      expect(precheck(logo, '0042', 'image/png')).toMatchObject({
        ok: true,
        declaredLength: 42,
      });
    });
  });

  describe('411: Content-Lengthが無い', () => {
    test('Content-Lengthが無ければ411のcontent_length_requiredになる', () => {
      expectRejected(
        precheck(logo, null, 'image/png'),
        411,
        'content_length_required',
      );
    });

    test('Content-Typeも無い・不正でも411を先に返す', () => {
      expectRejected(
        precheck(logo, null, null),
        411,
        'content_length_required',
      );
      expectRejected(
        precheck(logo, null, 'application/zip'),
        411,
        'content_length_required',
      );
    });
  });

  describe('400: Content-Lengthが1以上の整数でない', () => {
    test.each([
      ['0', '0'],
      ['0の連続', '000'],
      ['空の値', ''],
      ['数値でない値', 'abc'],
      ['負の値', '-1'],
      ['符号付きの値', '+1'],
      ['小数', '1.5'],
      ['指数表記', '1e3'],
      ['16進表記', '0x10'],
      ['桁区切り', '1,024'],
      ['複数の値の結合', '10, 10'],
      ['内側に空白を含む値', '1 0'],
      ['全角数字', '１０'],
      ['無限大', 'Infinity'],
    ])('%sは400のinvalid_content_lengthになる', (_label, contentLength) => {
      expectRejected(
        precheck(logo, contentLength, 'image/png'),
        400,
        'invalid_content_length',
      );
    });

    test('Content-Typeが不正でも400を415より先に返す', () => {
      expectRejected(
        precheck(logo, 'abc', 'application/zip'),
        400,
        'invalid_content_length',
      );
    });
  });

  describe('413: 上限サイズの超過', () => {
    test('用途の上限ちょうどを受け付ける', () => {
      expect(precheck(logo, '512000', 'image/png')).toMatchObject({
        ok: true,
        declaredLength: 512_000,
      });
    });

    test('用途の上限を1バイト超えると413のfile_too_largeになる', () => {
      expectRejected(
        precheck(logo, '512001', 'image/png'),
        413,
        'file_too_large',
      );
    });

    test('全用途の上限の最大値ちょうどを受け付け、1バイト超を拒否する', () => {
      expect(
        precheck(largestFile, String(MAX_UPLOAD_BYTES), 'application/pdf'),
      ).toMatchObject({ ok: true, declaredLength: 20_971_520 });
      expectRejected(
        precheck(largestFile, String(MAX_UPLOAD_BYTES + 1), 'application/pdf'),
        413,
        'file_too_large',
      );
    });

    test('画像用の上限の最大値ちょうどを受け付け、1バイト超を拒否する', () => {
      expect(
        precheck(largestImage, String(IMAGE_STORAGE_MAX_BYTES), 'image/webp'),
      ).toMatchObject({ ok: true, declaredLength: 20_000_000 });
      expectRejected(
        precheck(
          largestImage,
          String(IMAGE_STORAGE_MAX_BYTES + 1),
          'image/webp',
        ),
        413,
        'file_too_large',
      );
    });

    test('安全な整数の範囲を超える桁数の値も413になる', () => {
      expectRejected(
        precheck(logo, '9'.repeat(400), 'image/png'),
        413,
        'file_too_large',
      );
    });

    test('Content-Typeが不正でも413を415より先に返す', () => {
      expectRejected(
        precheck(logo, '512001', 'application/zip'),
        413,
        'file_too_large',
      );
    });
  });

  describe('415: 許可されない形式', () => {
    test.each([
      ['Content-Typeが無い', null],
      ['空の値', ''],
      ['未知の形式', 'application/zip'],
      ['全体では許可されるが用途で許可しない形式', 'image/gif'],
      ['画像用の用途に申告したPDF', 'application/pdf'],
    ])('%sは415のunsupported_file_typeになる', (_label, contentType) => {
      expectRejected(
        precheck(logo, '10', contentType),
        415,
        'unsupported_file_type',
      );
    });

    test('UTF-8以外の文字符号化を申告したテキストは415になる', () => {
      expectRejected(
        precheck(attachment, '10', 'text/plain; charset=Shift_JIS'),
        415,
        'unsupported_file_type',
      );
    });
  });

  describe('拒否の内容', () => {
    test('拒否は状態コードではなくAppErrorの種類で表す', () => {
      const kinds = [
        precheck(logo, null, 'image/png'),
        precheck(logo, '0', 'image/png'),
        precheck(logo, '512001', 'image/png'),
        precheck(logo, '10', 'image/gif'),
      ].map((result) => rejectionOf(result).kind);

      expect(kinds).toEqual([
        'length_required',
        'bad_request',
        'payload_too_large',
        'unsupported_media_type',
      ]);
    });

    test('Content-Lengthの不備は送信のやり直しを促す文言になる', () => {
      const message =
        'ファイルを送信できませんでした。もう一度お試しください。';

      expect(rejectionOf(precheck(logo, null, 'image/png')).message).toBe(
        message,
      );
      expect(rejectionOf(precheck(logo, 'abc', 'image/png')).message).toBe(
        message,
      );
    });

    test.each([
      [logo, '500kB以内の画像を選択してください。'],
      [attachment, '10MB以内のファイルを選択してください。'],
      [largestImage, '20,000,000バイト以内の画像を選択してください。'],
    ])('上限の超過は上限の値を示す文言になる(%#)', (purpose, message) => {
      const tooLarge = String(purpose.maxBytes + 1);

      expect(
        rejectionOf(
          precheck(purpose, tooLarge, purpose.allowedTypes[0] ?? null),
        ).message,
      ).toBe(message);
    });

    test.each([
      [logo, 'PNG・JPEG・SVGの画像を選択してください。'],
      [attachment, 'PDF・テキストのファイルを選択してください。'],
    ])(
      '許可されない形式は用途の形式の一覧を示す文言になる(%#)',
      (purpose, message) => {
        expect(
          rejectionOf(precheck(purpose, '10', 'application/zip')).message,
        ).toBe(message);
      },
    );

    test('拒否からそのままAppErrorを作れる', () => {
      const error = new AppError(
        rejectionOf(precheck(logo, null, 'image/png')),
      );

      expect(error.kind).toBe('length_required');
      expect(error.code).toBe('content_length_required');
    });

    test('事前検証の拒否は再試行の秒数を持たない', () => {
      expect(
        rejectionOf(precheck(logo, '512001', 'image/png')).retryAfterSeconds,
      ).toBeUndefined();
    });
  });
});
