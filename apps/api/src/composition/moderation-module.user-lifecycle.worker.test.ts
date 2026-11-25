import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { type Container, ContainerModule } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import type { ModerationAction } from '../../common-lib/moderation/moderation-actions.ts';
import { userLifecycleEvents } from '../../db/schema/identity/user-lifecycle-events.ts';
import { users } from '../../db/schema/identity/users.ts';
import { ADMIN_PLATFORM_TYPES } from '../../lib/core/admin/identifiers.ts';
import type { AuditLogRecorder } from '../../lib/core/admin/audit-log.ts';
import { AppError } from '../../lib/core/errors/app-error.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { clearEngagementTables } from '../../lib/workers/engagement/testing/engagement-fixtures.ts';
import {
  after,
  emailOf,
  insertUser,
  userIdOf,
} from '../../lib/workers/identity/testing/identity-store-fixtures.ts';
import {
  db,
  moderationIdOf,
  OPERATOR_ADMIN_ID,
  readModerationRows,
} from '../../lib/workers/moderation/testing/moderation-record-fixtures.ts';
import type { AdministrativeWithdrawal } from '../application/identity/administrative-withdrawal.ts';
import { IDENTITY_TYPES } from '../application/identity/identity-types.ts';
import type { UserLifecycleCommitter } from '../application/identity/ports.ts';
import type { UserSuspension } from '../application/identity/user-suspension.ts';
import { MODERATION_TYPES } from '../application/moderation/moderation-types.ts';
import type { PendingModerationRecord } from '../application/moderation/pending-moderation-record.ts';
import type { ModerationWriteParticipation } from '../application/moderation/ports.ts';
import {
  createModerationWriteParticipants,
  type ModerationWriteParticipants,
} from '../infrastructure/moderation/moderation-write-participant.ts';
import {
  clearModerationWrites,
  createTestParticipant,
  type ParticipantNotePayload,
  PSEUDONYMOUS_ID,
  readModerationAuditLogs,
  readParticipantNotes,
  TEST_PARTICIPANT,
  TEST_PARTICIPANT_KIND,
} from '../infrastructure/moderation/testing/moderation-write-fixtures.ts';
import { resolverOf } from './container-resolver.ts';
import { MODULES } from './modules.ts';

const TARGET = 1;
const AT = after(60_000);
const REASON = '規約違反の投稿を繰り返したため';
const PASSWORD_HASH = 'pbkdf2-sha256$secret-hash-for-moderation-test';

type UserLifecycleEvent = 'suspended' | 'unsuspended' | 'withdrawn';

const ADMIN_OPERATOR = {
  kind: 'authenticated',
  subjectKind: 'admin',
  subjectId: OPERATOR_ADMIN_ID,
  sessionId: '01JQ0SESSION00000000000001',
} as const;

let participant = createTestParticipant();

// テストの中だけで参加者を登録し、空の初版の登録口の代わりに使う
const testParticipantModule = {
  bindings: new ContainerModule(({ bind, rebind }) => {
    bind(TEST_PARTICIPANT).toDynamicValue(() => participant);
    rebind<ModerationWriteParticipants>(
      MODERATION_TYPES.ModerationWriteParticipants,
    )
      .toDynamicValue((context) =>
        createModerationWriteParticipants(
          [{ kind: TEST_PARTICIPANT_KIND, participant: TEST_PARTICIPANT }],
          resolverOf(context),
        ),
      )
      .inSingletonScope();
  }),
};

function createContainer(): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: 'fetch',
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    [...MODULES, testParticipantModule],
  );
}

// 措置のユースケースが上流の操作の前に行う、監査ログの準備と保留中の措置の設定
function setPending(
  container: Container,
  action: ModerationAction,
  lifecycleEvent: UserLifecycleEvent,
  participation?: ModerationWriteParticipation<ParticipantNotePayload>,
): void {
  const audit = container
    .get<AuditLogRecorder>(ADMIN_PLATFORM_TYPES.AuditLogRecorder)
    .prepare({
      operatorAdminId: OPERATOR_ADMIN_ID,
      action,
      targetIds: [PSEUDONYMOUS_ID],
      reason: REASON,
      occurredAt: AT,
    });
  container
    .get<PendingModerationRecord>(MODERATION_TYPES.PendingModerationRecord)
    .set({
      record: {
        id: moderationIdOf(1),
        action,
        targetId: userIdOf(TARGET),
        subjectUserId: userIdOf(TARGET),
        productId: null,
        operatorAdminId: OPERATOR_ADMIN_ID,
        reason: REASON,
        noticeStatus: action === 'user.suspend' ? 'pending' : 'none',
      },
      lifecycleEvent,
      audit,
      participation,
    });
}

