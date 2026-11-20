import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import type { Container } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import { users } from '../../db/schema/identity/users.ts';
import { MODERATION_USER_SUSPENDED_EMAIL } from '../../lib/core/email/kinds/ugc-moderation.ts';
import type {
  EmailSendRequest,
  EmailSender,
} from '../../lib/core/email/ports.ts';
import { ENGAGEMENT_PLATFORM_TYPES } from '../../lib/core/engagement/identifiers.ts';
import type { CommentStore } from '../../lib/core/engagement/ports.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../lib/core/identity/identifiers.ts';
import type { UserContactDirectory } from '../../lib/core/identity/ports.ts';
import { MODERATION_PLATFORM_TYPES } from '../../lib/core/moderation/identifiers.ts';
import type { ModerationRecordStore } from '../../lib/core/moderation/ports.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../lib/core/product/identifiers.ts';
import type { ProductDirectory } from '../../lib/core/product/ports.ts';
import type { ScheduledJobContext } from '../../lib/core/scheduling/cron-registry.ts';
import { parseBusinessDate } from '../../lib/core/time/business-time.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  emailOf,
  insertUser,
  userIdOf,
} from '../../lib/workers/identity/testing/identity-store-fixtures.ts';
import type { ModerationRecordStatements } from '../../lib/workers/moderation/moderation-record-statements.ts';
import {
  clearModerationRecords,
  db,
  moderationIdOf,
  newRecordOf,
  readModerationRows,
} from '../../lib/workers/moderation/testing/moderation-record-fixtures.ts';
import { ModerationMaintenanceJob } from '../application/moderation/jobs/moderation-maintenance-job.ts';
import { EmailModerationNotifier } from '../application/moderation/moderation-notifier.ts';
import type {
  ModerationIncident,
  ModerationIncidentContext,
  ModerationIncidentReporter,
} from '../application/moderation/ports.ts';
import { MODULES } from './modules.ts';

const HOUR_MS = 60 * 60 * 1000;

// 業務日付2026-11-20の業務時刻4:21
const SCHEDULED_TIME = new Date('2026-11-20T12:21:00.000Z');
const NEXT_DAY = new Date(SCHEDULED_TIME.getTime() + 24 * HOUR_MS);
const ONE_HOUR_BEFORE = new Date(SCHEDULED_TIME.getTime() - HOUR_MS);
const THREE_YEARS_BEFORE = new Date('2023-11-20T12:21:00.000Z');
const CLIENT_ORIGIN = 'https://client.example';
const JOB_NAME = 'ugc-moderation.maintenance';

const STALE = 1;
const RECENT = 2;
const REQUESTED = 3;
const NO_RECIPIENT = 4;
const EXPIRED = 5;
const RETAINED = 6;

function contextOf(scheduledTime: Date, date: string): ScheduledJobContext {
  return {
    scheduledTime,
    cron: '21 12 * * *',
    business: {
      date: parseBusinessDate(date),
      weekday: 5,
      hour: 4,
      minute: 21,
    },
  };
}

function createContainer(): Container {
  return createInvocationContainer(
    {
      env,
      executionCtx: createExecutionContext(),
      info: {
        kind: 'scheduled',
        correlationId: crypto.randomUUID(),
        clientIp: undefined,
      },
    },
    MODULES,
  );
}

class RecordingEmailSender implements EmailSender {
  readonly requests: EmailSendRequest<unknown>[] = [];
  failing = false;

  send<TInput>(request: EmailSendRequest<TInput>): Promise<string> {
    if (this.failing) {
      return Promise.reject(new Error('Queueへの送信に失敗しました'));
    }
    this.requests.push(request);
    return Promise.resolve(crypto.randomUUID());
  }
}

class RecordingIncidentReporter implements ModerationIncidentReporter {
  readonly reports: {
    readonly incident: ModerationIncident;
    readonly context: ModerationIncidentContext;
  }[] = [];

