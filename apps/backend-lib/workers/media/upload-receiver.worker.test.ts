import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { DIMENSION_PREFIX_BYTES } from '../../core/media/image-dimensions.ts';
import { MODERATE_IMAGE_MESSAGE } from '../../core/media/media-messages.ts';
import type { UploadInput } from '../../core/media/ports.ts';
import { MEDIA_SMOKE_PURPOSE } from '../../core/media/upload-purpose.ts';
import {
  acceptedFileOf,
  chunksOf,
  clearMediaState,
  concatBytes,
  createReceiver,
  createRecordingQueue,
  expectNothingStored,
  FILE_PURPOSE,
  IMAGE_PURPOSE,
  jpegPrefixBytes,
  OBJECT_KEY_PATTERN,
  pdfBytes,
  pngBytes,
  readObject,
  readRecord,
  recordLogs,
  rejectionOf,
  resetLogging,
  streamOf,
  svgBytes,
  trackedStreamOf,
  ULID_PATTERN,
  uploadInputOf,
  USER_ID,
  utf8,
} from './testing/upload-receiver-fixtures.ts';

const RESEND_MESSAGE =
  'ファイルを送信できませんでした。もう一度お試しください。';

const UNREADABLE_MESSAGE =
  'ファイルを読み込めませんでした。ファイルが壊れていないか確認して、もう一度選択してください。';

beforeEach(async () => {
  await clearMediaState();
});

afterEach(() => {
  resetLogging();
});

