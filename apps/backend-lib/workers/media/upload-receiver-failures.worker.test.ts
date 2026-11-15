import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { AppError } from '../../core/errors/app-error.ts';
import { DIMENSION_PREFIX_BYTES } from '../../core/media/image-dimensions.ts';
import type { MediaFileStore } from '../../core/media/ports.ts';
import {
  acceptedFileOf,
  chunksOf,
  clearMediaState,
  countRecords,
  createReceiver,
  createRecordingQueue,
  expectNothingStored,
  failingFileStore,
  failingObjectStore,
  FILE_PURPOSE,
  hexKeyOf,
  IMAGE_PURPOSE,
  installRecordingSentry,
  keyBytesOf,
  listObjectKeys,
  pngBytes,
  putExistingObject,
  readObject,
  readRecord,
  recordLogs,
  rejectionOf,
  resetLogging,
  resetObservability,
  sequenceRandomBytes,
  streamOf,
  uploadInputOf,
  utf8,
} from './testing/upload-receiver-fixtures.ts';

const STORAGE_UNAVAILABLE = {
  kind: 'unavailable',
  code: 'storage_unavailable',
  message: '現在ご利用いただけません。しばらく待ってから再度お試しください。',
  retryAfterSeconds: 5,
} as const;

const INVALID_TEXT = {
  kind: 'unprocessable',
  code: 'invalid_text_file',
  message:
    'ファイルを読み込めませんでした。ファイルが壊れていないか確認して、もう一度選択してください。',
} as const;

function textInputOf(chunks: readonly Uint8Array[], contentLength: number) {
  return uploadInputOf(streamOf(...chunks), {
    purpose: FILE_PURPOSE,
    contentType: 'text/plain',
    contentLength: String(contentLength),
  });
}

beforeEach(async () => {
  await clearMediaState();
});

afterEach(() => {
  resetObservability();
  resetLogging();
});

describe('MediaUploadReceiverの記録の作成の後の拒否', () => {
  test.each([
    ['NUL文字を含む', [utf8('abc'), utf8('d\u0000e')]],
    ['UTF-8として読めない', [utf8('abc'), Uint8Array.of(0xff, 0xfe)]],
    ['末尾で文字が途切れる', [utf8('abc'), utf8('あ').subarray(0, 2)]],
  ])(
    'テキストが%sと422で拒否し、記録の削除を試みて記録もオブジェクトも残さない',
    async (_, chunks) => {
      const removedIds: string[] = [];
      const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);

      const rejection = rejectionOf(
        await createReceiver({
          files: failingFileStore({}, removedIds),
        }).receive(textInputOf(chunks, length)),
      );

      expect(rejection).toEqual(INVALID_TEXT);
      expect(removedIds).toHaveLength(1);
      expect(await expectNothingStored()).toBe(true);
    },
  );

  test.each([
    ['テキストの本文が宣言より長い', [utf8('abcdef')], 5],
    ['テキストの本文が宣言より短い', [utf8('abc')], 5],
  ])(
    '%sと長さの不一致として400で拒否し、記録の削除を試みる',
    async (_, chunks, contentLength) => {
      const removedIds: string[] = [];

      const rejection = rejectionOf(
        await createReceiver({
          files: failingFileStore({}, removedIds),
        }).receive(textInputOf(chunks, contentLength)),
      );

      expect(rejection.code).toBe('content_length_mismatch');
      expect(rejection.kind).toBe('bad_request');
      expect(removedIds).toHaveLength(1);
      expect(await expectNothingStored()).toBe(true);
    },
  );

  test('先頭の検査の範囲を超える画像の本文が宣言より長いと、保存の途中で長さの不一致として拒否する', async () => {
    const bytes = pngBytes(100, 100, DIMENSION_PREFIX_BYTES + 10_000);
    const removedIds: string[] = [];

    const rejection = rejectionOf(
      await createReceiver({ files: failingFileStore({}, removedIds) }).receive(
        uploadInputOf(streamOf(...chunksOf(bytes, 65_536)), {
          contentLength: String(bytes.length - 1),
        }),
      ),
    );

    expect(rejection.code).toBe('content_length_mismatch');
    expect(removedIds).toHaveLength(1);
    expect(await expectNothingStored()).toBe(true);
  });
});

describe('MediaUploadReceiverのオブジェクトキーの衝突', () => {
  test('putIfAbsentがexistsを返すと想定外の例外になり、記録が残らず、既存のオブジェクトは変わらない', async () => {
    await putExistingObject('images', hexKeyOf(0x11), 'existing');
    const removedIds: string[] = [];
    let existenceChecks = 0;
    const objects = failingObjectStore({
      exists: () => {
        existenceChecks += 1;
        return Promise.resolve(false);
      },
    });

    const received = createReceiver({
      files: failingFileStore({}, removedIds),
      objects,
      randomBytes: sequenceRandomBytes(keyBytesOf(0x11), keyBytesOf(0x22)),
    }).receive(uploadInputOf(pngBytes(10, 10)));

    await expect(received).rejects.toThrow(Error);
    await expect(received).rejects.not.toBeInstanceOf(AppError);
    expect(existenceChecks).toBe(0);
    expect(removedIds).toHaveLength(1);
    expect(await countRecords()).toBe(0);
    expect(await listObjectKeys('images')).toEqual([hexKeyOf(0x11)]);
    expect(await (await readObject('images', hexKeyOf(0x11)))?.text()).toBe(
      'existing',
    );
  });
});

