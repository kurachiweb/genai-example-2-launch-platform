import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { configureSync, type LogRecord, resetSync } from '@logtape/logtape';

import type {
  AuditEntryInput,
  AuditLogRecorder,
  PreparedAuditEntry,
} from '../../../lib/core/admin/audit-log.ts';
import type {
  AdminRatingDirectory,
  AdminRatingRecord,
} from '../../../lib/core/engagement/ports.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import { engagementError } from '../engagement/engagement-errors.ts';
import { MODERATION_ERRORS } from './moderation-errors.ts';
import type {
  EngagementModerationChange,
  EngagementModerationWrite,
  EngagementModerationWriter,
  ModerationCommand,
  ModerationWriteParticipation,
} from './ports.ts';
import {
  DefaultRatingModerationService,
  type RatingModerationService,
} from './rating-moderation-service.ts';

const AT = new Date('2026-11-20T03:00:00.000Z');
const RATING_ID = '01JQ0RTG000000000000000001';
const RATER_ID = '01JQ0USR000000000000000001';
const PRODUCT_ID = '01JQ0PRD000000000000000001';
const ADMIN_ID = '01JQ0ADM000000000000000001';
const ACTION_ID = '01JQ0MDR000000000000000001';
const REASON = '同じ利用者による複数のアカウントからの評価のため';

type Operation = 'invalidate' | 'revalidate';
type WriterOperation = 'invalidateRating' | 'revalidateRating';

const OPERATIONS = [
  {
    operation: 'invalidate',
    label: '無効化',
    action: 'rating.invalidate',
    writerOperation: 'invalidateRating',
    currentInvalidatedAt: null,
    sameInvalidatedAt: new Date('2026-11-19T00:00:00.000Z'),
  },
  {
    operation: 'revalidate',
    label: '無効化の取り消し',
    action: 'rating.revalidate',
    writerOperation: 'revalidateRating',
    currentInvalidatedAt: new Date('2026-11-19T00:00:00.000Z'),
    sameInvalidatedAt: null,
  },
] as const;

const ratingOf = (
  overrides: Partial<AdminRatingRecord> = {},
): AdminRatingRecord => ({
  ratingId: RATING_ID,
  productId: PRODUCT_ID,
  userId: RATER_ID,
  score: 1,
  invalidatedAt: null,
  createdAt: new Date('2026-11-01T00:00:00.000Z'),
  updatedAt: new Date('2026-11-02T00:00:00.000Z'),
  ...overrides,
});

const commandOf = (
  overrides: Partial<ModerationCommand> = {},
): ModerationCommand => ({
  targetId: RATING_ID,
  reason: `  ${REASON}\n`,
  operator: { adminId: ADMIN_ID },
  at: AT,
  ...overrides,
});

type WriterBehavior =
  | { readonly kind: 'result'; readonly result: EngagementModerationChange }
  | { readonly kind: 'throw'; readonly error: Error };

interface HarnessOptions {
  readonly ratings?: readonly AdminRatingRecord[];
  readonly writer?: WriterBehavior;
}