describe('MediaUploadReceiverの受付', () => {
  test('画像用の用途のPNGを画像用非公開バケットへ保存し、記録を完了させて判定を依頼し、201の結果を返す', async () => {
    const { queue, sent } = createRecordingQueue();
    const bytes = pngBytes(640, 480, 200);

    const file = acceptedFileOf(
      await createReceiver({ queue }).receive(
        uploadInputOf(bytes, {
          fileNameHeader: encodeURIComponent('../夏の 写真.png'),
        }),
      ),
    );

    expect(file).toEqual({
      fileId: expect.stringMatching(ULID_PATTERN) as unknown,
      originalFileName: '夏の 写真.png',
      contentType: 'image/png',
      byteSize: 200,
      width: 640,
      height: 480,
      objectKey: expect.stringMatching(OBJECT_KEY_PATTERN) as unknown,
    });
    expect(await readRecord(file.fileId)).toMatchObject({
      objectKey: file.objectKey,
      purpose: IMAGE_PURPOSE.name,
      storage: 'images',
      location: 'images',
      ownerKind: 'user',
      ownerId: USER_ID,
      originalFileName: file.originalFileName,
      contentType: 'image/png',
      byteSize: 200,
      width: 640,
      height: 480,
      storedAt: expect.any(Date) as unknown,
      attachedAt: null,
      moderationStatus: 'pending',
    });
    const stored = await readObject('images', file.objectKey ?? '');
    expect(stored?.httpMetadata).toEqual({ contentType: 'image/png' });
    expect(new Uint8Array((await stored?.arrayBuffer()) ?? [])).toEqual(bytes);
    expect(sent).toEqual([
      expect.objectContaining({
        type: MODERATE_IMAGE_MESSAGE.type,
        body: { fileId: file.fileId },
      }),
    ]);
  });

  test('ファイル用の用途のPDFは添付として保存し、判定を依頼せず、オブジェクトキーを返さない', async () => {
    const { queue, sent } = createRecordingQueue();

    const file = acceptedFileOf(
      await createReceiver({ queue }).receive(
        uploadInputOf(pdfBytes(), {
          purpose: FILE_PURPOSE,
          contentType: 'application/pdf',
          fileNameHeader: encodeURIComponent('報告書.pdf'),
        }),
      ),
    );

    expect(file).toMatchObject({
      originalFileName: '報告書.pdf',
      contentType: 'application/pdf',
      byteSize: pdfBytes().length,
      width: null,
      height: null,
      objectKey: null,
    });
    const record = await readRecord(file.fileId);
    expect(record).toMatchObject({
      storage: 'files',
      location: 'files',
      moderationStatus: 'not_required',
      storedAt: expect.any(Date) as unknown,
    });
    const stored = await readObject('files', record?.objectKey ?? '');
    expect(stored?.httpMetadata).toEqual({
      contentType: 'application/pdf',
      contentDisposition: `attachment; filename="___.pdf"; filename*=UTF-8''${encodeURIComponent('報告書.pdf')}`,
      cacheControl: 'private, no-store',
    });
    expect(sent).toEqual([]);
  });

  test('ファイル用の用途の画像は寸法を記録し、ファイル用非公開バケットへ判定の依頼無しで保存する', async () => {
    const { queue, sent } = createRecordingQueue();

    const file = acceptedFileOf(
      await createReceiver({ queue }).receive(
        uploadInputOf(pngBytes(32, 16), { purpose: FILE_PURPOSE }),
      ),
    );

    expect(file).toMatchObject({ width: 32, height: 16, objectKey: null });
    const record = await readRecord(file.fileId);
    expect(record).toMatchObject({
      storage: 'files',
      moderationStatus: 'not_required',
    });
    expect(
      (await readObject('files', record?.objectKey ?? ''))?.httpMetadata,
    ).toMatchObject({
      contentType: 'image/png',
      cacheControl: 'private, no-store',
    });
    expect(sent).toEqual([]);
  });

  test('テキストは塊の境界で分かれた文字を含めて流しながら検査し、文字コード付きの形式で記録する', async () => {
    const text = utf8('こんにちは\n2行目\n');
    const body = streamOf(text.subarray(0, 4), text.subarray(4));

    const file = acceptedFileOf(
      await createReceiver().receive(
        uploadInputOf(body, {
          purpose: FILE_PURPOSE,
          contentType: 'text/plain; charset=UTF-8',
          contentLength: String(text.length),
          fileNameHeader: null,
        }),
      ),
    );

    expect(file).toMatchObject({
      originalFileName: 'text.txt',
      contentType: 'text/plain',
      byteSize: text.length,
    });
    const record = await readRecord(file.fileId);
    expect(record?.contentType).toBe('text/plain; charset=utf-8');
    const stored = await readObject('files', record?.objectKey ?? '');
    expect(stored?.httpMetadata?.contentType).toBe('text/plain; charset=utf-8');
    expect(await stored?.text()).toBe('こんにちは\n2行目\n');
  });

  test.each([
    ['幅と高さ', 'width="120" height="80"', 120, 80],
    ['表示領域だけ', 'viewBox="0 0 30 20"', 30, 20],
    ['寸法なし', '', null, null],
  ])(
    'SVGは全体を検査し、%sから寸法を記録する',
    async (_, attributes, width, height) => {
      const bytes = svgBytes(attributes);

      const file = acceptedFileOf(
        await createReceiver().receive(
          uploadInputOf(streamOf(...chunksOf(bytes, 7)), {
            contentType: 'image/svg+xml',
            contentLength: String(bytes.length),
          }),
        ),
      );

      expect(file).toMatchObject({ width, height, byteSize: bytes.length });
      expect(
        await (await readObject('images', file.objectKey ?? ''))?.text(),
      ).toBe(new TextDecoder().decode(bytes));
    },
  );

  test('先頭の検査の範囲を超える本文は、先頭を検査した後に残りと合わせて全て保存する', async () => {
    const bytes = pngBytes(800, 600, DIMENSION_PREFIX_BYTES + 300_000);
    bytes.fill(0x5a, 100);

    const file = acceptedFileOf(
      await createReceiver().receive(
        uploadInputOf(streamOf(...chunksOf(bytes, 65_536)), {
          contentLength: String(bytes.length),
        }),
      ),
    );

    expect(file).toMatchObject({ width: 800, height: 600 });
    const stored = await readObject('images', file.objectKey ?? '');
    expect(new Uint8Array((await stored?.arrayBuffer()) ?? [])).toEqual(bytes);
  });

  test('動作確認の主体のアップロードは保有者の識別子の無い記録にする', async () => {
    const file = acceptedFileOf(
      await createReceiver().receive(
        uploadInputOf(pngBytes(10, 10), {
          purpose: MEDIA_SMOKE_PURPOSE,
          uploader: { kind: 'system' },
        }),
      ),
    );

    expect(await readRecord(file.fileId)).toMatchObject({
      purpose: 'media-smoke',
      ownerKind: 'system',
      ownerId: null,
    });
  });

  test('アップロードの結果のログに用途・形式・バイト数・識別子を出し、ファイル名と内容を出さない', async () => {
    const logs = recordLogs('event');
    const fileName = 'secret-plan-名前.png';

    const file = acceptedFileOf(
      await createReceiver({ appName: 'event' }).receive(
        uploadInputOf(pngBytes(10, 10), {
          fileNameHeader: encodeURIComponent(fileName),
        }),
      ),
    );

    const uploadLogs = logs.filter(
      ({ category }) => category === 'event.media.upload',
    );
    expect(uploadLogs).toEqual([
      expect.objectContaining({
        level: 'info',
        purpose: IMAGE_PURPOSE.name,
        mediaType: 'image/png',
        byteSize: 64,
        fileId: file.fileId,
        status: 201,
      }),
    ]);
    expect(JSON.stringify(logs)).not.toContain('secret-plan');
    expect(JSON.stringify(logs)).not.toContain(file.objectKey ?? '');
  });
});

