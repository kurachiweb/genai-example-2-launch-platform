import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import type {
  AuditEntryInput,
  AuditLogRecorder,
  PreparedAuditEntry,
} from '../../../lib/core/admin/audit-log.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import type {
  MediaFileView,
  MediaOwner,
  QuarantineReason,
} from '../../../lib/core/media/media-file.ts';
import type { MediaFiles } from '../../../lib/core/media/ports.ts';
import {
  DefaultImageModerationService,
  type ImageModerationService,
} from './image-moderation-service.ts';
import { MODERATION_ERRORS } from './moderation-errors.ts';
import type {
  ImageModerationChange,
  ImageModerationWrite,
  ImageModerationWriter,
  ModerationCommand,
  ModerationWriteParticipation,
} from './ports.ts';

const AT = new Date('2026-11-20T03:00:00.000Z');
const FILE_ID = '01JQ0IMG000000000000000001';
const OWNER_USER_ID = '01JQ0USR000000000000000001';
const OWNER_ADMIN_ID = '01JQ0ADM000000000000000009';
const ADMIN_ID = '01JQ0ADM000000000000000001';
const ACTION_ID = '01JQ0MDR000000000000000001';
const REASON = '規約に反する画像と判断したため';
const ORIGINAL_FILE_NAME = 'secret-original-name.png';

type Operation = 'approve' | 'quarantine' | 'release' | 'remove';
type WriterMethod = 'addReason' | 'removeReason' | 'requestErase';

const OPERATIONS = [
  {
    operation: 'approve',
    label: '公開承認',
    action: 'image.approve',
    method: 'removeReason',
    reason: 'auto',
    applicableReasons: ['auto'],
  },
  {
    operation: 'quarantine',
    label: '個別の隔離',
    action: 'image.quarantine',
    method: 'addReason',
    reason: 'admin_action',
    applicableReasons: [],
  },
  {
    operation: 'release',
    label: '隔離の解除',
    action: 'image.release',
    method: 'removeReason',
    reason: 'admin_action',
    applicableReasons: ['admin_action'],
  },
  {
    operation: 'remove',
    label: '削除',
    action: 'image.delete',
    method: 'requestErase',
    reason: undefined,
    applicableReasons: ['user_suspended'],
  },
] as const satisfies readonly {
  operation: Operation;
  label: string;
  action: string;
  method: WriterMethod;
  reason: QuarantineReason | undefined;
  applicableReasons: readonly QuarantineReason[];
}[];

const fileOf = (overrides: Partial<MediaFileView> = {}): MediaFileView => {
  const quarantineReasons = overrides.quarantineReasons ?? ['auto'];
  return {
    id: FILE_ID,
    objectKey: `images/${FILE_ID}`,
    purpose: 'product-logo',
    storage: 'images',
    location: quarantineReasons.length > 0 ? 'quarantine' : 'images',
    owner: { kind: 'user', id: OWNER_USER_ID },
    originalFileName: ORIGINAL_FILE_NAME,
    contentType: 'image/png',
    byteSize: 2048,
    width: 256,
    height: 256,
    stored: true,
    attached: true,
    deletedAt: null,
    eraseRequested: false,
    moderationStatus: 'flagged',
    quarantined: quarantineReasons.length > 0,
    createdAt: new Date('2026-11-01T00:00:00.000Z'),
    ...overrides,
    quarantineReasons,
  };
};

const commandOf = (
  overrides: Partial<ModerationCommand> = {},
): ModerationCommand => ({
  targetId: FILE_ID,
  reason: `  ${REASON}\n`,
  operator: { adminId: ADMIN_ID },
  at: AT,
  ...overrides,
});

type WriterBehavior =
  | { readonly kind: 'result'; readonly result: ImageModerationChange }
  | { readonly kind: 'throw'; readonly error: Error };

interface HarnessOptions {
  readonly files?: readonly MediaFileView[];
  readonly writer?: WriterBehavior;
}

interface WriterCall {
  readonly method: WriterMethod;
  readonly write: ImageModerationWrite;
  readonly reason: QuarantineReason | undefined;
}

