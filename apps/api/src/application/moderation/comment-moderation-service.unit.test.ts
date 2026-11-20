import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import type {
  AuditEntryInput,
  AuditLogRecorder,
  PreparedAuditEntry,
} from '../../../lib/core/admin/audit-log.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import type {
  CommentRecord,
  CommentStore,
} from '../../../lib/core/engagement/ports.ts';
import { engagementError } from '../engagement/engagement-errors.ts';
import {
  type CommentModerationService,
  DefaultCommentModerationService,
} from './comment-moderation-service.ts';
import { MODERATION_ERRORS } from './moderation-errors.ts';
import type {
  ModerationNoticeDispatch,
  ModerationNotifier,
} from './moderation-notifier.ts';
import type {
  EngagementModerationChange,
  EngagementModerationWrite,
  EngagementModerationWriter,
  ModerationCommand,
  ModerationWriteParticipation,
} from './ports.ts';

const AT = new Date('2026-11-20T03:00:00.000Z');
const HIDDEN_AT = new Date('2026-11-19T03:00:00.000Z');
const COMMENT_ID = '01JQ0CMT000000000000000001';
const PRODUCT_ID = '01JQ0PRD000000000000000001';
const LAUNCH_ID = '01JQ0LNC000000000000000001';
const AUTHOR_ID = '01JQ0USR000000000000000001';
const ADMIN_ID = '01JQ0ADM000000000000000001';
const ACTION_ID = '01JQ0MDR000000000000000001';
const BODY = '秘密のコメントの本文';
const REASON = '他の利用者を中傷する内容のため';

type Operation = 'hide' | 'unhide';

const OPERATIONS = [
  {
    operation: 'hide',
    label: '非公開化',
    action: 'comment.hide',
    writerMethod: 'hideComment',
    noticeStatus: 'pending',
    currentHiddenAt: null,
    sameHiddenAt: HIDDEN_AT,
  },
  {
    operation: 'unhide',
    label: '復元',
    action: 'comment.unhide',
    writerMethod: 'unhideComment',
    noticeStatus: 'none',
    currentHiddenAt: HIDDEN_AT,
    sameHiddenAt: null,
  },
] as const;

const commentOf = (overrides: Partial<CommentRecord> = {}): CommentRecord => ({
  commentId: COMMENT_ID,
  productId: PRODUCT_ID,
  launchId: LAUNCH_ID,
  parentId: null,
  rootId: COMMENT_ID,
  depth: 1,
  authorUserId: AUTHOR_ID,
  bodyMarkdown: BODY,
  createdAt: new Date('2026-11-01T00:00:00.000Z'),
  editedAt: null,
  deletedAt: null,
  hiddenAt: null,
  anonymizedAt: null,
  ...overrides,
});

const commandOf = (
  overrides: Partial<ModerationCommand> = {},
): ModerationCommand => ({
  targetId: COMMENT_ID,
  reason: `  ${REASON}\n`,
  operator: { adminId: ADMIN_ID },
  at: AT,
  ...overrides,
});

type WriterBehavior =
  | { readonly kind: 'result'; readonly result: EngagementModerationChange }
  | { readonly kind: 'throw'; readonly error: Error };

interface HarnessOptions {
  readonly comments?: readonly CommentRecord[];
  readonly writer?: WriterBehavior;
  readonly dispatchError?: Error;
}