describe('MediaUploadReceiverの保存先の一時的な障害', () => {
  const outage = () => Promise.reject(new Error('一時的に利用できません'));

  test('記録の作成に失敗すると、オブジェクトを書き込まずに503で拒否し、障害をwarningのログに出す', async () => {
    const logs = recordLogs();

    const rejection = rejectionOf(
      await createReceiver({
        files: failingFileStore({ insertReceiving: outage }),
      }).receive(uploadInputOf(pngBytes(10, 10))),
    );

    expect(rejection).toEqual(STORAGE_UNAVAILABLE);
    expect(await expectNothingStored()).toBe(true);
    expect(
      logs.filter(
        ({ category, level }) =>
          category === 'api.media.upload' && level === 'warning',
      ),
    ).toEqual([
      expect.objectContaining({
        purpose: IMAGE_PURPOSE.name,
        error: expect.objectContaining({
          message: '一時的に利用できません',
        }) as unknown,
      }),
    ]);
  });

  test('オブジェクトの書き込みに失敗すると、記録の削除を試みて503で拒否する', async () => {
    const removedIds: string[] = [];

    const rejection = rejectionOf(
      await createReceiver({
        files: failingFileStore({}, removedIds),
        objects: failingObjectStore({ putIfAbsent: outage }),
      }).receive(uploadInputOf(pngBytes(10, 10))),
    );

    expect(rejection).toEqual(STORAGE_UNAVAILABLE);
    expect(removedIds).toHaveLength(1);
    expect(await expectNothingStored()).toBe(true);
  });

  test('保存の完了の記録に失敗すると、書き込んだオブジェクトと記録の削除を試みて503で拒否する', async () => {
    const removedIds: string[] = [];

    const rejection = rejectionOf(
      await createReceiver({
        files: failingFileStore({ markStored: outage }, removedIds),
      }).receive(uploadInputOf(pngBytes(10, 10))),
    );

    expect(rejection).toEqual(STORAGE_UNAVAILABLE);
    expect(removedIds).toHaveLength(1);
    expect(await expectNothingStored()).toBe(true);
  });

  test('後始末でオブジェクトを消せなければ、日次の削除が両方を消せるよう保存未完了の記録を残す', async () => {
    const removedIds: string[] = [];
    const logs = recordLogs();

    const rejection = rejectionOf(
      await createReceiver({
        files: failingFileStore({ markStored: outage }, removedIds),
        objects: failingObjectStore({ delete: outage }),
      }).receive(uploadInputOf(pngBytes(10, 10))),
    );

    expect(rejection).toEqual(STORAGE_UNAVAILABLE);
    expect(removedIds).toEqual([]);
    expect(await countRecords()).toBe(1);
    expect(await listObjectKeys('images')).toHaveLength(1);
    expect(
      logs.filter(
        ({ category, level }) =>
          category === 'api.media.upload' && level === 'warning',
      ),
    ).toHaveLength(2);
  });

  test('後始末で記録を消せなくても、拒否の結果を返す', async () => {
    const files: MediaFileStore = failingFileStore({
      markStored: outage,
      remove: outage,
    });

    const rejection = rejectionOf(
      await createReceiver({ files }).receive(uploadInputOf(pngBytes(10, 10))),
    );

    expect(rejection).toEqual(STORAGE_UNAVAILABLE);
    expect(await listObjectKeys('images')).toEqual([]);
    expect(await countRecords()).toBe(1);
  });
});

describe('MediaUploadReceiverの判定の依頼の送信の失敗', () => {
  test('Queueへの送信に失敗してもアップロードを成功させ、判定待ちの記録を残し、warningのログとSentryに送る', async () => {
    const logs = recordLogs();
    const events = installRecordingSentry();
    const { queue } = createRecordingQueue(new Error('Queueに送れません'));

    const file = acceptedFileOf(
      await createReceiver({ queue }).receive(uploadInputOf(pngBytes(10, 10))),
    );

    expect(await readRecord(file.fileId)).toMatchObject({
      moderationStatus: 'pending',
      storedAt: expect.any(Date) as unknown,
    });
    expect(
      logs.filter(
        ({ category, level }) =>
          category === 'api.media.upload' && level === 'warning',
      ),
    ).toEqual([
      expect.objectContaining({
        fileId: file.fileId,
        purpose: IMAGE_PURPOSE.name,
        error: expect.objectContaining({
          message: 'Queueに送れません',
        }) as unknown,
      }),
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]?.level).toBe('warning');
    expect(events[0]?.tags).toMatchObject({
      media_purpose: IMAGE_PURPOSE.name,
    });
    expect(events[0]?.exception?.values?.[0]?.value).toBe('Queueに送れません');
  });

  test('判定の依頼が送信前の検証で失敗した場合は、日次の再依頼でも直らない呼び出し側の誤りとしてerrorのログとSentryのerrorに送り、アップロードは成功させる', async () => {
    const logs = recordLogs();
    const events = installRecordingSentry();
    const { queue, sent } = createRecordingQueue();

    const file = acceptedFileOf(
      await createReceiver({ queue, contracts: [] }).receive(
        uploadInputOf(pngBytes(10, 10)),
      ),
    );

    expect(sent).toEqual([]);
    expect(await readRecord(file.fileId)).toMatchObject({
      moderationStatus: 'pending',
    });
    expect(
      logs.filter(
        ({ category, level }) =>
          category === 'api.media.upload' && level === 'error',
      ),
    ).toEqual([
      expect.objectContaining({
        fileId: file.fileId,
        purpose: IMAGE_PURPOSE.name,
        error: expect.objectContaining({
          name: 'MessagePublishError',
        }) as unknown,
      }),
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]?.level).toBe('error');
    expect(events[0]?.tags).toMatchObject({
      media_purpose: IMAGE_PURPOSE.name,
    });
  });
});