const harnessOf = (options: HarnessOptions = {}) => {
  const calls: string[] = [];
  const lookups: (readonly string[])[] = [];
  const prepared: AuditEntryInput[] = [];
  const preparedEntries: PreparedAuditEntry[] = [];
  const writes: WriterCall[] = [];
  const unexpected = (name: string) => () =>
    Promise.reject(new Error(`${name}は呼ばれない想定です`));
  const media: MediaFiles = {
    claim: unexpected('claim'),
    markDeleted: unexpected('markDeleted'),
    eraseNow: unexpected('eraseNow'),
    eraseOwnedBy: unexpected('eraseOwnedBy'),
    listOwnerIds: unexpected('listOwnerIds'),
    openContent: unexpected('openContent'),
    findMany: (fileIds) => {
      calls.push('media.findMany');
      lookups.push(fileIds);
      const found = (options.files ?? [fileOf()]).filter(({ id }) =>
        fileIds.includes(id),
      );
      return Promise.resolve(new Map(found.map((file) => [file.id, file])));
    },
  };
  const write = (
    method: WriterMethod,
    entry: ImageModerationWrite,
    reason: QuarantineReason | undefined,
  ): Promise<ImageModerationChange> => {
    calls.push(`writer.${method}`);
    writes.push({ method, write: entry, reason });
    const behavior = options.writer ?? { kind: 'result', result: 'changed' };
    return behavior.kind === 'throw'
      ? Promise.reject(behavior.error)
      : Promise.resolve(behavior.result);
  };
  const writer: ImageModerationWriter = {
    addReason: (entry, reason) => write('addReason', entry, reason),
    removeReason: (entry, reason) => write('removeReason', entry, reason),
    requestErase: (entry) => write('requestErase', entry, undefined),
  };
  // 準備済みの記録は記録の実装だけが作れるため、偽物は型の表明で作る
  const auditLog: AuditLogRecorder = {
    prepare: (entry) => {
      calls.push('audit.prepare');
      prepared.push(entry);
      const entryOf = Object.freeze({
        id: `audit-${String(prepared.length)}`,
        operatorAdminId: entry.operatorAdminId,
        action: entry.action,
        targetKind: 'image',
        targetIds: entry.targetIds,
        reason: entry.reason ?? null,
        detail: entry.detail ?? {},
        occurredAt: entry.occurredAt,
      }) as unknown as PreparedAuditEntry;
      preparedEntries.push(entryOf);
      return entryOf;
    },
    record: () => Promise.reject(new Error('単独の記録は呼ばれない想定です')),
  };
  const service: ImageModerationService = new DefaultImageModerationService(
    media,
    writer,
    auditLog,
    {
      generate: () => {
        calls.push('ids.generate');
        return ACTION_ID;
      },
    },
  );
  return { service, calls, lookups, prepared, preparedEntries, writes };
};

const run = (
  harness: ReturnType<typeof harnessOf>,
  operation: Operation,
  command: ModerationCommand = commandOf(),
) => harness.service[operation](command);

const rejectionOf = async (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => {
      throw new Error('例外が投げられませんでした');
    },
    (error: unknown) => error,
  );

const appErrorOf = async (promise: Promise<unknown>): Promise<AppError> => {
  const error = await rejectionOf(promise);
  if (!(error instanceof AppError)) {
    throw new Error(`AppErrorではありません: ${String(error)}`);
  }
  return error;
};

const expectAppError = (
  error: AppError,
  code: 'image_not_found' | 'image_action_not_applicable',
) => {
  expect(error.code).toBe(code);
  expect(error.kind).toBe(MODERATION_ERRORS[code].kind);
  expect(error.message).toBe(MODERATION_ERRORS[code].message);
};

const logs: LogRecord[] = [];

beforeEach(() => {
  logs.length = 0;
  configureSync({
    reset: true,
    sinks: {
      capture: (record) => {
        logs.push(record);
      },
    },
    loggers: [
      { category: ['api'], sinks: ['capture'], lowestLevel: 'debug' },
      { category: ['logtape', 'meta'], sinks: [], lowestLevel: 'warning' },
    ],
  });
});

afterEach(() => {
  resetSync();
});