describe('MediaUploadReceiverの事前検証による拒否', () => {
  test.each<[string, Partial<UploadInput>, number, string, string]>([
    [
      'Content-Lengthが無い',
      { contentLength: null },
      411,
      'content_length_required',
      'length_required',
    ],
    [
      'Content-Lengthが不正',
      { contentLength: '1e3' },
      400,
      'invalid_content_length',
      'bad_request',
    ],
    [
      '上限サイズを超える',
      { contentLength: String(IMAGE_PURPOSE.maxBytes + 1) },
      413,
      'file_too_large',
      'payload_too_large',
    ],
    [
      '許可されない形式',
      { contentType: 'application/pdf' },
      415,
      'unsupported_file_type',
      'unsupported_media_type',
    ],
  ])(
    '%sと本文を読まずに拒否し、記録もオブジェクトも判定の依頼も残さない',
    async (_, overrides, status, code, kind) => {
      const logs = recordLogs();
      const { queue, sent } = createRecordingQueue();
      const tracked = trackedStreamOf(pngBytes(10, 10));

      const rejection = rejectionOf(
        await createReceiver({ queue }).receive(
          uploadInputOf(tracked.stream, {
            contentLength: '64',
            ...overrides,
          }),
        ),
      );

      expect(rejection).toMatchObject({ kind, code });
      expect(tracked.pulledChunks()).toBe(0);
      expect(await expectNothingStored()).toBe(true);
      expect(sent).toEqual([]);
      expect(
        logs.filter(({ category }) => category === 'api.media.upload'),
      ).toEqual([
        expect.objectContaining({
          level: 'info',
          purpose: IMAGE_PURPOSE.name,
          status,
          code,
        }),
      ]);
    },
  );
});

