import { launchComments } from '../../../../../db/schema/engagement/launch-comments.ts';
import { moderationActions } from '../../../../../db/schema/moderation/moderation-actions.ts';
import { reportCases } from '../../../../../db/schema/reporting/report-cases.ts';
import { reports } from '../../../../../db/schema/reporting/reports.ts';
import { ultrasNotices } from '../../../../../db/schema/ultras/ultras-notices.ts';
import { utcYearsBefore } from '../../../../../lib/core/time/utc-calendar.ts';
import {
  adminAt,
  baseInstantOf,
  launchOf,
  productAt,
  userAt,
  type EntityContext,
} from '../../entities.ts';
import { deterministicUlid } from '../../random.ts';
import {
  insertStatements,
  type SqlRow,
  type SqlStatement,
} from '../../sql-writer.ts';
import { ADMIN_COUNT } from '../moderation.ts';
import { DAY_MS, HOUR_MS, scaledCount } from './scale.ts';

// 日次の削除の1回の上限(Ultrasの知らせ・通報は10,000件、措置の記録とコメントの匿名化は5,000件)を超えて、残りが出る件数
const ULTRAS_NOTICES = 10_500;

const MODERATION_ACTIONS = 5_500;

const DELETED_COMMENTS = 5_500;

const CLOSED_CASES = 10_500;

const NOTICE_RETENTION_DAYS = 30;

const ACTION_RETENTION_YEARS = 3;

// 論理削除から13日目の業務日付(実行日の13日前)。14日前以前になると期限の通知の対象になるため、この1日に収める
const COMMENT_DELETED_DAYS_BEFORE = 13;

const BUSINESS_DAY_MS = 23 * HOUR_MS;

const CASE_CLOSED_DAYS_BEFORE = 20;

const baseOf = (entities: EntityContext): number =>
  baseInstantOf(entities.baseDate).getTime();

const numberOf = (index: number): string => String(index + 1).padStart(6, '0');

function* noticeRows(entities: EntityContext): Generator<SqlRow> {
  const count = scaledCount(entities.profile, ULTRAS_NOTICES);
  for (let index = 0; index < count; index += 1) {
    const finishedAt = new Date(
      baseOf(entities) - (NOTICE_RETENTION_DAYS + 5 + (index % 60)) * DAY_MS,
    );
    const user = userAt(entities, index % entities.profile.users);
    yield {
      id: deterministicUlid(
        finishedAt,
        `${String(entities.seed)}:ultras-notice:${String(index)}`,
      ),
      userId: user.id,
      stripeSubscriptionId: `sub_synthetic_${numberOf(index)}`,
      kind: index % 2 === 0 ? 'payment_failed' : 'cancellation_accepted',
      dedupeKey: `synthetic-readiness-ultras-notice-${numberOf(index)}`,
      payloadJson: '{}',
      status: index % 3 === 0 ? 'skipped' : 'requested',
      finishedAt,
      createdAt: new Date(finishedAt.getTime() - HOUR_MS),
      updatedAt: finishedAt,
    };
  }
}

function* actionRows(entities: EntityContext): Generator<SqlRow> {
  const count = scaledCount(entities.profile, MODERATION_ACTIONS);
  const limit = utcYearsBefore(
    baseInstantOf(entities.baseDate),
    ACTION_RETENTION_YEARS,
  ).getTime();
  for (let index = 0; index < count; index += 1) {
    const occurredAt = new Date(limit - (30 + (index % 90)) * DAY_MS);
    const user = userAt(entities, index % entities.profile.users);
    yield {
      id: deterministicUlid(
        occurredAt,
        `${String(entities.seed)}:moderation-action:${String(index)}`,
      ),
      action: 'comment.hide',
      targetKind: 'comment',
      targetId: deterministicUlid(
        occurredAt,
        `${String(entities.seed)}:moderation-target:${String(index)}`,
      ),
      subjectUserId: user.id,
      operatorAdminId: adminAt(entities, index % ADMIN_COUNT).id,
      reason: `合成の措置${numberOf(index)}: 保持期間を過ぎた措置の記録です。`,
      occurredAt,
      noticeStatus: 'skipped',
      createdAt: occurredAt,
      updatedAt: occurredAt,
    };
  }
}

