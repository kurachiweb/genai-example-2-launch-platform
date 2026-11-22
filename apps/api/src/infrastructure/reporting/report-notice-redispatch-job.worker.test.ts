import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { users } from '../../../db/schema/identity/users.ts';

import {
  REPORT_OUTCOME_EMAIL,
  REPORT_REJECTION_TO_POSTER_EMAIL,
} from '../../../lib/core/email/kinds/content-reporting.ts';
import type {
  EmailSendRequest,
  EmailSender,
} from '../../../lib/core/email/ports.ts';
import type { ScheduledJobContext } from '../../../lib/core/scheduling/cron-registry.ts';
import { toBusinessDateTime } from '../../../lib/core/time/business-time.ts';
import { D1UserContactDirectory } from '../../../lib/workers/identity/d1-user-contact-directory.ts';
import { ReportNoticeRedispatchJob } from '../../application/reporting/jobs/report-notice-redispatch-job.ts';
import type {
  ReportIncident,
  ReportIncidentContext,
  ReportIncidentReporter,
  ReportNoticeStore,
  ReportTargetResolver,
} from '../../application/reporting/ports.ts';
import { EmailReportNotifier } from '../../application/reporting/report-notifier.ts';
import { D1ReportCaseStatements } from './d1-report-case-statements.ts';
import { D1ReportCaseStore } from './d1-report-case-store.ts';
import { D1ReportCaseWriter } from './d1-report-case-writer.ts';
import { D1ReportNoticeStore } from './d1-report-notice-store.ts';
import {
  caseIdOf,
  clearReportCaseWrites,
  db,
  guestReportOf,
  insertReporter,
  measureResolvedColumns,
  memberReportOf,
  openCaseOf,
  readCase,
  readNoticeStatuses,
  rejectedColumns,
  reportIdOf,
  seed,
  statusChangeOf,
} from './testing/report-case-write-fixtures.ts';

const HOUR_MS = 60 * 60 * 1000;

// 業務日付2026-11-22の業務時刻4:21
const SCHEDULED_TIME = new Date('2026-11-22T12:21:00.000Z');
const NEXT_DAY = new Date(SCHEDULED_TIME.getTime() + 24 * HOUR_MS);
const NOW = new Date(SCHEDULED_TIME.getTime() + 5000);
const CLOSED_AT = new Date(SCHEDULED_TIME.getTime() - 2 * HOUR_MS);
const JOB_NAME = 'content-reporting.notice-redispatch';

const contextOf = (scheduledTime: Date): ScheduledJobContext => ({
  scheduledTime,
  cron: '21 12 * * *',
  business: toBusinessDateTime(scheduledTime),
});

const reporterUserIdOf = (index: number): string => {
  const { reporterUserId } = memberReportOf(0, 0, index);
  if (reporterUserId === null || reporterUserId === undefined) {
    throw new Error('申出者のIDを組み立てられません');
  }
  return reporterUserId;
};

const closedAtColumns = (closedAt: Date) => ({
  statusChangedAt: closedAt,
  closedAt,
});

// メール送信の基盤と同じく、同じ冪等のキーの依頼は2通目として配信しない
class RecordingEmailSender implements EmailSender {
  readonly requests: EmailSendRequest<unknown>[] = [];
  readonly delivered = new Map<string, EmailSendRequest<unknown>>();

  send<TInput>(request: EmailSendRequest<TInput>): Promise<string> {
    this.requests.push(request);
    const key = request.idempotencyKey ?? crypto.randomUUID();
    if (!this.delivered.has(key)) {
      this.delivered.set(key, request);
    }
    return Promise.resolve(crypto.randomUUID());
  }
}

class RecordingIncidentReporter implements ReportIncidentReporter {
  readonly reports: {
    readonly incident: ReportIncident;
    readonly context: ReportIncidentContext;
  }[] = [];

  report(incident: ReportIncident, context: ReportIncidentContext): void {
    this.reports.push({ incident, context });
  }
}

// 対象の表示名は通知の宛先と状態の進め方に関わらないため、表示できない対象として返す
const unavailableTargets: ReportTargetResolver = {
  resolveForSubmission: () => Promise.resolve(undefined),
  describe: () => Promise.resolve(new Map()),
};

function createJob(
  emails: EmailSender,
  reporter: ReportIncidentReporter,
  notices: ReportNoticeStore = new D1ReportNoticeStore(db),
): ReportNoticeRedispatchJob {
  const notifier = new EmailReportNotifier(
    new D1ReportCaseStore(db),
    notices,
    unavailableTargets,
    new D1UserContactDirectory(db),
    emails,
    { CLIENT_SITE_ORIGIN: 'https://client.example' },
    { now: () => NOW },
  );
  return new ReportNoticeRedispatchJob(notices, notifier, reporter);
}