describe('MediaUploadReceiverの実体検証による拒否', () => {
  const tooWide = pngBytes(12_001, 10);
  const tooManyPixels = pngBytes(4001, 4000);

  test.each<[string, Uint8Array, Partial<UploadInput>, string, string]>([
    [
      'PNGと申告したJPEG',
      jpegPrefixBytes(),
      {},
      'file_type_mismatch',
      UNREADABLE_MESSAGE,
    ],
    [
      'PDFと申告したPNG',
      pngBytes(10, 10),
      { purpose: FILE_PURPOSE, contentType: 'application/pdf' },
      'file_type_mismatch',
      UNREADABLE_MESSAGE,
    ],
    [
      '寸法を読めないPNG',
      pngBytes(0, 0),
      {},
      'image_unreadable',
      UNREADABLE_MESSAGE,
    ],
    [
      '辺が12,000pxを超えるPNG',
      tooWide,
      {},
      'image_dimensions_exceeded',
      '画像の縦横の大きさが上限を超えています。小さくしてから選択してください。',
    ],
    [
      '1,600万画素を超えるPNG',
      tooManyPixels,
      {},
      'image_dimensions_exceeded',
      '画像の縦横の大きさが上限を超えています。小さくしてから選択してください。',
    ],
    [
      '壊れたSVG',
      utf8('<svg xmlns="http://www.w3.org/2000/svg"><g></svg>'),
      { contentType: 'image/svg+xml' },
      'invalid_svg',
      UNREADABLE_MESSAGE,
    ],
    [
      '文書型宣言を含むSVG',
      utf8(
        '<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>',
      ),
      { contentType: 'image/svg+xml' },
      'svg_declaration_not_allowed',
      'このSVGは読み込めません。編集ソフトでSVGとして書き出し直してから選択してください。',
    ],
  ])(
    '%sは422で拒否し、記録もオブジェクトも判定の依頼も残さない',
    async (_, bytes, overrides, code, message) => {
      const { queue, sent } = createRecordingQueue();

      const rejection = rejectionOf(
        await createReceiver({ queue }).receive(
          uploadInputOf(bytes, overrides),
        ),
      );

      expect(rejection).toEqual({ kind: 'unprocessable', code, message });
      expect(await expectNothingStored()).toBe(true);
      expect(sent).toEqual([]);
    },
  );

  test.each<[string, Partial<UploadInput>]>([
    ['PNGの本文が宣言より短い', { contentLength: '65' }],
    ['PNGの本文が宣言より長い', { contentLength: '63' }],
    [
      'SVGの本文が宣言より長い',
      {
        contentType: 'image/svg+xml',
        body: streamOf(svgBytes(), utf8(' ')),
        contentLength: String(svgBytes().length),
      },
    ],
    [
      'SVGの本文が宣言より短い',
      {
        contentType: 'image/svg+xml',
        body: streamOf(svgBytes()),
        contentLength: String(svgBytes().length + 1),
      },
    ],
    ['本文が無い', { body: null, contentLength: '64' }],
  ])(
    '%s場合は記録を作る前に長さの不一致として400で拒否する',
    async (_, overrides) => {
      const rejection = rejectionOf(
        await createReceiver().receive(
          uploadInputOf(pngBytes(10, 10), overrides),
        ),
      );

      expect(rejection).toEqual({
        kind: 'bad_request',
        code: 'content_length_mismatch',
        message: RESEND_MESSAGE,
      });
      expect(await expectNothingStored()).toBe(true);
    },
  );

  test('先頭の検査の後に本文が宣言より短いと分かった場合も、長さの不一致として拒否し記録とオブジェクトを残さない', async () => {
    const bytes = pngBytes(100, 100, DIMENSION_PREFIX_BYTES + 10_000);

    const rejection = rejectionOf(
      await createReceiver().receive(
        uploadInputOf(streamOf(...chunksOf(bytes, 65_536)), {
          contentLength: String(bytes.length + 1),
        }),
      ),
    );

    expect(rejection.code).toBe('content_length_mismatch');
    expect(await expectNothingStored()).toBe(true);
  });

  test('拒否のログにファイル名を出さない', async () => {
    const logs = recordLogs();

    rejectionOf(
      await createReceiver().receive(
        uploadInputOf(concatBytes(jpegPrefixBytes()), {
          fileNameHeader: encodeURIComponent('hidden-name.png'),
        }),
      ),
    );

    expect(
      logs.filter(({ category }) => category === 'api.media.upload'),
    ).toEqual([
      expect.objectContaining({
        level: 'info',
        purpose: IMAGE_PURPOSE.name,
        mediaType: 'image/png',
        byteSize: 64,
        status: 422,
        code: 'file_type_mismatch',
      }),
    ]);
    expect(JSON.stringify(logs)).not.toContain('hidden-name');
  });
});