function pendingOf(container: Container): PendingModerationRecord {
  return container.get<PendingModerationRecord>(
    MODERATION_TYPES.PendingModerationRecord,
  );
}

async function readTarget() {
  const [row] = await db
    .select({
      status: users.status,
      deletedAt: users.deletedAt,
      lifecycleVersion: users.lifecycleVersion,
    })
    .from(users)
    .where(eq(users.id, userIdOf(TARGET)));
  return row;
}

async function readEvents() {
  return db
    .select({ id: userLifecycleEvents.id, type: userLifecycleEvents.type })
    .from(userLifecycleEvents)
    .where(eq(userLifecycleEvents.userId, userIdOf(TARGET)));
}

async function expectNothingWritten(): Promise<void> {
  expect(await readEvents()).toStrictEqual([]);
  expect(await readModerationRows()).toStrictEqual([]);
  expect(await readModerationAuditLogs()).toStrictEqual([]);
  expect(await readParticipantNotes()).toStrictEqual([]);
}

async function seedTarget(status: 'active' | 'suspended'): Promise<void> {
  await insertUser(TARGET, {
    pseudonymousId: PSEUDONYMOUS_ID,
    passwordHash: PASSWORD_HASH,
    status,
    suspendedAt: status === 'suspended' ? after(1) : null,
  });
}

const OPERATIONS = [
  {
    name: '停止',
    action: 'user.suspend',
    lifecycleEvent: 'suspended',
    initial: 'active',
    run: (container: Container) =>
      container
        .get<UserSuspension>(IDENTITY_TYPES.UserSuspension)
        .suspend(userIdOf(TARGET), AT),
    noticeStatus: 'pending',
  },
  {
    name: '停止解除',
    action: 'user.unsuspend',
    lifecycleEvent: 'unsuspended',
    initial: 'suspended',
    run: (container: Container) =>
      container
        .get<UserSuspension>(IDENTITY_TYPES.UserSuspension)
        .unsuspend(userIdOf(TARGET), AT),
    noticeStatus: 'none',
  },
  {
    name: '代理の退会',
    action: 'user.administrative-withdraw',
    lifecycleEvent: 'withdrawn',
    initial: 'active',
    run: (container: Container) =>
      container
        .get<AdministrativeWithdrawal>(IDENTITY_TYPES.AdministrativeWithdrawal)
        .withdraw({
          userId: userIdOf(TARGET),
          caller: 'admin',
          operator: ADMIN_OPERATOR,
          at: AT,
        }),
    noticeStatus: 'none',
  },
] as const;

beforeEach(async () => {
  participant = createTestParticipant();
  await clearModerationWrites();
  await clearEngagementTables();
});

