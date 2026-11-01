import { describe, expect, test } from 'bun:test';

import type { UploadedFile } from '../../../common-lib/media/upload-protocol.ts';
import {
  UNEXPECTED_ERROR_MESSAGE,
  UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT,
} from '../messages/state-messages.ts';
import type { UploadConstraints } from './upload-constraints.ts';
import {
  UPLOAD_NETWORK_ERROR_MESSAGE,
  UPLOAD_RATE_LIMITED_MESSAGE,
  UPLOAD_UNAVAILABLE_MESSAGE,
} from './upload-messages.ts';
import {
  buildUploadRequest,
  parseUploadResponse,
  sendUpload,
  UnexpectedUploadResponseError,
  type UploadFetch,
  type UploadResult,
} from './upload-request.ts';

const LOGO: UploadConstraints = {
  purpose: 'product-logo',
  allowedTypes: ['image/png', 'image/svg+xml'],
  maxBytes: 512_000,
  subjectLabel: 'ロゴ',
};

const UPLOADED: UploadedFile = {
  fileId: '01JBXYZ0000000000000000000',
  originalFileName: 'ロゴ.png',
  contentType: 'image/png',
  byteSize: 1234,
  width: 256,
  height: 256,
  objectKey: '0123456789abcdef'.repeat(2),
};

const CLIENT_CONTEXT = { constraints: LOGO, contactAvailable: true } as const;

const ADMIN_CONTEXT = { constraints: LOGO, contactAvailable: false } as const;

const errorBody = (code: string): string =>
  JSON.stringify({ error: { code, message: 'サーバーの文言' } });

const parse = (
  status: number,
  body: string,
  context: typeof CLIENT_CONTEXT | typeof ADMIN_CONTEXT = CLIENT_CONTEXT,
): UploadResult => parseUploadResponse({ status, body }, context);

describe('送信の組み立て', () => {
  test('用途名を百分率符号化した中継の経路へ、同じオリジンの資格情報付きでPOSTする', () => {
    const request = buildUploadRequest({
      purpose: 'a/b c',
      body: new Blob(['x']),
      contentType: 'image/png',
      fileName: 'logo.png',
    });

    expect(request.path).toBe('/_bff/uploads/a%2Fb%20c');
    expect(request.init.method).toBe('POST');
    expect(request.init.credentials).toBe('same-origin');
  });

  test('Content-Typeは確定した形式を引数なしで送り、本文のBlobの形式の引数で上書きされない', async () => {
    const body = new Blob(['本文'], { type: 'text/plain;charset=utf-8' });
    const { path, init } = buildUploadRequest({
      purpose: 'inquiry-attachment',
      body,
      contentType: 'text/plain',
      fileName: 'memo.txt',
    });

    const request = new Request(`https://client.example${path}`, init);

    expect(request.headers.get('content-type')).toBe('text/plain');
    expect(await request.text()).toBe('本文');
  });

  test('ファイル名は百分率符号化した項目で送る', () => {
    const { init } = buildUploadRequest({
      purpose: 'product-logo',
      body: new Blob(['x']),
      contentType: 'image/png',
      fileName: 'ロゴ 1.png',
    });

    expect(new Headers(init.headers).get('x-upload-file-name')).toBe(
      encodeURIComponent('ロゴ 1.png'),
    );
  });
});

