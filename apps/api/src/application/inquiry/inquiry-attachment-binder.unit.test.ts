import { describe, expect, test } from 'bun:test';

import {
  INQUIRY_ATTACHMENT_LIMITS,
  INQUIRY_ATTACHMENT_PURPOSE,
} from '../../../common-lib/inquiry/inquiry-attachment-limits.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import type { MediaFileView } from '../../../lib/core/media/media-file.ts';
import type {
  ClaimRequest,
  ClaimResult,
  MediaFiles,
} from '../../../lib/core/media/ports.ts';
import { MediaInquiryAttachmentBinder } from './inquiry-attachment-binder.ts';
import type { InquiryIncidentKind, InquiryIncidentReporter } from './ports.ts';

const USER_ID = '01JC0000000000000000000U01';
const OTHER_USER_ID = '01JC0000000000000000000U02';

const COUNT_MESSAGE = 'ファイルは20個以内で選択してください。';
const TOTAL_MESSAGE = 'ファイルは合計20MB以内で選択してください。';
const INVALID_MESSAGE =
  '添付ファイルを確認できませんでした。もう一度選択してください。';

const fileOf = (
  id: string,
  overrides: Partial<MediaFileView> = {},
): MediaFileView => ({
  id,
  objectKey: `files/${id}`,
  purpose: INQUIRY_ATTACHMENT_PURPOSE,
  storage: 'files',
  location: 'files',
  owner: { kind: 'user', id: USER_ID },
  originalFileName: `${id}.pdf`,
  contentType: 'application/pdf',
  byteSize: 1024,
  width: null,
  height: null,
  stored: true,
  attached: false,
  deletedAt: null,
  eraseRequested: false,
  moderationStatus: 'not_required',
  quarantineReasons: [],
  quarantined: false,
  createdAt: new Date('2027-04-01T08:59:00.000Z'),
  ...overrides,
});

interface Reported {
  readonly kind: InquiryIncidentKind;
  readonly error: unknown;
  readonly attributes: { readonly inquiryId?: string };
}

interface FakeOptions {
  readonly files?: readonly MediaFileView[];
  readonly claimResult?: ClaimResult;
  readonly claimError?: Error;
  readonly markDeletedError?: Error;
}

// 使わないメソッドを呼んだら失敗させ、ユースケースが想定外のポートに触れたことを検出する
function partialFake<T extends object>(implemented: Partial<T>): T {
  return new Proxy(implemented, {
    get(target, property, receiver) {
      if (Reflect.has(target, property)) {
        return Reflect.get(target, property, receiver) as unknown;
      }
      return () => {
        throw new Error(`この偽物では使わない: ${String(property)}`);
      };
    },
  }) as T;
}

function setup(options: FakeOptions = {}) {
  const calls: string[] = [];
  const lookups: (readonly string[])[] = [];
  const claims: ClaimRequest[] = [];
  const deletions: (readonly string[])[] = [];
  const reported: Reported[] = [];
  const stored = new Map(
    (options.files ?? []).map((file) => [file.id, file] as const),
  );
  const media = partialFake<MediaFiles>({
    findMany: (fileIds) => {
      calls.push('findMany');
      lookups.push(fileIds);
      return Promise.resolve(
        new Map(
          fileIds.flatMap((id) => {
            const file = stored.get(id);
            return file === undefined ? [] : [[id, file] as const];
          }),
        ),
      );
    },
    claim: (request) => {
      calls.push('claim');
      claims.push(request);
      if (options.claimError !== undefined) {
        return Promise.reject(options.claimError);
      }
      return Promise.resolve(options.claimResult ?? { ok: true });
    },
    markDeleted: (fileIds) => {
      calls.push('markDeleted');
      deletions.push(fileIds);
      if (options.markDeletedError !== undefined) {
        return Promise.reject(options.markDeletedError);
      }
      return Promise.resolve();
    },
  });
  const incidents: InquiryIncidentReporter = {
    report: (kind, error, attributes) => {
      calls.push('report');
      reported.push({ kind, error, attributes });
    },
  };
  return {
    binder: new MediaInquiryAttachmentBinder(media, incidents),
    calls,
    lookups,
    claims,
    deletions,
    reported,
  };
}