  report(
    incident: ModerationIncident,
    context: ModerationIncidentContext,
  ): void {
    this.reports.push({ incident, context });
  }
}

// 束縛と定期実行の登録は後続のタスクが行うため、処理単位のコンテナの上流の部品からジョブと通知を組み立てる
function createJob(emails: EmailSender, reporter: ModerationIncidentReporter) {
  const container = createContainer();
  const records = container.get<ModerationRecordStore>(
    MODERATION_PLATFORM_TYPES.ModerationRecordStore,
  );
  const notifier = new EmailModerationNotifier(
    records,
    container.get<UserContactDirectory>(
      IDENTITY_PLATFORM_TYPES.UserContactDirectory,
    ),
    container.get<ProductDirectory>(PRODUCT_PLATFORM_TYPES.ProductDirectory),
    container.get<CommentStore>(ENGAGEMENT_PLATFORM_TYPES.CommentStore),
    emails,
    { CLIENT_SITE_ORIGIN: CLIENT_ORIGIN },
    { now: () => SCHEDULED_TIME },
  );
  return new ModerationMaintenanceJob(records, notifier, reporter);
}

async function insertRecords(): Promise<void> {
  const statements = createContainer().get<ModerationRecordStatements>(
    MODERATION_PLATFORM_TYPES.ModerationRecordStatements,
  );
  const suspensionOf = (index: number, occurredAt: Date, userIndex = index) =>
    newRecordOf(index, {
      targetId: userIdOf(userIndex),
      subjectUserId: userIdOf(userIndex),
      occurredAt,
      noticeStatus: 'pending',
    });
  await db.batch([
    statements.insertStatement(suspensionOf(STALE, ONE_HOUR_BEFORE)),
    statements.insertStatement(
      suspensionOf(RECENT, new Date(ONE_HOUR_BEFORE.getTime() + 1)),
    ),
    statements.insertStatement(
      newRecordOf(REQUESTED, {
        targetId: userIdOf(REQUESTED),
        subjectUserId: userIdOf(REQUESTED),
        occurredAt: new Date(SCHEDULED_TIME.getTime() - 3 * HOUR_MS),
        noticeStatus: 'pending',
      }),
    ),
    statements.insertStatement(
      suspensionOf(
        NO_RECIPIENT,
        new Date(SCHEDULED_TIME.getTime() - 2 * HOUR_MS),
      ),
    ),
    statements.insertStatement(
      newRecordOf(EXPIRED, {
        action: 'user.unsuspend',
        occurredAt: new Date(THREE_YEARS_BEFORE.getTime() - 1),
      }),
    ),
    statements.insertStatement(
      newRecordOf(RETAINED, {
        action: 'user.unsuspend',
        occurredAt: THREE_YEARS_BEFORE,
      }),
    ),
  ]);
  await createContainer()
    .get<ModerationRecordStore>(MODERATION_PLATFORM_TYPES.ModerationRecordStore)
    .markNotice({
      id: moderationIdOf(REQUESTED),
      from: 'pending',
      to: 'requested',
      at: new Date(SCHEDULED_TIME.getTime() - 3 * HOUR_MS),
    });
}

async function noticeStates() {
  return (await readModerationRows()).map(
    ({ id, noticeStatus, noticeRequestedAt }) => ({
      id,
      noticeStatus,
      noticeRequestedAt,
    }),
  );
}

beforeEach(async () => {
  await clearModerationRecords();
  await db.delete(users);
  await insertUser(STALE);
  await insertUser(RECENT);
  await insertUser(REQUESTED);
  await insertRecords();
});