describe.each(OPERATIONS)(
  '本物の$nameの確定を通した措置の記録',
  ({ action, lifecycleEvent, initial, run, noticeStatus }) => {
    test('保留中の措置がある要求では、記録(イベントのIDと日時)と監査ログを状態の変更と同じ一括の書き込みで確定する', async () => {
      await seedTarget(initial);
      const container = createContainer();
      setPending(container, action, lifecycleEvent);

      await run(container);

      const events = await readEvents();
      expect(events.map(({ type }) => type)).toStrictEqual([lifecycleEvent]);
      expect(await readModerationRows()).toStrictEqual([
        expect.objectContaining({
          id: moderationIdOf(1),
          action,
          targetKind: 'user',
          targetId: userIdOf(TARGET),
          subjectUserId: userIdOf(TARGET),
          productId: null,
          operatorAdminId: OPERATOR_ADMIN_ID,
          reason: REASON,
          lifecycleEventId: events[0]?.id,
          occurredAt: AT,
          noticeStatus,
        }),
      ]);
      expect(await readModerationAuditLogs()).toStrictEqual([
        expect.objectContaining({
          operatorAdminId: OPERATOR_ADMIN_ID,
          action,
          targetKind: 'user',
          reason: REASON,
          occurredAt: AT,
          targets: [{ targetKind: 'user', targetId: PSEUDONYMOUS_ID }],
        }),
      ]);
      expect(pendingOf(container).wasTaken()).toBe(true);
    });

    test('参加の値があれば、参加者の文も同じ一括の書き込みで確定し、文脈の措置のIDは記録のIDと一致する', async () => {
      await seedTarget(initial);
      const container = createContainer();
      setPending(container, action, lifecycleEvent, {
        kind: TEST_PARTICIPANT_KIND,
        payload: { note: '通報の対応' },
      });

      await run(container);

      expect(participant.received).toStrictEqual([
        [
          { note: '通報の対応' },
          {
            actionId: moderationIdOf(1),
            action,
            targetId: userIdOf(TARGET),
            occurredAt: AT,
          },
        ],
      ]);
      expect(await readParticipantNotes()).toStrictEqual([
        { reason: '通報の対応', detail: { actionId: moderationIdOf(1) } },
      ]);
      expect(await readModerationRows()).toHaveLength(1);
    });

    test('参加者の文がNOT NULL制約に違反すると、利用者の状態・イベント・記録・監査ログを含む全体を取り消す', async () => {
      await seedTarget(initial);
      const before = await readTarget();
      const container = createContainer();
      setPending(container, action, lifecycleEvent, {
        kind: TEST_PARTICIPANT_KIND,
        payload: { note: '通報の対応', violate: true },
      });

      await expect(run(container)).rejects.toThrow(
        /NOT NULL constraint failed: admin_audit_logs\.action/u,
      );

      expect(await readTarget()).toStrictEqual(before);
      await expectNothingWritten();
    });

    test('登録の無い種類の参加はAppErrorでない内部のエラーになり、何も書かない', async () => {
      await seedTarget(initial);
      const before = await readTarget();
      const container = createContainer();
      setPending(container, action, lifecycleEvent, {
        kind: 'test-spec.unregistered',
        payload: { note: '通報の対応' },
      });

      const failure = run(container);

      await expect(failure).rejects.toThrow(
        '措置の書き込みの参加者に登録の無い種類です: "test-spec.unregistered"',
      );
      await expect(failure).rejects.not.toBeInstanceOf(AppError);
      expect(await readTarget()).toStrictEqual(before);
      await expectNothingWritten();
    });

    test('記録と監査ログに、メールアドレス・パスワードのハッシュ・ハンドル・ニックネームが入らない', async () => {
      await seedTarget(initial);
      const container = createContainer();
      setPending(container, action, lifecycleEvent);

      await run(container);

      const written = JSON.stringify([
        await readModerationRows(),
        await readModerationAuditLogs(),
      ]);
      for (const secret of [
        emailOf(TARGET),
        PASSWORD_HASH,
        `user${String(TARGET)}`,
        `利用者${String(TARGET)}`,
      ]) {
        expect(written).not.toContain(secret);
      }
    });
  },
);

describe('措置にならない利用者のライフサイクルの確定', () => {
  test('既に同じ状態の停止はunchangedで、保留中の措置を取り出さず何も残さない', async () => {
    await seedTarget('suspended');
    const container = createContainer();
    setPending(container, 'user.suspend', 'suspended');

    await expect(
      container
        .get<UserSuspension>(IDENTITY_TYPES.UserSuspension)
        .suspend(userIdOf(TARGET), AT),
    ).resolves.toBe('unchanged');

    expect(pendingOf(container).wasTaken()).toBe(false);
    await expectNothingWritten();
  });

  test('版の競合で停止が確定しなければ、記録も監査ログも残さない', async () => {
    await seedTarget('active');
    const before = await readTarget();
    const container = createContainer();
    setPending(container, 'user.suspend', 'suspended');

    await expect(
      container
        .get<UserLifecycleCommitter>(IDENTITY_TYPES.UserLifecycleCommitter)
        .commit({
          kind: 'suspend',
          userId: userIdOf(TARGET),
          expectedVersion: (before?.lifecycleVersion ?? 0) + 1,
          at: AT,
        }),
    ).rejects.toMatchObject({ code: 'account_state_conflict' });

    expect(await readTarget()).toStrictEqual(before);
    await expectNothingWritten();
  });

  test('利用者本人の退会は、保留中の措置が無いため記録も監査ログも作らない', async () => {
    await seedTarget('active');
    const before = await readTarget();

    await createContainer()
      .get<UserLifecycleCommitter>(IDENTITY_TYPES.UserLifecycleCommitter)
      .commit({
        kind: 'withdraw',
        userId: userIdOf(TARGET),
        expectedVersion: before?.lifecycleVersion ?? 0,
        at: AT,
      });

    expect((await readEvents()).map(({ type }) => type)).toStrictEqual([
      'withdrawn',
    ]);
    expect(await readModerationRows()).toStrictEqual([]);
    expect(await readModerationAuditLogs()).toStrictEqual([]);
  });

  test('別の利用者を対象にした保留中の措置は取り出さず、確定した利用者の記録を作らない', async () => {
    await seedTarget('active');
    await insertUser(2);
    const container = createContainer();
    setPending(container, 'user.suspend', 'suspended');

    await container
      .get<UserSuspension>(IDENTITY_TYPES.UserSuspension)
      .suspend(userIdOf(2), AT);

    expect(pendingOf(container).wasTaken()).toBe(false);
    expect(await readModerationRows()).toStrictEqual([]);
    expect(await readModerationAuditLogs()).toStrictEqual([]);
  });
});