describe('応答の解析', () => {
  test('201の本文のdataをアップロード済みのファイルとして返す', () => {
    expect(parse(201, JSON.stringify({ data: UPLOADED }))).toEqual({
      ok: true,
      file: UPLOADED,
    });
  });

  test('寸法と画像のキーが無いファイルも受け取る', () => {
    const attachment: UploadedFile = {
      ...UPLOADED,
      contentType: 'application/pdf',
      width: null,
      height: null,
      objectKey: null,
    };

    expect(parse(201, JSON.stringify({ data: attachment }))).toEqual({
      ok: true,
      file: attachment,
    });
  });

  test('サーバーの拒否はエラーコードの文言にし、選び直す状態にする', () => {
    expect(parse(413, errorBody('file_too_large'))).toEqual({
      ok: false,
      message: 'ロゴは500kB以内の画像を選択してください。',
      retryable: false,
      unexpectedError: undefined,
    });
  });

  test('中継の415(unsupported_media_type)はAPIの415(unsupported_file_type)と同じ文言にする', () => {
    expect(parse(415, errorBody('unsupported_media_type'))).toEqual(
      parse(415, errorBody('unsupported_file_type')),
    );
    expect(parse(415, errorBody('unsupported_media_type'))).toMatchObject({
      message: 'PNG・SVGの画像を選択してください。',
    });
  });

  test.each([
    [
      'account_unavailable',
      'このアカウントは現在ご利用いただけません。詳しくはお問い合わせください。',
    ],
    [
      'email_not_verified',
      'この操作にはメールアドレスの確認が必要です。確認メールをご確認ください。',
    ],
  ])(
    '403の%sは文言規則の既存の文言にし、再試行できない拒否にする',
    (code, message) => {
      expect(parse(403, errorBody(code))).toEqual({
        ok: false,
        message,
        retryable: false,
        unexpectedError: undefined,
      });
    },
  );

  test.each([
    'storage_unavailable',
    'upstream_unavailable',
    'upstream_timeout',
  ])(
    '503(%s)は一時的に利用できない文言で、同じファイルで再試行できる',
    (code) => {
      expect(parse(503, errorBody(code))).toEqual({
        ok: false,
        message: UPLOAD_UNAVAILABLE_MESSAGE,
        retryable: true,
        unexpectedError: undefined,
      });
    },
  );

  test('本文を解釈できない503も一時的に利用できない扱いにする', () => {
    expect(parse(503, '<html>')).toMatchObject({
      message: UPLOAD_UNAVAILABLE_MESSAGE,
      retryable: true,
    });
  });

  test('429は要求の集中の文言で、同じファイルで再試行できる', () => {
    expect(parse(429, errorBody('rate_limit_exceeded'))).toEqual({
      ok: false,
      message: UPLOAD_RATE_LIMITED_MESSAGE,
      retryable: true,
      unexpectedError: undefined,
    });
  });

  describe('想定外の応答', () => {
    const UNEXPECTED_CASES: readonly (readonly [string, number, string])[] = [
      ['用途が未登録', 404, errorBody('upload_purpose_not_found')],
      ['エラーの表に無いコード', 403, errorBody('csrf_rejected')],
      ['エラーの表に無い状態コード', 500, errorBody('internal_error')],
      ['解釈できない本文', 400, 'not json'],
      ['エラーの形でない本文', 400, JSON.stringify({ message: 'x' })],
      ['201でない成功', 200, JSON.stringify({ data: UPLOADED })],
      ['dataの無い201', 201, JSON.stringify({})],
      [
        '形式が許可の一覧に無い201',
        201,
        JSON.stringify({ data: { ...UPLOADED, contentType: 'image/bmp' } }),
      ],
      [
        '形式に引数が付いた201',
        201,
        JSON.stringify({
          data: { ...UPLOADED, contentType: 'text/plain; charset=utf-8' },
        }),
      ],
      [
        'バイト数が整数でない201',
        201,
        JSON.stringify({ data: { ...UPLOADED, byteSize: 1.5 } }),
      ],
    ];

    test.each(UNEXPECTED_CASES)(
      '%sは、問い合わせの導線がある側でUNEXPECTED_ERROR_MESSAGEにする',
      (_, status, body) => {
        expect(parse(status, body, CLIENT_CONTEXT)).toMatchObject({
          ok: false,
          message: UNEXPECTED_ERROR_MESSAGE,
          retryable: false,
        });
      },
    );

    test.each(UNEXPECTED_CASES)(
      '%sは、問い合わせの導線が無い側でUNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACTにする',
      (_, status, body) => {
        expect(parse(status, body, ADMIN_CONTEXT)).toMatchObject({
          ok: false,
          message: UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT,
          retryable: false,
        });
      },
    );

    test('エラートラッキングへ送れるよう、状態コードとエラーコードを持つ例外を添える', () => {
      const result = parse(404, errorBody('upload_purpose_not_found'));

      expect(result.ok).toBe(false);
      const error = result.ok ? undefined : result.unexpectedError;
      expect(error).toBeInstanceOf(UnexpectedUploadResponseError);
      expect(error).toBeInstanceOf(Error);
      expect(error?.status).toBe(404);
      expect(error?.code).toBe('upload_purpose_not_found');
      expect(error?.message).not.toContain('サーバーの文言');
    });

    test('エラーの形でない本文の例外はエラーコードを持たない', () => {
      const result = parse(500, 'not json');

      expect(result.ok ? undefined : result.unexpectedError?.code).toBe(
        undefined,
      );
    });
  });
});

describe('送信', () => {
  const INPUT = {
    purpose: 'product-logo',
    body: new Blob(['x']),
    contentType: 'image/png',
    fileName: 'logo.png',
  } as const;

  test('組み立てた要求を注入したfetchで送り、応答を解析する', async () => {
    const calls: { input: string; init: RequestInit }[] = [];
    const fetchFunction: UploadFetch = (input, init) => {
      calls.push({ input, init });
      return Promise.resolve(
        new Response(JSON.stringify({ data: UPLOADED }), { status: 201 }),
      );
    };

    const result = await sendUpload(fetchFunction, INPUT, CLIENT_CONTEXT);

    expect(result).toEqual({ ok: true, file: UPLOADED });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe('/_bff/uploads/product-logo');
    expect(new Headers(calls[0]?.init.headers).get('content-type')).toBe(
      'image/png',
    );
  });

  test('通信の失敗は、通信の失敗の文言で同じファイルで再試行できる', async () => {
    const result = await sendUpload(
      () => Promise.reject(new TypeError('Failed to fetch')),
      INPUT,
      CLIENT_CONTEXT,
    );

    expect(result).toEqual({
      ok: false,
      message: UPLOAD_NETWORK_ERROR_MESSAGE,
      retryable: true,
      unexpectedError: undefined,
    });
  });

  test('本文の読み取りの途中の失敗も通信の失敗にする', async () => {
    const body = new ReadableStream({
      pull(controller) {
        controller.error(new TypeError('network'));
      },
    });

    const result = await sendUpload(
      () => Promise.resolve(new Response(body, { status: 201 })),
      INPUT,
      CLIENT_CONTEXT,
    );

    expect(result).toMatchObject({
      message: UPLOAD_NETWORK_ERROR_MESSAGE,
      retryable: true,
    });
  });

  test('呼び出し元の中断は通信の失敗にせず、中断の理由をそのまま投げる', async () => {
    const controller = new AbortController();
    const reason = new DOMException('中断', 'AbortError');
    const fetchFunction: UploadFetch = (_, init) => {
      expect(init.signal).toBe(controller.signal);
      controller.abort(reason);
      return Promise.reject(reason);
    };

    const rejected = await sendUpload(fetchFunction, INPUT, {
      ...CLIENT_CONTEXT,
      signal: controller.signal,
    }).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(rejected).toBe(reason);
  });
});