describe('保守のジョブの通知の送り直し', () => {
  test('1時間以上前の依頼待ちの停止の通知を1回だけ依頼して依頼済みへ進め、宛先の無い通知は送らなかったことにし、2回実行しても依頼を重ねない', async () => {
    const emails = new RecordingEmailSender();
    const reporter = new RecordingIncidentReporter();
    const job = createJob(emails, reporter);

    await job.run(contextOf(SCHEDULED_TIME, '2026-11-20'));
    await createJob(emails, reporter).run(
      contextOf(SCHEDULED_TIME, '2026-11-20'),
    );

    expect(emails.requests).toEqual([
      expect.objectContaining({
        kind: MODERATION_USER_SUSPENDED_EMAIL,
        to: emailOf(STALE),
      }),
    ]);
    expect(reporter.reports).toEqual([]);
    expect(await noticeStates()).toEqual([
      {
        id: moderationIdOf(STALE),
        noticeStatus: 'requested',
        noticeRequestedAt: SCHEDULED_TIME,
      },
      {
        id: moderationIdOf(RECENT),
        noticeStatus: 'pending',
        noticeRequestedAt: null,
      },
      {
        id: moderationIdOf(REQUESTED),
        noticeStatus: 'requested',
        noticeRequestedAt: new Date(SCHEDULED_TIME.getTime() - 3 * HOUR_MS),
      },
      {
        id: moderationIdOf(NO_RECIPIENT),
        noticeStatus: 'skipped',
        noticeRequestedAt: null,
      },
      {
        id: moderationIdOf(RETAINED),
        noticeStatus: 'none',
        noticeRequestedAt: null,
      },
    ]);
  });

  test('送信の依頼に失敗した通知は依頼待ちのまま残して失敗の件数を定型の通知へ送り、翌日の実行で1回だけ依頼する', async () => {
    const emails = new RecordingEmailSender();
    const reporter = new RecordingIncidentReporter();
    emails.failing = true;

    await createJob(emails, reporter).run(
      contextOf(SCHEDULED_TIME, '2026-11-20'),
    );

    expect(reporter.reports).toEqual([
      {
        incident: 'notice-redispatch-failed',
        context: { job: JOB_NAME, count: 1 },
      },
    ]);
    const [stale] = await noticeStates();
    expect(stale).toEqual({
      id: moderationIdOf(STALE),
      noticeStatus: 'pending',
      noticeRequestedAt: null,
    });

    emails.failing = false;
    await createJob(emails, reporter).run(contextOf(NEXT_DAY, '2026-11-21'));
    await createJob(emails, reporter).run(contextOf(NEXT_DAY, '2026-11-21'));

    expect(emails.requests.map(({ to }) => to)).toEqual([
      emailOf(STALE),
      emailOf(RECENT),
    ]);
    expect(reporter.reports).toHaveLength(1);
    expect(
      (await noticeStates()).filter(({ id }) =>
        [moderationIdOf(STALE), moderationIdOf(RECENT)].includes(id),
      ),
    ).toEqual([
      {
        id: moderationIdOf(STALE),
        noticeStatus: 'requested',
        noticeRequestedAt: SCHEDULED_TIME,
      },
      {
        id: moderationIdOf(RECENT),
        noticeStatus: 'requested',
        noticeRequestedAt: SCHEDULED_TIME,
      },
    ]);
  });
});

describe('保守のジョブの保持期間の削除', () => {
  test('3年を過ぎた措置の記録だけを削除し、ちょうど3年の記録を残し、2回実行しても結果が変わらない', async () => {
    const emails = new RecordingEmailSender();
    const reporter = new RecordingIncidentReporter();

    await createJob(emails, reporter).run(
      contextOf(SCHEDULED_TIME, '2026-11-20'),
    );
    const afterFirst = await readModerationRows();
    await createJob(emails, reporter).run(
      contextOf(SCHEDULED_TIME, '2026-11-20'),
    );

    const ids = afterFirst.map(({ id }) => id);
    expect(ids).not.toContain(moderationIdOf(EXPIRED));
    expect(ids).toContain(moderationIdOf(RETAINED));
    expect(await readModerationRows()).toEqual(afterFirst);
  });
});
