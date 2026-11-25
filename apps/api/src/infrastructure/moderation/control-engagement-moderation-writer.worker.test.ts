import type { ServiceIdentifier } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import type { ModerationAction } from '../../../common-lib/moderation/moderation-actions.ts';
import { AppError } from '../../../lib/core/errors/app-error.ts';
import { D1CommentStatements } from '../../../lib/workers/engagement/comment-statements.ts';
import { D1RatingStatements } from '../../../lib/workers/engagement/rating-statements.ts';
import {
  after,
  clearEngagementTables,
  commentIdOf,
  insertComment,
  insertLaunch,
  insertProduct,
  insertRating,
  insertUser,
  productIdOf,
  ratingIdOf,
  readComment,
  readRating,
  T0,
  userIdOf,
} from '../../../lib/workers/engagement/testing/engagement-fixtures.ts';
import { D1ModerationRecordStore } from '../../../lib/workers/moderation/d1-moderation-record-store.ts';
import {
  db,
  moderationIdOf,
  newRecordOf,
  readModerationRows,
} from '../../../lib/workers/moderation/testing/moderation-record-fixtures.ts';
import type {
  EngagementModerationWrite,
  EngagementModerationWriter,
  ModerationWriteParticipation,
} from '../../application/moderation/ports.ts';
import { D1CommentModerationControl } from '../engagement/comment-moderation-control.ts';
import { D1RatingModerationControl } from '../engagement/rating-moderation-control.ts';
import { ControlEngagementModerationWriter } from './control-engagement-moderation-writer.ts';
import { D1ModerationStatements } from './d1-moderation-statements.ts';
import { createModerationWriteParticipants } from './moderation-write-participant.ts';
import {
  auditLogIdOf,
  auditOf,
  clearModerationWrites,
  createTestParticipant,
  type ParticipantNotePayload,
  readModerationAuditLogs,
  readParticipantNotes,
  TEST_PARTICIPANT,
  TEST_PARTICIPANT_KIND,
} from './testing/moderation-write-fixtures.ts';

const OWNER = 1;
const AUTHOR = 2;
const PRODUCT = 1;
const LAUNCH = 1;
const COMMENT = 1;
const RATING = 1;
const MISSING = 99;
const AT = after(60_000);
const REASON = '規約に反する内容のため';

type Operation = keyof EngagementModerationWriter;

interface Case {
  readonly operation: Operation;
  readonly action: ModerationAction;
  readonly targetKind: 'comment' | 'rating';
  readonly targetId: string;
  readonly readState: () => Promise<Date | null | undefined>;
  readonly changedState: Date | null;
  readonly missingCode: string;
}

const readCommentHiddenAt = async () => (await readComment(COMMENT))?.hiddenAt;

const readRatingInvalidatedAt = async () =>
  (await readRating(RATING))?.invalidatedAt;

const CASES: readonly Case[] = [
  {
    operation: 'hideComment',
    action: 'comment.hide',
    targetKind: 'comment',
    targetId: commentIdOf(COMMENT),
    readState: readCommentHiddenAt,
    changedState: AT,
    missingCode: 'comment_not_found',
  },
  {
    operation: 'unhideComment',
    action: 'comment.unhide',
    targetKind: 'comment',
    targetId: commentIdOf(COMMENT),
    readState: readCommentHiddenAt,
    changedState: null,
    missingCode: 'comment_not_found',
  },
  {
    operation: 'invalidateRating',
    action: 'rating.invalidate',
    targetKind: 'rating',
    targetId: ratingIdOf(RATING),
    readState: readRatingInvalidatedAt,
    changedState: AT,
    missingCode: 'rating_not_found',
  },
  {
    operation: 'revalidateRating',
    action: 'rating.revalidate',
    targetKind: 'rating',
    targetId: ratingIdOf(RATING),
    readState: readRatingInvalidatedAt,
    changedState: null,
    missingCode: 'rating_not_found',
  },
];

let participant = createTestParticipant();

function createWriter(): EngagementModerationWriter {
  return new ControlEngagementModerationWriter(
    new D1ModerationStatements(db, new D1ModerationRecordStore(db)),
    createModerationWriteParticipants(
      [{ kind: TEST_PARTICIPANT_KIND, participant: TEST_PARTICIPANT }],
      <T>(identifier: ServiceIdentifier<T>): T => {
        if (identifier !== TEST_PARTICIPANT) {
          throw new Error('登録の無い識別子を解決しようとしました');
        }
        return participant as T;
      },
    ),
    new D1CommentModerationControl(new D1CommentStatements(db)),
    new D1RatingModerationControl(new D1RatingStatements(db)),
  );
}

function writeOf(
  { action, targetKind, targetId }: Case,
  participation?: ModerationWriteParticipation<ParticipantNotePayload>,
): EngagementModerationWrite {
  return {
    record: newRecordOf(1, {
      action,
      targetId,
      subjectUserId: userIdOf(AUTHOR),
      productId: productIdOf(PRODUCT),
      reason: REASON,
      occurredAt: AT,
      noticeStatus: action === 'comment.hide' ? 'pending' : 'none',
    }),
    audit: auditOf({
      index: 1,
      action,
      targetKind,
      targetId,
      occurredAt: AT,
      reason: REASON,
    }),
    targetId,
    at: AT,
    ...(participation === undefined ? {} : { participation }),
  };
}