const moderationLogs = () =>
  logs
    .filter(
      (record) => record.category.join('.') === 'api.application.moderation',
    )
    .map(({ level, properties }) => ({ level, properties }));

describe.each(OPERATIONS)(
  'DefaultImageModerationService $label',
  ({ operation, action, method, reason, applicableReasons }) => {
    const applicableFile = (overrides: Partial<MediaFileView> = {}) =>
      fileOf({ quarantineReasons: applicableReasons, ...overrides });
    const applicableHarness = (options: HarnessOptions = {}) =>
      harnessOf({ files: [applicableFile()], ...options });

    test('前後の空白を除いた理由で画像を対象にした監査ログを準備し、記録と監査ログを書き込みの単位へ渡して記録のIDを返す', async () => {
      const harness = applicableHarness();

      const outcome = await run(harness, operation);

      expect(outcome).toEqual({ changed: true, actionId: ACTION_ID });
      expect(harness.lookups).toEqual([[FILE_ID]]);
      expect(harness.prepared).toEqual([
        {
          operatorAdminId: ADMIN_ID,
          action,
          targetIds: [FILE_ID],
          reason: REASON,
          occurredAt: AT,
        },
      ]);
      const [audit] = harness.preparedEntries;
      if (audit === undefined) {
        throw new Error('監査ログが準備されていません');
      }
      expect(harness.writes).toEqual([
        {
          method,
          reason,
          write: {
            fileId: FILE_ID,
            record: {
              id: ACTION_ID,
              action,
              targetId: FILE_ID,
              subjectUserId: OWNER_USER_ID,
              productId: null,
              operatorAdminId: ADMIN_ID,
              reason: REASON,
              lifecycleEventId: null,
              occurredAt: AT,
              noticeStatus: 'none',
            },
            audit,
          },
        },
      ]);
      expect(harness.writes[0]?.write.audit).toBe(audit);
      expect(harness.calls).toEqual([
        'media.findMany',
        'audit.prepare',
        'ids.generate',
        `writer.${method}`,
      ]);
    });

    test('理由は任意で、未入力・空白だけなら理由の無い記録と監査ログにする', async () => {
      for (const blank of [undefined, '', ' 　\n']) {
        const harness = applicableHarness();

        const outcome = await run(
          harness,
          operation,
          commandOf({ reason: blank }),
        );

        expect(outcome).toEqual({ changed: true, actionId: ACTION_ID });
        expect(harness.prepared).toEqual([
          {
            operatorAdminId: ADMIN_ID,
            action,
            targetIds: [FILE_ID],
            occurredAt: AT,
          },
        ]);
        expect(harness.writes[0]?.write.record.reason).toBeNull();
      }
    });

    test('理由が500書記素を超えれば照会も書き込みもせずに入力の誤りを返し、500書記素ちょうどは受け付ける', async () => {
      const tooLong = applicableHarness();
      const error = await appErrorOf(
        run(tooLong, operation, commandOf({ reason: '👍🏽'.repeat(501) })),
      );
      expect(error.kind).toBe('bad_request');
      expect(error.code).toBe('validation_error');
      expect(error.details).toEqual([
        {
          field: 'reason',
          code: 'too_long',
          message: '理由は500文字以内で入力してください。',
        },
      ]);
      expect(tooLong.calls).toEqual([]);

      const limit = applicableHarness();
      const outcome = await run(
        limit,
        operation,
        commandOf({ reason: '👍🏽'.repeat(500) }),
      );
      expect(outcome.changed).toBe(true);
    });

    test.each([
      ['管理者', { kind: 'admin', id: OWNER_ADMIN_ID }],
      ['動作確認の主体', { kind: 'system' }],
    ] as const satisfies readonly (readonly [string, MediaOwner])[])(
      '保有者が%sの画像は、記録の関わる利用者を持たない',
      async (_label, owner) => {
        const harness = harnessOf({ files: [applicableFile({ owner })] });

        await run(harness, operation);

        expect(harness.writes[0]?.write.record.subjectUserId).toBeNull();
      },
    );

    test('ファイルの記録が無い(物理削除済みを含む)なら、監査ログも書き込みもせずに画像が見つからない旨を返す', async () => {
      const harness = harnessOf({ files: [] });

      const error = await appErrorOf(run(harness, operation));

      expectAppError(error, 'image_not_found');
      expect(harness.calls).toEqual(['media.findMany']);
    });

    test('画像用の用途でないファイルなら、監査ログも書き込みもせずに画像が見つからない旨を返す', async () => {
      const harness = harnessOf({
        files: [
          applicableFile({
            purpose: 'inquiry-attachment',
            storage: 'files',
            location: 'files',
            contentType: 'application/pdf',
          }),
        ],
      });

      const error = await appErrorOf(run(harness, operation));

      expectAppError(error, 'image_not_found');
      expect(harness.calls).toEqual(['media.findMany']);
    });

    test('書き込みの単位が変化なしを返したら、記録のIDを返さずに変化なしを返す', async () => {
      const harness = applicableHarness({
        writer: { kind: 'result', result: 'unchanged' },
      });

      const outcome = await run(harness, operation);

      expect(outcome).toEqual({ changed: false, actionId: null });
      expect(harness.calls.at(-1)).toBe(`writer.${method}`);
    });

    test('照会の後に対象が消え書き込みの単位が対象なしを返したら、画像が見つからない旨を返す', async () => {
      const harness = applicableHarness({
        writer: { kind: 'result', result: 'not-found' },
      });

      const error = await appErrorOf(run(harness, operation));

      expectAppError(error, 'image_not_found');
    });

    test('確定の後の移動の依頼・即時の削除の失敗(storage_unavailable)は、そのまま投げる', async () => {
      const failure = new AppError({
        kind: 'unavailable',
        code: 'storage_unavailable',
        message: '一時的に処理できません。',
        retryAfterSeconds: 30,
      });
      const harness = applicableHarness({
        writer: { kind: 'throw', error: failure },
      });

      const error = await rejectionOf(run(harness, operation));

      expect(error).toBe(failure);
    });

    test('参加の値が付いた呼び出しは、照会も監査ログも書き込みもせずに通常の例外にする', async () => {
      const harness = applicableHarness();
      const participation: ModerationWriteParticipation = Object.freeze({
        kind: 'content-reporting.report-resolution',
        payload: Object.freeze({ reportId: '01JQ0RPT000000000000000001' }),
      });

      const error = await rejectionOf(
        run(harness, operation, commandOf({ participation })),
      );

      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(AppError);
      expect(harness.calls).toEqual([]);
    });

    test('ログには措置の種類と識別子と結果だけを出し、理由・ファイル名を出さない', async () => {
      const changed = applicableHarness();
      await run(changed, operation);
      const unchanged = applicableHarness({
        writer: { kind: 'result', result: 'unchanged' },
      });
      await run(unchanged, operation);

      expect(moderationLogs()).toEqual([
        {
          level: 'info',
          properties: {
            action,
            fileId: FILE_ID,
            operatorAdminId: ADMIN_ID,
            actionId: ACTION_ID,
            result: 'changed',
          },
        },
        {
          level: 'info',
          properties: {
            action,
            fileId: FILE_ID,
            operatorAdminId: ADMIN_ID,
            actionId: null,
            result: 'unchanged',
          },
        },
      ]);
      const serialized = JSON.stringify(
        logs.map(({ message, properties }) => ({ message, properties })),
      );
      for (const secret of [REASON, ORIGINAL_FILE_NAME, OWNER_USER_ID]) {
        expect(serialized).not.toContain(secret);
      }
    });
  },
);

