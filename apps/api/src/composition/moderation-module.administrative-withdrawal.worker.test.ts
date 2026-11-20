import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { type Container, ContainerModule } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import { userLifecycleEvents } from '../../db/schema/identity/user-lifecycle-events.ts';
import { users } from '../../db/schema/identity/users.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import { EMAIL_SEND_MESSAGE } from '../../lib/core/email/send-message.ts';
import { RUN_USER_LIFECYCLE_MESSAGE } from '../../lib/core/messaging/contracts/identity.ts';
import type { Principal } from '../../lib/core/session/session-view.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import { clearEngagementTables } from '../../lib/workers/engagement/testing/engagement-fixtures.ts';
import {
  after,
  emailOf,
  insertUser,
  userIdOf,
} from '../../lib/workers/identity/testing/identity-store-fixtures.ts';
import type { MessagePublisher } from '../../lib/workers/messaging/queue-publisher.ts';
import {
  db,
  OPERATOR_ADMIN_ID,
  readModerationRows,
} from '../../lib/workers/moderation/testing/moderation-record-fixtures.ts';
import type {
  AdministrativeWithdrawalCommandInput,
  AdministrativeWithdrawalService,
} from '../application/moderation/administrative-withdrawal-service.ts';
import { MODERATION_TYPES } from '../application/moderation/moderation-types.ts';
import type { PendingModerationRecord } from '../application/moderation/pending-moderation-record.ts';
import {
  clearModerationWrites,
  PSEUDONYMOUS_ID,
  readModerationAuditLogs,
} from '../infrastructure/moderation/testing/moderation-write-fixtures.ts';
import { MODULES } from './modules.ts';

const TARGET = 1;
const AT = after(60_000);
const REASON = '本人から問い合わせのメールで退会の依頼を受けたため';
const PASSWORD_HASH = 'pbkdf2-sha256$secret-hash-for-withdrawal-test';

const ADMIN_PRINCIPAL: Principal = {
  kind: 'authenticated',
  subjectKind: 'admin',
  subjectId: OPERATOR_ADMIN_ID,
  sessionId: '01JQ0SESSION00000000000001',
};

interface Harness {
  readonly container: Container;
  readonly published: string[];
}

// 送信の依頼はキューへの発行で行われるため、発行の種類を記録して利用者へのメールの依頼が無いことを確かめる
function createHarness(): Harness {
  const published: string[] = [];
  const recordingPublisher = new ContainerModule(({ rebind }) => {
    rebind<MessagePublisher>(PLATFORM_TYPES.MessagePublisher).toConstantValue({
      publish: (contract) => {
        published.push(contract.type);
        return Promise.resolve(crypto.randomUUID());
      },
    });
  });
  const container = createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: 'fetch',
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    [...MODULES, { bindings: recordingPublisher }],
  );
  return { container, published };
}

function serviceOf(container: Container): AdministrativeWithdrawalService {
  return container.get<AdministrativeWithdrawalService>(
    MODERATION_TYPES.AdministrativeWithdrawalService,
  );
}

const inputOf = (
  overrides: Partial<AdministrativeWithdrawalCommandInput> = {},
): AdministrativeWithdrawalCommandInput => ({
  userId: userIdOf(TARGET),
  reason: REASON,
  operator: { adminId: OPERATOR_ADMIN_ID },
  caller: 'admin',
  principal: ADMIN_PRINCIPAL,
  at: AT,
  ...overrides,
});

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
}

beforeEach(async () => {
  await clearModerationWrites();
  await clearEngagementTables();
});

describe('本物の退会の確定を通した代理の退会', () => {
  test.each([
    { label: '有効な', status: 'active', suspendedAt: null },
    { label: '停止中の', status: 'suspended', suspendedAt: after(1) },
  ] as const)(
    '$label利用者を退会させ、記録と仮名化IDを対象にした監査ログを退会と同じ一括の書き込みで確定し、メールの送信を依頼しない',
    async ({ status, suspendedAt }) => {
      await insertUser(TARGET, {
        pseudonymousId: PSEUDONYMOUS_ID,
        passwordHash: PASSWORD_HASH,
        status,
        suspendedAt,
      });
      const { container, published } = createHarness();

      const outcome = await serviceOf(container).withdraw(inputOf());

      expect((await readTarget())?.deletedAt).toStrictEqual(AT);
      const events = await readEvents();
      expect(events.map(({ type }) => type)).toStrictEqual(['withdrawn']);
      expect(outcome.changed).toBe(true);
      expect(outcome.actionId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/u);
      expect(await readModerationRows()).toStrictEqual([
        expect.objectContaining({
          id: outcome.actionId,
          action: 'user.administrative-withdraw',
          targetKind: 'user',
          targetId: userIdOf(TARGET),
          subjectUserId: userIdOf(TARGET),
          productId: null,
          operatorAdminId: OPERATOR_ADMIN_ID,
          reason: REASON,
          lifecycleEventId: events[0]?.id,
          occurredAt: AT,
          noticeStatus: 'none',
          noticeRequestedAt: null,
        }),
      ]);
      expect(await readModerationAuditLogs()).toStrictEqual([
        expect.objectContaining({
          operatorAdminId: OPERATOR_ADMIN_ID,
          action: 'user.administrative-withdraw',
          targetKind: 'user',
          reason: REASON,
          detail: {},
          occurredAt: AT,
          targets: [{ targetKind: 'user', targetId: PSEUDONYMOUS_ID }],
        }),
      ]);
      expect(published).toContain(RUN_USER_LIFECYCLE_MESSAGE.type);
      expect(published).not.toContain(EMAIL_SEND_MESSAGE.type);
    },
  );

  test('記録と監査ログに、メールアドレス・パスワードのハッシュ・ハンドル・ニックネームが入らない', async () => {
    await insertUser(TARGET, {
      pseudonymousId: PSEUDONYMOUS_ID,
      passwordHash: PASSWORD_HASH,
    });
    const { container } = createHarness();

    await serviceOf(container).withdraw(inputOf());

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

  test('退会済みの利用者は利用者が見つからない旨を返し、何も書かない', async () => {
    await insertUser(TARGET, {
      pseudonymousId: PSEUDONYMOUS_ID,
      deletedAt: after(1),
    });
    const before = await readTarget();
    const { container, published } = createHarness();

    await expect(
      serviceOf(container).withdraw(inputOf()),
    ).rejects.toMatchObject({ code: 'user_not_found' });

    expect(await readTarget()).toStrictEqual(before);
    await expectNothingWritten();
    expect(published).toStrictEqual([]);
  });

  test('管理者側でない呼び出し元の退会は上流が拒否し、何も書かず保留中の措置を残さない', async () => {
    await insertUser(TARGET, { pseudonymousId: PSEUDONYMOUS_ID });
    const before = await readTarget();
    const { container } = createHarness();

    await expect(
      serviceOf(container).withdraw(inputOf({ caller: 'client' })),
    ).rejects.toMatchObject({ code: 'forbidden' });

    expect(await readTarget()).toStrictEqual(before);
    await expectNothingWritten();
    expect(
      container
        .get<PendingModerationRecord>(MODERATION_TYPES.PendingModerationRecord)
        .take({ type: 'withdrawn', targetId: userIdOf(TARGET) }),
    ).toBeUndefined();
  });
});