// 変更の前の状態(非公開化・無効化なら未設定、復元・取り消しなら設定済み)の対象を置く
async function seedTargets(initial: Date | null): Promise<void> {
  await insertComment({
    index: COMMENT,
    product: PRODUCT,
    launch: LAUNCH,
    author: AUTHOR,
    columns: { hiddenAt: initial },
  });
  await insertRating({
    index: RATING,
    product: PRODUCT,
    user: AUTHOR,
    columns: { invalidatedAt: initial },
  });
}

const initialOf = ({ changedState }: Case): Date | null =>
  changedState === null ? T0 : null;

beforeEach(async () => {
  participant = createTestParticipant();
  await clearModerationWrites();
  await clearEngagementTables();
  await insertUser(OWNER, { emailVerifiedAt: T0 });
  await insertUser(AUTHOR, { emailVerifiedAt: T0 });
  await insertProduct(PRODUCT, OWNER);
  await insertLaunch(LAUNCH, PRODUCT, {
    launchDate: '2026-11-10',
    outcome: 'won',
    decidedAt: T0,
  });
});

describe.each(CASES)(
  'ControlEngagementModerationWriter.$operation',
  (testCase) => {
    test('engagementの操作口へ記録と監査ログの文を渡し、状態の変更と同じ一括の書き込みで確定してchangedを返す', async () => {
      await seedTargets(initialOf(testCase));

      const result = await createWriter()[testCase.operation](
        writeOf(testCase),
      );

      expect(result).toBe('changed');
      expect(await testCase.readState()).toStrictEqual(testCase.changedState);
      expect(await readModerationRows()).toStrictEqual([
        expect.objectContaining({
          id: moderationIdOf(1),
          action: testCase.action,
          targetKind: testCase.targetKind,
          targetId: testCase.targetId,
          reason: REASON,
          occurredAt: AT,
        }),
      ]);
      expect(await readModerationAuditLogs()).toStrictEqual([
        expect.objectContaining({
          id: auditLogIdOf(1),
          action: testCase.action,
          targets: [
            { targetKind: testCase.targetKind, targetId: testCase.targetId },
          ],
        }),
      ]);
      expect(participant.received).toStrictEqual([]);
    });

    test('参加の値があれば参加者の文も同じ一括の書き込みで確定し、文脈の措置のIDは記録のIDと一致する', async () => {
      await seedTargets(initialOf(testCase));

      await createWriter()[testCase.operation](
        writeOf(testCase, {
          kind: TEST_PARTICIPANT_KIND,
          payload: { note: '通報の対応' },
        }),
      );

      expect(participant.received).toStrictEqual([
        [
          { note: '通報の対応' },
          {
            actionId: moderationIdOf(1),
            action: testCase.action,
            targetId: testCase.targetId,
            occurredAt: AT,
          },
        ],
      ]);
      expect(await readParticipantNotes()).toStrictEqual([
        { reason: '通報の対応', detail: { actionId: moderationIdOf(1) } },
      ]);
      expect(await readModerationRows()).toHaveLength(1);
    });

    test('参加者の文がNOT NULL制約に違反すると、状態の変更・記録・監査ログごと取り消す', async () => {
      const initial = initialOf(testCase);
      await seedTargets(initial);

      await expect(
        createWriter()[testCase.operation](
          writeOf(testCase, {
            kind: TEST_PARTICIPANT_KIND,
            payload: { note: '通報の対応', violate: true },
          }),
        ),
      ).rejects.toThrow(
        /NOT NULL constraint failed: admin_audit_logs\.action/u,
      );

      expect(await testCase.readState()).toStrictEqual(initial);
      expect(await readModerationRows()).toStrictEqual([]);
      expect(await readModerationAuditLogs()).toStrictEqual([]);
      expect(await readParticipantNotes()).toStrictEqual([]);
    });

    test('登録の無い種類の参加はAppErrorでない内部のエラーになり、何も書かない', async () => {
      const initial = initialOf(testCase);
      await seedTargets(initial);

      const failure = createWriter()[testCase.operation](
        writeOf(testCase, {
          kind: 'test-spec.unregistered',
          payload: { note: '通報の対応' },
        }),
      );

      await expect(failure).rejects.toThrow(
        '措置の書き込みの参加者に登録の無い種類です: "test-spec.unregistered"',
      );
      await expect(failure).rejects.not.toBeInstanceOf(AppError);
      expect(await testCase.readState()).toStrictEqual(initial);
      expect(await readModerationRows()).toStrictEqual([]);
      expect(await readModerationAuditLogs()).toStrictEqual([]);
    });

    test('既に目的の状態ならunchangedを返し、記録・監査ログ・参加者の文を残さない', async () => {
      await seedTargets(testCase.changedState === null ? null : T0);

      const result = await createWriter()[testCase.operation](
        writeOf(testCase, {
          kind: TEST_PARTICIPANT_KIND,
          payload: { note: '通報の対応' },
        }),
      );

      expect(result).toBe('unchanged');
      expect(await readModerationRows()).toStrictEqual([]);
      expect(await readModerationAuditLogs()).toStrictEqual([]);
      expect(await readParticipantNotes()).toStrictEqual([]);
    });

    test('対象が無ければ上流の不在のエラーを投げ、何も書かない', async () => {
      await seedTargets(initialOf(testCase));
      const write = writeOf(testCase);

      await expect(
        createWriter()[testCase.operation]({
          ...write,
          targetId:
            testCase.targetKind === 'comment'
              ? commentIdOf(MISSING)
              : ratingIdOf(MISSING),
        }),
      ).rejects.toMatchObject({ code: testCase.missingCode });
      expect(await readModerationRows()).toStrictEqual([]);
      expect(await readModerationAuditLogs()).toStrictEqual([]);
    });
  },
);