describe('DefaultImageModerationService 削除待ちのファイル', () => {
  test('削除は、削除と記録が確定済みのため書き込みをせずに変化なしを返す', async () => {
    const harness = harnessOf({
      files: [fileOf({ quarantineReasons: ['auto'], eraseRequested: true })],
    });

    const outcome = await harness.service.remove(commandOf());

    expect(outcome).toEqual({ changed: false, actionId: null });
    expect(harness.calls).toEqual(['media.findMany']);
  });

  test.each(['approve', 'quarantine', 'release'] as const)(
    '%sは画像が見つからない旨を返し、書き込みをしない',
    async (operation) => {
      const harness = harnessOf({
        files: [
          fileOf({
            quarantineReasons: ['auto', 'admin_action'],
            eraseRequested: true,
          }),
        ],
      });

      const error = await appErrorOf(harness.service[operation](commandOf()));

      expectAppError(error, 'image_not_found');
      expect(harness.calls).toEqual(['media.findMany']);
    },
  );
});

describe('DefaultImageModerationService 操作に必要な隔離理由', () => {
  test.each([
    [
      '公開承認',
      'approve',
      ['admin_action', 'product_hidden', 'user_suspended'],
    ],
    ['公開承認', 'approve', []],
    ['隔離の解除', 'release', ['auto', 'product_hidden', 'user_suspended']],
    ['隔離の解除', 'release', []],
    ['削除', 'remove', []],
  ] as const satisfies readonly (readonly [
    string,
    Operation,
    readonly QuarantineReason[],
  ])[])(
    '%s(%s)は、理由%pの画像には操作を行えない旨を返し、監査ログも書き込みもしない',
    async (_label, operation, quarantineReasons) => {
      const harness = harnessOf({ files: [fileOf({ quarantineReasons })] });

      const error = await appErrorOf(harness.service[operation](commandOf()));

      expectAppError(error, 'image_action_not_applicable');
      expect(harness.calls).toEqual(['media.findMany']);
    },
  );

  test('公開承認は自動判定の理由だけを外し、非公開化・ユーザー停止の理由を外さない', async () => {
    const harness = harnessOf({
      files: [
        fileOf({
          quarantineReasons: ['auto', 'product_hidden', 'user_suspended'],
        }),
      ],
    });

    await harness.service.approve(commandOf());

    expect(
      harness.writes.map(({ method, reason }) => ({ method, reason })),
    ).toEqual([{ method: 'removeReason', reason: 'auto' }]);
  });

  test('隔離の解除は管理者操作の理由だけを外し、非公開化・ユーザー停止の理由を外さない', async () => {
    const harness = harnessOf({
      files: [
        fileOf({
          quarantineReasons: [
            'admin_action',
            'product_hidden',
            'user_suspended',
          ],
        }),
      ],
    });

    await harness.service.release(commandOf());

    expect(
      harness.writes.map(({ method, reason }) => ({ method, reason })),
    ).toEqual([{ method: 'removeReason', reason: 'admin_action' }]);
  });

  test('削除は、理由が1つ以上ある隔離画像なら理由の種類によらず受け付ける', async () => {
    for (const quarantineReason of [
      'auto',
      'product_hidden',
      'user_suspended',
      'admin_action',
    ] as const) {
      const harness = harnessOf({
        files: [fileOf({ quarantineReasons: [quarantineReason] })],
      });

      const outcome = await harness.service.remove(commandOf());

      expect(outcome).toEqual({ changed: true, actionId: ACTION_ID });
      expect(harness.writes.map(({ method }) => method)).toEqual([
        'requestErase',
      ]);
    }
  });

  test('個別の隔離は公開中の画像を受け付け、管理者操作の理由を加える', async () => {
    const harness = harnessOf({ files: [fileOf({ quarantineReasons: [] })] });

    const outcome = await harness.service.quarantine(commandOf());

    expect(outcome).toEqual({ changed: true, actionId: ACTION_ID });
    expect(
      harness.writes.map(({ method, reason }) => ({ method, reason })),
    ).toEqual([{ method: 'addReason', reason: 'admin_action' }]);
  });

  test('個別の隔離は既に管理者操作の理由を持つときも、保存先をそろえ直すため書き込みの単位を呼び、変化なしを返す', async () => {
    const harness = harnessOf({
      files: [fileOf({ quarantineReasons: ['admin_action'] })],
      writer: { kind: 'result', result: 'unchanged' },
    });

    const outcome = await harness.service.quarantine(commandOf());

    expect(outcome).toEqual({ changed: false, actionId: null });
    expect(
      harness.writes.map(({ method, reason }) => ({ method, reason })),
    ).toEqual([{ method: 'addReason', reason: 'admin_action' }]);
  });
});