const idsOf = (count: number): readonly string[] =>
  Array.from({ length: count }, (_, index) => `file-${String(index)}`);

async function rejectionOf(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof AppError) {
      return error;
    }
    throw error;
  }
  throw new Error('拒否されませんでした');
}

const summaryOf = (error: AppError) => ({
  kind: error.kind,
  code: error.code,
  message: error.message,
  details: error.details,
});

describe('MediaInquiryAttachmentBinder.bind', () => {
  test('添付が0件ならファイル管理を呼ばずに空の一覧を返す', async () => {
    const { binder, calls } = setup();

    expect(await binder.bind(USER_ID, [])).toEqual([]);
    expect(calls).toEqual([]);
  });

  test('本人の保存済みの問い合わせの添付を検証してから紐付け、重複を除いた要求の順のIDを返す', async () => {
    const { binder, calls, lookups, claims } = setup({
      files: [fileOf('file-a'), fileOf('file-b')],
    });

    const bound = await binder.bind(USER_ID, ['file-b', 'file-a', 'file-b']);

    expect(bound).toEqual(['file-b', 'file-a']);
    expect(calls).toEqual(['findMany', 'claim']);
    expect(lookups).toEqual([['file-b', 'file-a']]);
    expect(claims).toEqual([
      {
        fileIds: ['file-b', 'file-a'],
        purpose: INQUIRY_ATTACHMENT_PURPOSE,
        owner: { kind: 'user', id: USER_ID },
      },
    ]);
  });

  test('件数の上限を超えれば、ファイル管理を呼ばずに件数の添付のエラーにする', async () => {
    const ids = idsOf(INQUIRY_ATTACHMENT_LIMITS.maxCount + 1);
    const { binder, calls } = setup({ files: ids.map((id) => fileOf(id)) });

    const error = await rejectionOf(binder.bind(USER_ID, ids));

    expect(summaryOf(error)).toEqual({
      kind: 'bad_request',
      code: 'inquiry_attachments_invalid',
      message: COUNT_MESSAGE,
      details: [{ field: 'fileIds', code: 'too-many', message: COUNT_MESSAGE }],
    });
    expect(calls).toEqual([]);
  });

  test('重複を除いて上限の件数ちょうどなら紐付ける', async () => {
    const ids = idsOf(INQUIRY_ATTACHMENT_LIMITS.maxCount);
    const { binder, calls } = setup({ files: ids.map((id) => fileOf(id)) });

    expect(await binder.bind(USER_ID, [...ids, ...ids])).toEqual(ids);
    expect(calls).toEqual(['findMany', 'claim']);
  });

  test('合計の上限を超えれば、紐付けを呼ばずに合計の添付のエラーにする', async () => {
    const half = INQUIRY_ATTACHMENT_LIMITS.maxTotalBytes / 2;
    const { binder, calls } = setup({
      files: [
        fileOf('file-a', { byteSize: half }),
        fileOf('file-b', { byteSize: half + 1 }),
      ],
    });

    const error = await rejectionOf(binder.bind(USER_ID, ['file-a', 'file-b']));

    expect(summaryOf(error)).toEqual({
      kind: 'bad_request',
      code: 'inquiry_attachments_invalid',
      message: TOTAL_MESSAGE,
      details: [
        { field: 'fileIds', code: 'too-large', message: TOTAL_MESSAGE },
      ],
    });
    expect(calls).toEqual(['findMany']);
  });

  test.each([
    ['存在しない', []],
    [
      '他の利用者がアップロードした',
      [fileOf('file-x', { owner: { kind: 'user', id: OTHER_USER_ID } })],
    ],
    [
      '管理者がアップロードした',
      [fileOf('file-x', { owner: { kind: 'admin', id: USER_ID } })],
    ],
    ['主体がsystemの', [fileOf('file-x', { owner: { kind: 'system' } })]],
    [
      '用途が問い合わせの添付でない',
      [fileOf('file-x', { purpose: 'product-file' })],
    ],
    ['保存が完了していない', [fileOf('file-x', { stored: false })]],
    [
      '論理削除済みの',
      [
        fileOf('file-x', {
          deletedAt: new Date('2027-04-01T08:59:30.000Z'),
        }),
      ],
    ],
    ['削除待ちの', [fileOf('file-x', { eraseRequested: true })]],
    ['既に別のメッセージへ紐付けた', [fileOf('file-x', { attached: true })]],
  ] as const)(
    '%sファイルを含めば、紐付けを呼ばずに無効なIDの添付のエラーにする',
    async (_label, found) => {
      const { binder, calls } = setup({
        files: [fileOf('file-a'), ...found],
      });

      const error = await rejectionOf(
        binder.bind(USER_ID, ['file-a', 'file-x']),
      );

      expect(summaryOf(error)).toEqual({
        kind: 'bad_request',
        code: 'inquiry_attachments_invalid',
        message: INVALID_MESSAGE,
        details: [
          { field: 'fileIds.1', code: 'invalid', message: INVALID_MESSAGE },
        ],
      });
      expect(calls).toEqual(['findMany']);
    },
  );

  test('検証の後に紐付けに失敗すれば、失敗したファイルの無効なIDの添付のエラーにする', async () => {
    const { binder, calls } = setup({
      files: [fileOf('file-a'), fileOf('file-b')],
      claimResult: {
        ok: false,
        failures: [{ fileId: 'file-b', reason: 'deleted' }],
      },
    });

    const error = await rejectionOf(binder.bind(USER_ID, ['file-a', 'file-b']));

    expect(summaryOf(error)).toEqual({
      kind: 'bad_request',
      code: 'inquiry_attachments_invalid',
      message: INVALID_MESSAGE,
      details: [
        { field: 'fileIds.1', code: 'invalid', message: INVALID_MESSAGE },
      ],
    });
    expect(calls).toEqual(['findMany', 'claim']);
  });

  test('紐付けの一時的な障害は添付のエラーに変えずにそのまま伝える', async () => {
    const unavailable = new AppError({
      kind: 'unavailable',
      code: 'storage_unavailable',
      message: '現在ご利用いただけません。',
      retryAfterSeconds: 5,
    });
    const { binder } = setup({
      files: [fileOf('file-a')],
      claimError: unavailable,
    });

    expect(await rejectionOf(binder.bind(USER_ID, ['file-a']))).toBe(
      unavailable,
    );
  });
});

describe('MediaInquiryAttachmentBinder.release', () => {
  test('紐付けたファイルを重複を除いて論理削除する', async () => {
    const { binder, calls, deletions } = setup();

    await binder.release(['file-a', 'file-b', 'file-a']);

    expect(calls).toEqual(['markDeleted']);
    expect(deletions).toEqual([['file-a', 'file-b']]);
  });

  test('解放するファイルが無ければファイル管理を呼ばない', async () => {
    const { binder, calls } = setup();

    await binder.release([]);

    expect(calls).toEqual([]);
  });

  test('論理削除の失敗は解放の失敗として報告するだけで、呼び出し元へ投げない', async () => {
    const failure = new Error('D1が一時的に利用できない');
    const { binder, calls, reported } = setup({ markDeletedError: failure });

    await binder.release(['file-a']);

    expect(calls).toEqual(['markDeleted', 'report']);
    expect(reported).toEqual([
      { kind: 'attachment-release-failed', error: failure, attributes: {} },
    ]);
  });
});