// 1回目の依頼済みへの更新だけを失敗させ、依頼の後に記録だけが失敗した状態を作る
function failingFirstMarkOutcome(): ReportNoticeStore {
  const store = new D1ReportNoticeStore(db);
  let failed = false;
  return {
    listPendingOutcome: (caseId) => store.listPendingOutcome(caseId),
    markOutcome: (reportIds, to, at) => {
      if (!failed && to === 'requested') {
        failed = true;
        return Promise.reject(new Error('D1に接続できません'));
      }
      return store.markOutcome(reportIds, to, at);
    },
    markPoster: (caseId, to, at) => store.markPoster(caseId, to, at),
    posterNoticePending: (caseId) => store.posterNoticePending(caseId),
    listCasesWithPendingNotices: (input) =>
      store.listCasesWithPendingNotices(input),
  };
}

beforeEach(async () => {
  await clearReportCaseWrites();
});

describe('ReportNoticeRedispatchJob(D1と通知を組み立てて実行)', () => {
  test('完了から1時間以上経った依頼待ちの通知を宛先ごとに1通依頼して依頼済みへ1回だけ進め、2回実行しても依頼を重ねない', async () => {
    await insertReporter(1);
    await insertReporter(2);
    const recentClosedAt = new Date(SCHEDULED_TIME.getTime() - HOUR_MS / 2);
    await seed(
      [
        openCaseOf(1, {
          ...measureResolvedColumns(),
          ...closedAtColumns(CLOSED_AT),
          posterNoticeStatus: 'none',
        }),
        openCaseOf(2, {
          ...rejectedColumns(),
          ...closedAtColumns(CLOSED_AT),
          targetOwnerUserId: reporterUserIdOf(2),
          posterNoticeStatus: 'pending',
          posterNoticeRequestedAt: null,
        }),
        openCaseOf(3, {
          ...rejectedColumns(),
          ...closedAtColumns(recentClosedAt),
        }),
      ],
      [
        memberReportOf(1, 1, 1, { outcomeNoticeStatus: 'pending' }),
        memberReportOf(2, 1, 1, { outcomeNoticeStatus: 'pending' }),
        guestReportOf(3, 1, { outcomeNoticeStatus: 'pending' }),
        guestReportOf(4, 2, { outcomeNoticeStatus: 'pending' }),
        guestReportOf(5, 3, { outcomeNoticeStatus: 'pending' }),
      ],
    );
    const emails = new RecordingEmailSender();
    const reporter = new RecordingIncidentReporter();

    await createJob(emails, reporter).run(contextOf(SCHEDULED_TIME));
    await createJob(emails, reporter).run(contextOf(SCHEDULED_TIME));

    const closedAtMs = String(CLOSED_AT.getTime());
    expect(
      emails.requests.map(({ kind, to, idempotencyKey }) => ({
        kind,
        to,
        idempotencyKey,
      })),
    ).toEqual([
      {
        kind: REPORT_OUTCOME_EMAIL,
        to: 'reporter1@mail.example',
        idempotencyKey: `${reportIdOf(1)}:${closedAtMs}`,
      },
      {
        kind: REPORT_OUTCOME_EMAIL,
        to: 'guest3@mail.example',
        idempotencyKey: `${reportIdOf(3)}:${closedAtMs}`,
      },
      {
        kind: REPORT_OUTCOME_EMAIL,
        to: 'guest4@mail.example',
        idempotencyKey: `${reportIdOf(4)}:${closedAtMs}`,
      },
      {
        kind: REPORT_REJECTION_TO_POSTER_EMAIL,
        to: 'reporter2@mail.example',
        idempotencyKey: `${caseIdOf(2)}:${closedAtMs}`,
      },
    ]);
    expect(reporter.reports).toEqual([]);
    expect(await readNoticeStatuses()).toEqual({
      [reportIdOf(1)]: 'requested',
      [reportIdOf(2)]: 'requested',
      [reportIdOf(3)]: 'requested',
      [reportIdOf(4)]: 'requested',
      [reportIdOf(5)]: 'pending',
    });
    expect(await readCase(2)).toMatchObject({
      posterNoticeStatus: 'requested',
      posterNoticeRequestedAt: NOW,
    });
  });

  test('依頼の後の依頼済みへの更新だけが失敗した案件は、失敗の件数を知らせて依頼待ちのまま残し、翌日の送り直しで同じ冪等のキーで依頼して2通目を配信しない', async () => {
    await seed(
      [
        openCaseOf(1, {
          ...measureResolvedColumns(),
          ...closedAtColumns(CLOSED_AT),
          posterNoticeStatus: 'none',
        }),
      ],
      [guestReportOf(1, 1, { outcomeNoticeStatus: 'pending' })],
    );
    const emails = new RecordingEmailSender();
    const reporter = new RecordingIncidentReporter();
    const notices = failingFirstMarkOutcome();

    await createJob(emails, reporter, notices).run(contextOf(SCHEDULED_TIME));

    expect(reporter.reports).toEqual([
      {
        incident: 'notice-redispatch-failed',
        context: { job: JOB_NAME, count: 1 },
      },
    ]);
    expect(await readNoticeStatuses()).toEqual({
      [reportIdOf(1)]: 'pending',
    });

    await createJob(emails, reporter, notices).run(contextOf(NEXT_DAY));
    await createJob(emails, reporter, notices).run(contextOf(NEXT_DAY));

    const key = `${reportIdOf(1)}:${String(CLOSED_AT.getTime())}`;
    expect(emails.requests.map(({ idempotencyKey }) => idempotencyKey)).toEqual(
      [key, key],
    );
    expect([...emails.delivered.keys()]).toEqual([key]);
    expect(reporter.reports).toHaveLength(1);
    expect(await readNoticeStatuses()).toEqual({
      [reportIdOf(1)]: 'requested',
    });
  });

  test('完了から戻して取りやめた通知は、手で再び完了しても送り直さない', async () => {
    await seed(
      [
        openCaseOf(1, {
          ...measureResolvedColumns(),
          ...closedAtColumns(CLOSED_AT),
        }),
      ],
      [
        guestReportOf(1, 1, { outcomeNoticeStatus: 'pending' }),
        guestReportOf(2, 1, { outcomeNoticeStatus: 'pending' }),
      ],
    );
    const writer = new D1ReportCaseWriter(db, new D1ReportCaseStatements(db));
    const reopened = await writer.changeStatus(
      statusChangeOf(1, 'resolved', 'in_progress', 1),
    );
    const closedByHand = await writer.changeStatus(
      statusChangeOf(1, 'in_progress', 'rejected', 2),
    );
    const emails = new RecordingEmailSender();
    const reporter = new RecordingIncidentReporter();

    await createJob(emails, reporter).run(contextOf(SCHEDULED_TIME));

    expect([reopened, closedByHand]).toEqual(['committed', 'committed']);
    expect(emails.requests).toEqual([]);
    expect(reporter.reports).toEqual([]);
    expect(await readNoticeStatuses()).toEqual({
      [reportIdOf(1)]: 'none',
      [reportIdOf(2)]: 'none',
    });
    expect(await readCase(1)).toMatchObject({
      status: 'rejected',
      posterNoticeStatus: 'none',
    });
  });

  test('申出者が全員退会して全ての通報が論理削除された却下の案件は、申出者を退会済みとして送らない記録にし、利用中の投稿者へ1通だけ依頼し、2回実行しても依頼を重ねない', async () => {
    await insertReporter(1);
    await insertReporter(2);
    await seed(
      [
        openCaseOf(1, {
          ...rejectedColumns(),
          ...closedAtColumns(CLOSED_AT),
          targetOwnerUserId: reporterUserIdOf(2),
          posterNoticeStatus: 'pending',
          posterNoticeRequestedAt: null,
        }),
      ],
      [
        memberReportOf(1, 1, 1, {
          outcomeNoticeStatus: 'pending',
          deletedAt: CLOSED_AT,
        }),
      ],
    );
    await db
      .update(users)
      .set({ deletedAt: CLOSED_AT })
      .where(eq(users.id, reporterUserIdOf(1)));
    const emails = new RecordingEmailSender();
    const reporter = new RecordingIncidentReporter();

    await createJob(emails, reporter).run(contextOf(SCHEDULED_TIME));
    await createJob(emails, reporter).run(contextOf(SCHEDULED_TIME));
    const remaining = await new D1ReportNoticeStore(
      db,
    ).listCasesWithPendingNotices({
      closedBefore: NEXT_DAY,
      limit: 100,
    });

    expect(
      emails.requests.map(({ kind, to, idempotencyKey }) => ({
        kind,
        to,
        idempotencyKey,
      })),
    ).toEqual([
      {
        kind: REPORT_REJECTION_TO_POSTER_EMAIL,
        to: 'reporter2@mail.example',
        idempotencyKey: `${caseIdOf(1)}:${String(CLOSED_AT.getTime())}`,
      },
    ]);
    expect(reporter.reports).toEqual([]);
    expect(await readNoticeStatuses()).toEqual({
      [reportIdOf(1)]: 'skipped',
    });
    expect(await readCase(1)).toMatchObject({
      posterNoticeStatus: 'requested',
      posterNoticeRequestedAt: NOW,
    });
    expect(remaining).toEqual([]);
  });
});
