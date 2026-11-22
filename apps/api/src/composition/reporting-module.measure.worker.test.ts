import { createExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { type Container, ContainerModule } from 'inversify';
import { beforeEach, describe, expect, test } from 'vitest';

import type { ReportMeasure } from '../../common-lib/reporting/report-case-rules.ts';
import type { ReportTargetKind } from '../../common-lib/reporting/report-rules.ts';
import { launchComments } from '../../db/schema/engagement/launch-comments.ts';
import { users } from '../../db/schema/identity/users.ts';
import { products } from '../../db/schema/product/products.ts';
import { reportCases } from '../../db/schema/reporting/report-cases.ts';
import { reports } from '../../db/schema/reporting/reports.ts';
import type { AuditLogRecorder } from '../../lib/core/admin/audit-log.ts';
import { ADMIN_PLATFORM_TYPES } from '../../lib/core/admin/identifiers.ts';
import { PLATFORM_TYPES } from '../../lib/core/di/identifiers.ts';
import { AppError } from '../../lib/core/errors/app-error.ts';
import { createInvocationContainer } from '../../lib/workers/di/invocation-container.ts';
import {
  clearEngagementTables,
  commentIdOf,
  insertComment,
  insertLaunch,
  insertProduct,
  insertUser,
  productIdOf,
  userIdOf,
} from '../../lib/workers/engagement/testing/engagement-fixtures.ts';
import type { MessagePublisher } from '../../lib/workers/messaging/queue-publisher.ts';
import { readModerationRows } from '../../lib/workers/moderation/testing/moderation-record-fixtures.ts';
import type { CommentModerationService } from '../application/moderation/comment-moderation-service.ts';
import { MODERATION_TYPES } from '../application/moderation/moderation-types.ts';
import type {
  ModerationCommand,
  ModerationOutcome,
} from '../application/moderation/ports.ts';
import type { ProductModerationService } from '../application/moderation/product-moderation-service.ts';
import type { UserModerationService } from '../application/moderation/user-moderation-service.ts';
import type {
  ReportCaseStore,
  ReportCaseWriter,
  ReportNotifier,
} from '../application/reporting/ports.ts';
import { DefaultReportCaseWorkflow } from '../application/reporting/report-case-workflow.ts';
import { REPORTING_TYPES } from '../application/reporting/reporting-types.ts';
import { PSEUDONYMOUS_ID } from '../infrastructure/moderation/testing/moderation-write-fixtures.ts';
import {
  AT,
  type CaseRow,
  caseIdOf,
  clearReportCaseWrites,
  db,
  guestReportOf,
  insertReporter,
  memberReportOf,
  openCaseOf,
  readAudits,
  readCase,
  readCaseIds,
  readNoticeStatuses,
  REASON,
  rejectedColumns,
  reportIdOf,
  seed,
} from '../infrastructure/reporting/testing/report-case-write-fixtures.ts';
import { MODULES } from './modules.ts';

const OWNER = 1;
const AUTHOR = 2;
const PRODUCT = 1;
const LAUNCH = 1;
const COMMENT = 1;
const CASE = 1;
const ADMIN_ID = '01JQ0ADM000000000000000001';

interface TargetCase {
  readonly kind: ReportTargetKind;
  readonly measure: ReportMeasure;
  readonly targetId: string;
  readonly ownerUserId: string;
  readonly productId: string | null;
  readonly readState: () => Promise<unknown>;
  readonly changedState: unknown;
  readonly unchangedState: unknown;
  readonly applyBeforehand: () => Promise<void>;
}

async function readProductHiddenAt() {
  const [row] = await db
    .select({ hiddenAt: products.hiddenAt })
    .from(products)
    .where(eq(products.id, productIdOf(PRODUCT)));
  return row?.hiddenAt;
}

async function readCommentHiddenAt() {
  const [row] = await db
    .select({ hiddenAt: launchComments.hiddenAt })
    .from(launchComments)
    .where(eq(launchComments.id, commentIdOf(COMMENT)));
  return row?.hiddenAt;
}

async function readOwnerStatus() {
  const [row] = await db
    .select({ status: users.status })
    .from(users)
    .where(eq(users.id, userIdOf(OWNER)));
  return row?.status;
}

const BEFOREHAND = new Date(AT.getTime() - 3_600_000);

const TARGETS: readonly TargetCase[] = [
  {
    kind: 'product',
    measure: 'product.hide',
    targetId: productIdOf(PRODUCT),
    ownerUserId: userIdOf(OWNER),
    productId: productIdOf(PRODUCT),
    readState: readProductHiddenAt,
    changedState: AT,
    unchangedState: null,
    applyBeforehand: async () => {
      await db
        .update(products)
        .set({ hiddenAt: BEFOREHAND })
        .where(eq(products.id, productIdOf(PRODUCT)));
    },
  },
  {
    kind: 'comment',
    measure: 'comment.hide',
    targetId: commentIdOf(COMMENT),
    ownerUserId: userIdOf(AUTHOR),
    productId: productIdOf(PRODUCT),
    readState: readCommentHiddenAt,
    changedState: AT,
    unchangedState: null,
    applyBeforehand: async () => {
      await db
        .update(launchComments)
        .set({ hiddenAt: BEFOREHAND })
        .where(eq(launchComments.id, commentIdOf(COMMENT)));
    },
  },
  {
    kind: 'user',
    measure: 'user.suspend',
    targetId: userIdOf(OWNER),
    ownerUserId: userIdOf(OWNER),
    productId: null,
    readState: readOwnerStatus,
    changedState: 'suspended',
    unchangedState: 'active',
    applyBeforehand: async () => {
      await db
        .update(users)
        .set({ status: 'suspended' })
        .where(eq(users.id, userIdOf(OWNER)));
    },
  },
];

interface Harness {
  readonly workflow: DefaultReportCaseWorkflow;
  readonly outcomes: ModerationOutcome[];
  readonly dispatched: string[];
}

// 案件を読んだ直後に別の操作を差し込み、同時の完了と物理削除を再現する
type AfterFirstFind = () => Promise<void>;

function createContainer(): Container {
  const recordingPublisher = new ContainerModule(({ rebind }) => {
    rebind<MessagePublisher>(PLATFORM_TYPES.MessagePublisher).toConstantValue({
      publish: () => Promise.resolve(crypto.randomUUID()),
    });
  });
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
    [...MODULES, { bindings: recordingPublisher }],
  );
}