function* deletedCommentRows(entities: EntityContext): Generator<SqlRow> {
  const count = scaledCount(entities.profile, DELETED_COMMENTS);
  const dayStart = baseOf(entities) - COMMENT_DELETED_DAYS_BEFORE * DAY_MS;
  const { products, users } = entities.profile;
  for (let index = 0; index < count; index += 1) {
    const product = productAt(entities, index % products);
    const launch = launchOf(entities, index % products);
    const deletedAt = new Date(
      dayStart + Math.floor((index * BUSINESS_DAY_MS) / count),
    );
    const createdAt = new Date(deletedAt.getTime() - 2 * DAY_MS);
    const id = deterministicUlid(
      createdAt,
      `${String(entities.seed)}:deleted-comment:${String(index)}`,
    );
    yield {
      id,
      productId: product.id,
      launchId: launch.id,
      parentId: null,
      rootId: id,
      depth: 1,
      authorUserId: userAt(entities, (index * 3 + 2) % users).id,
      body: `合成の削除済みコメント${numberOf(index)}: 匿名化の対象の本文です。`,
      createdAt,
      updatedAt: deletedAt,
      deletedAt,
    };
  }
}

// 完了から14日以上経った案件に、未ログインの通報を1件ずつ付ける。案件は完了済みのため、未完了の案件の対象の一意の制約には掛からない
function* closedCaseStatements(
  entities: EntityContext,
): Generator<SqlStatement> {
  const count = scaledCount(entities.profile, CLOSED_CASES);
  const planned = Array.from({ length: count }, (_, index) => {
    const closedAt = new Date(
      baseOf(entities) - (CASE_CLOSED_DAYS_BEFORE + (index % 30)) * DAY_MS,
    );
    const reportedAt = new Date(closedAt.getTime() - DAY_MS);
    const key = `${String(entities.seed)}:closed-case:${String(index)}`;
    return {
      index,
      closedAt,
      reportedAt,
      caseId: deterministicUlid(reportedAt, key),
      reportId: deterministicUlid(reportedAt, `${key}:report`),
      product: productAt(entities, index % entities.profile.products),
    };
  });
  yield* insertStatements(
    reportCases,
    planned.map((plan): SqlRow => ({
      id: plan.caseId,
      targetKind: 'product',
      targetId: plan.product.id,
      targetOwnerUserId: plan.product.ownerId,
      productId: plan.product.id,
      status: 'resolved',
      statusChangedAt: plan.closedAt,
      lastReportedAt: plan.reportedAt,
      closedAt: plan.closedAt,
      resolution: 'none',
      posterNoticeStatus: 'none',
      createdAt: plan.reportedAt,
      updatedAt: plan.closedAt,
    })),
  );
  yield* insertStatements(
    reports,
    planned.map((plan): SqlRow => ({
      id: plan.reportId,
      caseId: plan.caseId,
      reporterUserId: null,
      contactEmail: `synthetic-closed-guest-${numberOf(plan.index)}@readiness.example`,
      categoryId: '01JE0000000000000000000002',
      categoryName: 'その他',
      reason: `合成の通報${numberOf(plan.index)}: 完了から14日以上経った未ログインの通報です。`,
      reportedAt: plan.reportedAt,
      createdAt: plan.reportedAt,
      updatedAt: plan.reportedAt,
    })),
  );
}

export function* moreRetentionStatements(
  entities: EntityContext,
): Generator<SqlStatement> {
  yield* insertStatements(ultrasNotices, noticeRows(entities));
  yield* insertStatements(moderationActions, actionRows(entities));
  yield* insertStatements(launchComments, deletedCommentRows(entities));
  yield* closedCaseStatements(entities);
}