const harnessOf = (options: HarnessOptions = {}) => {
  const calls: string[] = [];
  const lookups: (readonly string[])[] = [];
  const prepared: AuditEntryInput[] = [];
  const preparedEntries: PreparedAuditEntry[] = [];
  const writes: {
    operation: WriterOperation;
    write: EngagementModerationWrite;
  }[] = [];
  const ratings: AdminRatingDirectory = {
    search: () => Promise.reject(new Error('一覧の検索は呼ばれない想定です')),
    findByIds: (ratingIds) => {
      calls.push('ratings.findByIds');
      lookups.push(ratingIds);
      const found = (options.ratings ?? [ratingOf()]).filter(({ ratingId }) =>
        ratingIds.includes(ratingId),
      );
      return Promise.resolve(
        new Map(found.map((rating) => [rating.ratingId, rating])),
      );
    },
  };
  const writeOf = (
    operation: WriterOperation,
    write: EngagementModerationWrite,
  ): Promise<EngagementModerationChange> => {
    calls.push(`writer.${operation}`);
    writes.push({ operation, write });
    const behavior = options.writer ?? { kind: 'result', result: 'changed' };
    if (behavior.kind === 'throw') {
      return Promise.reject(behavior.error);
    }
    return Promise.resolve(behavior.result);
  };
  const writer: EngagementModerationWriter = {
    hideComment: () =>
      Promise.reject(new Error('コメントの非公開化は呼ばれない想定です')),
    unhideComment: () =>
      Promise.reject(new Error('コメントの復元は呼ばれない想定です')),
    invalidateRating: (write) => writeOf('invalidateRating', write),
    revalidateRating: (write) => writeOf('revalidateRating', write),
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
        targetKind: 'rating',
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
  const service: RatingModerationService = new DefaultRatingModerationService(
    ratings,
    writer,
    auditLog,
    { generate: () => ACTION_ID },
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
  'DefaultRatingModerationService $label',
  ({
    operation,
    action,
    writerOperation,
    currentInvalidatedAt,
    sameInvalidatedAt,
  }) => {
    const currentHarness = (options: HarnessOptions = {}) =>
      harnessOf({
        ratings: [ratingOf({ invalidatedAt: currentInvalidatedAt })],
        ...options,
      });

    test('前後の空白を除いた理由で、評価のIDを対象にした監査ログを準備してから書き込みの単位を呼び、記録のIDを返す', async () => {
      const harness = currentHarness();

      const outcome = await run(harness, operation);

      expect(outcome).toEqual({ changed: true, actionId: ACTION_ID });
      expect(harness.lookups).toEqual([[RATING_ID]]);
      expect(harness.prepared).toEqual([
        {
          operatorAdminId: ADMIN_ID,
          action,
          targetIds: [RATING_ID],
          reason: REASON,
          occurredAt: AT,
        },
      ]);
      expect(harness.calls).toEqual([
        'ratings.findByIds',
        'audit.prepare',
        `writer.${writerOperation}`,
      ]);
    });

    test('書き込みの単位へ、採番した記録のIDと評価者とプロダクトを持つ記録・準備した監査ログ・対象・日時を渡す', async () => {
      const harness = currentHarness();

      await run(harness, operation);

      expect(harness.preparedEntries).toHaveLength(1);
      const [audit] = harness.preparedEntries;
      if (audit === undefined) {
        throw new Error('監査ログが準備されていません');
      }
      expect(harness.writes).toEqual([
        {
          operation: writerOperation,
          write: {
            record: {
              id: ACTION_ID,
              action,
              targetId: RATING_ID,
              subjectUserId: RATER_ID,
              productId: PRODUCT_ID,
              operatorAdminId: ADMIN_ID,
              reason: REASON,
              lifecycleEventId: null,
              occurredAt: AT,
              noticeStatus: 'none',
            },
            audit,
            targetId: RATING_ID,
            at: AT,
            participation: undefined,
          },
        },
      ]);
      expect(harness.writes[0]?.write.audit).toBe(audit);
    });

    test('評価者へ通知しないため、記録の通知の状態を送り直しの対象にならないnoneにする', async () => {
      const harness = currentHarness();

      await run(harness, operation);

      expect(harness.writes[0]?.write.record.noticeStatus).toBe('none');
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
      expect(harness.writes[0]?.write.participation).toBe(participation);
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

    test('対象の評価が存在しない・評価者が取り消した(照会に無い)なら、評価が見つからない旨を返し、監査ログも書き込みも行わない', async () => {
      const harness = harnessOf({ ratings: [] });

      const error = await appErrorOf(run(harness, operation));

      expect(error.kind).toBe(MODERATION_ERRORS.rating_not_found.kind);
      expect(error.code).toBe('rating_not_found');
      expect(error.message).toBe(MODERATION_ERRORS.rating_not_found.message);
      expect(harness.calls).toEqual(['ratings.findByIds']);
    });

    test('既に同じ状態なら、監査ログも書き込みも行わずに変化なしを返す', async () => {
      const harness = harnessOf({
        ratings: [ratingOf({ invalidatedAt: sameInvalidatedAt })],
      });

      const outcome = await run(harness, operation);

      expect(outcome).toEqual({ changed: false, actionId: null });
      expect(harness.calls).toEqual(['ratings.findByIds']);
    });

    test('照会の後に同じ状態へ変わり書き込みの単位が変化なしを返したら、記録のIDを返さずに変化なしを返す', async () => {
      const harness = currentHarness({
        writer: { kind: 'result', result: 'unchanged' },
      });

      const outcome = await run(harness, operation);

      expect(outcome).toEqual({ changed: false, actionId: null });
      expect(harness.calls).toEqual([
        'ratings.findByIds',
        'audit.prepare',
        `writer.${writerOperation}`,
      ]);
    });

    test('照会の後に評価者が取り消し書き込みの単位が評価なしを投げたら、評価が見つからない旨を返す', async () => {
      const harness = currentHarness({
        writer: { kind: 'throw', error: engagementError('rating_not_found') },
      });

      const error = await appErrorOf(run(harness, operation));

      expect(error.kind).toBe('not_found');
      expect(error.code).toBe('rating_not_found');
      expect(error.message).toBe(MODERATION_ERRORS.rating_not_found.message);
    });

    test('書き込みの単位のその他の失敗はそのまま投げる', async () => {
      const failure = new Error('D1の一括の書き込みに失敗しました');
      const harness = currentHarness({
        writer: { kind: 'throw', error: failure },
      });

      const error = await rejectionOf(run(harness, operation));

      expect(error).toBe(failure);
    });

    test('ログには措置の種類と識別子と結果だけを出し、理由を出さない', async () => {
      await run(currentHarness(), operation);
      await run(
        harnessOf({
          ratings: [ratingOf({ invalidatedAt: sameInvalidatedAt })],
        }),
        operation,
      );
      await run(
        currentHarness({ writer: { kind: 'result', result: 'unchanged' } }),
        operation,
      );

      const unchanged = {
        level: 'info' as const,
        properties: {
          action,
          ratingId: RATING_ID,
          operatorAdminId: ADMIN_ID,
          actionId: null,
          result: 'unchanged',
        },
      };
      expect(moderationLogs()).toEqual([
        {
          level: 'info',
          properties: {
            action,
            ratingId: RATING_ID,
            operatorAdminId: ADMIN_ID,
            actionId: ACTION_ID,
            result: 'changed',
          },
        },
        unchanged,
        unchanged,
      ]);
      expect(JSON.stringify(moderationLogs())).not.toContain(REASON);
    });
  },
);