const recordingOutcome =
  (
    outcomes: ModerationOutcome[],
    run: (command: ModerationCommand) => Promise<ModerationOutcome>,
  ) =>
  async (command: ModerationCommand): Promise<ModerationOutcome> => {
    const outcome = await run(command);
    outcomes.push(outcome);
    return outcome;
  };

function interceptedStore(
  store: ReportCaseStore,
  afterFirstFind: AfterFirstFind | undefined,
): ReportCaseStore {
  let finds = 0;
  return {
    search: (filter, page) => store.search(filter, page),
    find: async (caseId) => {
      const record = await store.find(caseId);
      finds += 1;
      if (finds === 1 && afterFirstFind !== undefined) {
        await afterFirstFind();
      }
      return record;
    },
    listReports: (caseId) => store.listReports(caseId),
    countUnhandled: () => store.countUnhandled(),
    productSummary: (productId) => store.productSummary(productId),
  };
}

// 束縛は5.2で行うため、ユースケースは束縛済みの部品からテストの中で組み立てる。通知は依頼の記録だけにして、申出者への通知の状態を確定の直後のまま読む
function createHarness(afterFirstFind?: AfterFirstFind): Harness {
  const container = createContainer();
  const outcomes: ModerationOutcome[] = [];
  const dispatched: string[] = [];
  const notifier: ReportNotifier = {
    dispatch: (caseId) => {
      dispatched.push(caseId);
      return Promise.resolve({ requested: 0, skipped: 0 });
    },
  };
  const products = container.get<ProductModerationService>(
    MODERATION_TYPES.ProductModerationService,
  );
  const comments = container.get<CommentModerationService>(
    MODERATION_TYPES.CommentModerationService,
  );
  const usersService = container.get<UserModerationService>(
    MODERATION_TYPES.UserModerationService,
  );
  const workflow = new DefaultReportCaseWorkflow(
    interceptedStore(
      container.get<ReportCaseStore>(REPORTING_TYPES.ReportCaseStore),
      afterFirstFind,
    ),
    container.get<ReportCaseWriter>(REPORTING_TYPES.ReportCaseWriter),
    container.get<AuditLogRecorder>(ADMIN_PLATFORM_TYPES.AuditLogRecorder),
    notifier,
    {
      hide: recordingOutcome(outcomes, (command) => products.hide(command)),
      unhide: (command) => products.unhide(command),
    },
    {
      hide: recordingOutcome(outcomes, (command) => comments.hide(command)),
      unhide: (command) => comments.unhide(command),
    },
    {
      suspend: recordingOutcome(outcomes, (command) =>
        usersService.suspend(command),
      ),
      unsuspend: (command) => usersService.unsuspend(command),
    },
  );
  return { workflow, outcomes, dispatched };
}