const harnessOf = (options: HarnessOptions = {}) => {
  const calls: string[] = [];
  const lookups: (readonly string[])[] = [];
  const prepared: AuditEntryInput[] = [];
  const preparedEntries: PreparedAuditEntry[] = [];
  const writes: EngagementModerationWrite[] = [];
  const dispatched: string[] = [];
  const comments: CommentStore = {
    findByIds: (commentIds) => {
      calls.push('comments.findByIds');
      lookups.push(commentIds);
      const found = (options.comments ?? [commentOf()]).filter(
        ({ commentId }) => commentIds.includes(commentId),
      );
      return Promise.resolve(
        new Map(found.map((comment) => [comment.commentId, comment])),
      );
    },
  };
  const write =
    (method: string) =>
    (input: EngagementModerationWrite): Promise<EngagementModerationChange> => {
      calls.push(`writer.${method}`);
      writes.push(input);
      const behavior = options.writer ?? { kind: 'result', result: 'changed' };
      if (behavior.kind === 'throw') {
        return Promise.reject(behavior.error);
      }
      return Promise.resolve(behavior.result);
    };
  const writer: EngagementModerationWriter = {
    hideComment: write('hideComment'),
    unhideComment: write('unhideComment'),
    invalidateRating: write('invalidateRating'),
    revalidateRating: write('revalidateRating'),
  };
  // 準備済みの記録は記録の実装だけが作れるため、偽物は型の表明で作る。操作種別の検証は操作種別の定義の単体テストとWorkers統合テストが確かめる
  const auditLog: AuditLogRecorder = {
    prepare: (entry) => {
      calls.push('audit.prepare');
      prepared.push(entry);
      const entryOf = Object.freeze({
        id: `audit-${String(prepared.length)}`,
        operatorAdminId: entry.operatorAdminId,
        action: entry.action,
        targetKind: 'comment',
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
  const notifier: ModerationNotifier = {
    dispatch: (actionId): Promise<ModerationNoticeDispatch> => {
      calls.push('notifier.dispatch');
      dispatched.push(actionId);
      if (options.dispatchError !== undefined) {
        return Promise.reject(options.dispatchError);
      }
      return Promise.resolve('requested');
    },
  };
  const service: CommentModerationService = new DefaultCommentModerationService(
    comments,
    writer,
    auditLog,
    { generate: () => ACTION_ID },
    notifier,
  );
  return {
    service,
    calls,
    lookups,
    prepared,
    preparedEntries,
    writes,
    dispatched,
  };
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
  'DefaultCommentModerationService $label',
  ({
    operation,
    action,
    writerMethod,
    noticeStatus,
    currentHiddenAt,
    sameHiddenAt,
  }) => {
    const currentHarness = (options: HarnessOptions = {}) =>
      harnessOf({
        comments: [commentOf({ hiddenAt: currentHiddenAt })],
        ...options,
      });

    test('前後の空白を除いた理由で、コメントを対象にした監査ログを準備し、記録と監査ログを書き込みの単位へ渡す', async () => {
      const harness = currentHarness();

      const outcome = await run(harness, operation);

      expect(outcome).toEqual({ changed: true, actionId: ACTION_ID });
      expect(harness.lookups).toEqual([[COMMENT_ID]]);
      expect(harness.prepared).toEqual([
        {
          operatorAdminId: ADMIN_ID,
          action,
          targetIds: [COMMENT_ID],
          reason: REASON,
          occurredAt: AT,
        },
      ]);
      expect(harness.calls.slice(0, 3)).toEqual([
        'comments.findByIds',
        'audit.prepare',
        `writer.${writerMethod}`,
      ]);
    });

    test('書き込みの単位へ、採番した記録のIDで投稿者とプロダクトを持つ記録と準備した監査ログを渡す', async () => {
      const harness = currentHarness();

      await run(harness, operation);

      expect(harness.preparedEntries).toHaveLength(1);
      const [audit] = harness.preparedEntries;
      if (audit === undefined) {
        throw new Error('監査ログが準備されていません');
      }
      expect(harness.writes).toEqual([
        {
          targetId: COMMENT_ID,
          at: AT,
          record: {
            id: ACTION_ID,
            action,
            targetId: COMMENT_ID,
            subjectUserId: AUTHOR_ID,
            productId: PRODUCT_ID,
            operatorAdminId: ADMIN_ID,
            reason: REASON,
            lifecycleEventId: null,
            occurredAt: AT,
            noticeStatus,
          },
          audit,
        },
      ]);
      expect(harness.writes[0]?.audit).toBe(audit);
    });

    test('匿名化で投稿者が無いコメントは、記録の投稿者を空にして書き込みの単位へ渡す', async () => {
      const harness = harnessOf({
        comments: [
          commentOf({
            hiddenAt: currentHiddenAt,
            authorUserId: null,
            bodyMarkdown: '',
            anonymizedAt: HIDDEN_AT,
          }),
        ],
      });

      const outcome = await run(harness, operation);

      expect(outcome).toEqual({ changed: true, actionId: ACTION_ID });
      expect(harness.writes[0]?.record.subjectUserId).toBeNull();
    });

    test('呼び出し側の参加の値を、中身を読まずにそのまま書き込みの単位へ渡す', async () => {
      const harness = currentHarness();
      const participation: ModerationWriteParticipation = Object.freeze({
        kind: 'content-reporting.report-resolution',
        payload: Object.freeze({ reportId: '01JQ0RPT000000000000000001' }),
      });

      const outcome = await run(
        harness,
        operation,
        commandOf({ participation }),
      );

      expect(outcome.actionId).toBe(ACTION_ID);
      expect(harness.writes[0]?.participation).toBe(participation);
    });

    test.each([
      ['未入力', undefined],
      ['空', ''],
      ['空白だけ', ' 　\n'],
    ])(
      '理由が%sなら、照会も書き込みもせずに入力の誤りを返す',
      async (_label, reason) => {
        const harness = currentHarness();

        const error = await appErrorOf(
          run(harness, operation, commandOf({ reason })),
        );

        expect(error.kind).toBe('bad_request');
        expect(error.code).toBe('validation_error');
        expect(error.details).toEqual([
          {
            field: 'reason',
            code: 'required',
            message: '理由を入力してください。',
          },
        ]);
        expect(harness.calls).toEqual([]);
      },
    );

    test('理由が500書記素を超えれば入力の誤りを返し、500書記素ちょうどは受け付ける', async () => {
      const tooLong = currentHarness();
      const error = await appErrorOf(
        run(tooLong, operation, commandOf({ reason: '👍🏽'.repeat(501) })),
      );
      expect(error.code).toBe('validation_error');
      expect(error.details).toEqual([
        {
          field: 'reason',
          code: 'too_long',
          message: '理由は500文字以内で入力してください。',
        },
      ]);
      expect(tooLong.calls).toEqual([]);

      const limit = currentHarness();
      const outcome = await run(
        limit,
        operation,
        commandOf({ reason: '👍🏽'.repeat(500) }),
      );
      expect(outcome.changed).toBe(true);
    });

    test('対象のコメントが存在しなければ、コメントが見つからない旨を返し、監査ログも書き込みも行わない', async () => {
      const harness = harnessOf({ comments: [] });

      const error = await appErrorOf(run(harness, operation));

      expect(error.kind).toBe(MODERATION_ERRORS.comment_not_found.kind);
      expect(error.code).toBe('comment_not_found');
      expect(error.message).toBe(MODERATION_ERRORS.comment_not_found.message);
      expect(harness.calls).toEqual(['comments.findByIds']);
    });

    test('既に同じ状態なら、監査ログも記録も作らず書き込みも通知もせずに、変化なしを返す', async () => {
      const harness = harnessOf({
        comments: [commentOf({ hiddenAt: sameHiddenAt })],
      });

      const outcome = await run(harness, operation);

      expect(outcome).toEqual({ changed: false, actionId: null });
      expect(harness.calls).toEqual(['comments.findByIds']);
      expect(harness.dispatched).toEqual([]);
    });

    test('照会の後に同じ状態へ変わり上流が変化なしを返したら、変化なしを返し、通知しない', async () => {
      const harness = currentHarness({
        writer: { kind: 'result', result: 'unchanged' },
      });

      const outcome = await run(harness, operation);

      expect(outcome).toEqual({ changed: false, actionId: null });
      expect(harness.calls).toEqual([
        'comments.findByIds',
        'audit.prepare',
        `writer.${writerMethod}`,
      ]);
      expect(harness.dispatched).toEqual([]);
    });

    test('照会の後にコメントが無くなり上流が対象なしを投げたら、コメントが見つからない旨をそのまま返し、通知しない', async () => {
      const harness = currentHarness({
        writer: { kind: 'throw', error: engagementError('comment_not_found') },
      });

      const error = await appErrorOf(run(harness, operation));

      expect(error.code).toBe('comment_not_found');
      expect(error.message).toBe(MODERATION_ERRORS.comment_not_found.message);
      expect(harness.dispatched).toEqual([]);
    });

    test('上流のその他の失敗はそのまま投げ、通知しない', async () => {
      const failure = new Error('D1の一括の書き込みに失敗しました');
      const harness = currentHarness({
        writer: { kind: 'throw', error: failure },
      });

      const error = await rejectionOf(run(harness, operation));

      expect(error).toBe(failure);
      expect(harness.dispatched).toEqual([]);
    });

    test('ログには措置の種類と識別子と結果だけを出し、本文・理由を出さない', async () => {
      const changed = currentHarness();
      await run(changed, operation);
      const unchanged = harnessOf({
        comments: [commentOf({ hiddenAt: sameHiddenAt })],
      });
      await run(unchanged, operation);

      expect(moderationLogs()).toEqual([
        {
          level: 'info',
          properties: {
            action,
            actionId: ACTION_ID,
            commentId: COMMENT_ID,
            operatorAdminId: ADMIN_ID,
            result: 'changed',
          },
        },
        {
          level: 'info',
          properties: {
            action,
            actionId: null,
            commentId: COMMENT_ID,
            operatorAdminId: ADMIN_ID,
            result: 'unchanged',
          },
        },
      ]);
      const serialized = JSON.stringify(
        logs.map(({ message, properties }) => ({ message, properties })),
      );
      for (const secret of [BODY, REASON]) {
        expect(serialized).not.toContain(secret);
      }
    });
  },
);

describe('DefaultCommentModerationService 措置の通知', () => {
  test('非公開化が確定したら、記録のIDで非公開化の通知を依頼する', async () => {
    const harness = harnessOf();

    await harness.service.hide(commandOf());

    expect(harness.dispatched).toEqual([ACTION_ID]);
    expect(harness.calls.indexOf('notifier.dispatch')).toBeGreaterThan(
      harness.calls.indexOf('writer.hideComment'),
    );
  });

  test('非公開化の通知の依頼が失敗しても措置は成功として返し、警告のログに措置の記録のIDだけを出す', async () => {
    const failure = new Error('メールの送信の依頼に失敗しました');
    const harness = harnessOf({ dispatchError: failure });

    const outcome = await harness.service.hide(commandOf());

    expect(outcome).toEqual({ changed: true, actionId: ACTION_ID });
    expect(moderationLogs()).toContainEqual({
      level: 'warning',
      properties: { error: failure, actionId: ACTION_ID },
    });
  });

  test('復元は通知を依頼しない', async () => {
    const harness = harnessOf({
      comments: [commentOf({ hiddenAt: HIDDEN_AT })],
    });

    const outcome = await harness.service.unhide(commandOf());

    expect(outcome).toEqual({ changed: true, actionId: ACTION_ID });
    expect(harness.dispatched).toEqual([]);
  });
});