const commandOf = () => ({
  caseId: caseIdOf(CASE),
  operator: { adminId: ADMIN_ID },
  at: AT,
  reason: REASON,
});

function caseColumnsOf(target: TargetCase): Partial<CaseRow> {
  return {
    targetKind: target.kind,
    targetId: target.targetId,
    targetOwnerUserId: target.ownerUserId,
    productId: target.productId,
  };
}

async function seedCase(
  target: TargetCase,
  columns: Partial<CaseRow> = {},
): Promise<void> {
  await seed(
    [openCaseOf(CASE, { ...caseColumnsOf(target), ...columns })],
    [
      memberReportOf(1, CASE, 1),
      guestReportOf(2, CASE, { contactEmail: null }),
    ],
  );
}

async function errorOf(action: Promise<unknown>): Promise<unknown> {
  try {
    await action;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('例外が発生しませんでした。');
}

async function expectNothingWritten(target: TargetCase): Promise<void> {
  expect(await target.readState()).toEqual(target.unchangedState);
  expect(await readModerationRows()).toEqual([]);
  expect(await readAudits()).toEqual([]);
}

beforeEach(async () => {
  await clearReportCaseWrites();
  await clearEngagementTables();
  await insertUser(OWNER, { pseudonymousId: PSEUDONYMOUS_ID });
  await insertUser(AUTHOR, {
    pseudonymousId: '7d3c1f0a-2b4e-4c6d-8e9f-0a1b2c3d4e5f',
  });
  await insertProduct(PRODUCT, OWNER);
  await insertLaunch(LAUNCH, PRODUCT);
  await insertComment({
    index: COMMENT,
    product: PRODUCT,
    launch: LAUNCH,
    author: AUTHOR,
  });
  await insertReporter(1);
});

describe.each(TARGETS)('措置による対応済($kind)', (target) => {
  test(`本物の${target.measure}と登録した参加者を通して、上流の状態・措置の記録・2つの監査ログ・案件の完了・申出者への通知の状態を一体で確定する`, async () => {
    await seedCase(target);
    const harness = createHarness();

    const result = await harness.workflow.resolveWithMeasure(commandOf());

    expect(result).toEqual({ status: 'resolved' });
    expect(await target.readState()).toEqual(target.changedState);
    const records = await readModerationRows();
    expect(records.map(({ action }) => action)).toEqual([target.measure]);
    const [outcome] = harness.outcomes;
    expect(outcome).toEqual({ changed: true, actionId: records[0]?.id });
    expect(await readCase(CASE)).toMatchObject({
      status: 'resolved',
      closedAt: AT,
      resolution: target.measure,
      resolutionActionId: outcome?.actionId,
      closingReason: REASON,
      posterNoticeStatus: 'none',
    });
    const audits = await readAudits();
    expect(audits.map(({ action }) => action).toSorted()).toEqual(
      ['report.resolve', target.measure].toSorted(),
    );
    expect(
      audits.find(({ action }) => action === 'report.resolve'),
    ).toMatchObject({
      reason: REASON,
      detail: {
        resolution: target.measure,
        mode: 'operation',
        fromStatus: 'open',
      },
      occurredAt: AT,
      targets: [{ targetKind: 'report', targetId: caseIdOf(CASE) }],
    });
    expect(await readNoticeStatuses()).toEqual({
      [reportIdOf(1)]: 'pending',
      [reportIdOf(2)]: 'none',
    });
    expect(harness.dispatched).toEqual([caseIdOf(CASE)]);
  });

  test('既に措置済みなら措置済みを返し、案件も措置の記録も監査ログも残さない', async () => {
    await target.applyBeforehand();
    await seedCase(target);
    const before = await target.readState();
    const harness = createHarness();

    const error = await errorOf(
      harness.workflow.resolveWithMeasure(commandOf()),
    );

    expect(error).toMatchObject({ code: 'report_measure_already_applied' });
    expect(await target.readState()).toEqual(before);
    expect(await readCase(CASE)).toMatchObject({
      status: 'open',
      resolutionActionId: null,
    });
    expect(await readModerationRows()).toEqual([]);
    expect(await readAudits()).toEqual([]);
    expect(harness.dispatched).toEqual([]);
  });

  test('完了済みの案件では上流を呼ばずに拒否し、上流の状態を含めて何も残さない', async () => {
    await seedCase(target, rejectedColumns());
    const before = await readCase(CASE);
    const harness = createHarness();

    const error = await errorOf(
      harness.workflow.resolveWithMeasure(commandOf()),
    );

    expect(error).toMatchObject({ code: 'report_case_closed' });
    expect(harness.outcomes).toEqual([]);
    expect(await readCase(CASE)).toEqual(before);
    await expectNothingWritten(target);
  });

  test('読んだ後に同時の完了が確定すると、参加者の文の違反で上流の確定ごと取り消して競合を返す', async () => {
    await seedCase(target);
    const harness = createHarness(async () => {
      await db
        .update(reportCases)
        .set(rejectedColumns())
        .where(eq(reportCases.id, caseIdOf(CASE)));
    });

    const error = await errorOf(
      harness.workflow.resolveWithMeasure(commandOf()),
    );

    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'report_case_state_conflict' });
    expect(harness.outcomes).toEqual([]);
    expect(await readCase(CASE)).toMatchObject({
      status: 'rejected',
      resolution: null,
      resolutionActionId: null,
    });
    expect(await readNoticeStatuses()).toEqual({
      [reportIdOf(1)]: 'none',
      [reportIdOf(2)]: 'none',
    });
    await expectNothingWritten(target);
    expect(harness.dispatched).toEqual([]);
  });

  test('読んだ後に案件が物理削除されると、存在の検査の文の違反で上流の確定ごと取り消して案件の不在を返す', async () => {
    await seedCase(target);
    const harness = createHarness(async () => {
      await db.delete(reports).where(eq(reports.caseId, caseIdOf(CASE)));
      await db.delete(reportCases).where(eq(reportCases.id, caseIdOf(CASE)));
    });

    const error = await errorOf(
      harness.workflow.resolveWithMeasure(commandOf()),
    );

    expect(error).toMatchObject({ code: 'report_case_not_found' });
    expect(harness.outcomes).toEqual([]);
    expect(await readCaseIds()).toEqual([]);
    await expectNothingWritten(target);
    expect(harness.dispatched).toEqual([]);
  });
});
