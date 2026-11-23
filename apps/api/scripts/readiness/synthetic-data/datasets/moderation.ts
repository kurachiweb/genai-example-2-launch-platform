import { AUDIT_ACTIONS } from '../../../../common-lib/admin/audit-actions/index.ts';
import type { AuditActionDefinition } from '../../../../common-lib/admin/audit-action.ts';
import { adminAuditLogTargets } from '../../../../db/schema/admin/admin-audit-log-targets.ts';
import { adminAuditLogs } from '../../../../db/schema/admin/admin-audit-logs.ts';
import { admins } from '../../../../db/schema/admin/admins.ts';
import { reportCases } from '../../../../db/schema/reporting/report-cases.ts';
import { reports } from '../../../../db/schema/reporting/reports.ts';
import {
  adminAt,
  baseInstantOf,
  productAt,
  userAt,
  type EntityContext,
} from '../entities.ts';
import { commentPlansOf, type PlannedComment } from './comments.ts';
import { deterministicUlid } from '../random.ts';
import { assertScaleProfile, type ScaleProfile } from '../scale-profile.ts';
import {
  insertStatements,
  type DatasetContext,
  type SqlRow,
  type SqlStatement,
  type SyntheticDataset,
} from '../sql-writer.ts';

export const ADMIN_COUNT = 5;

// 監査ログの保持期間(admin-foundationの3年)
export const AUDIT_RETENTION_YEARS = 3;

const MINUTE_MS = 60_000;

const HOUR_MS = 3_600_000;

const DAY_MS = 86_400_000;

// ログインできない管理者にするため、どのパスワードの検証にも一致しない値にする
const UNUSABLE_PASSWORD_HASH = 'synthetic-unusable';

// 案件の受付は基準日の10日前から2日前までに収め、完了した案件も14日以内に収める(4:21の通報の保持期間のジョブの対象にしない)
const CASE_SPAN_START_DAYS = 10;

const CASE_SPAN_MS = 8 * DAY_MS;

const REPORT_GAP_MS = 10 * MINUTE_MS;

const CLOSE_DELAY_MS = HOUR_MS;

const MAX_REPORTS_PER_CASE = 4;

const GUEST_REPORT_POSITION = 3;

const INFRINGEMENT_PERIOD = 25;

const RIGHTS_CATEGORY = Object.freeze({
  id: '01JE0000000000000000000001',
  name: '権利侵害',
});

const OTHER_CATEGORY = Object.freeze({
  id: '01JE0000000000000000000002',
  name: 'その他',
});

type CaseKind = 'product' | 'user' | 'comment';

// 10件の周期: 6件がプロダクト、3件が利用者、1件がコメント
const KIND_PATTERN: readonly CaseKind[] = Object.freeze([
  'product',
  'user',
  'product',
  'comment',
  'product',
  'product',
  'user',
  'product',
  'product',
  'user',
]);

type CaseStatus = 'open' | 'in_progress' | 'resolved' | 'rejected';

// 20件の周期: 未対応12・対応中3・対応済3・却下2
const STATUS_PATTERN: readonly CaseStatus[] = Object.freeze([
  'open',
  'open',
  'in_progress',
  'open',
  'resolved',
  'open',
  'open',
  'rejected',
  'open',
  'in_progress',
  'open',
  'open',
  'resolved',
  'open',
  'in_progress',
  'open',
  'rejected',
  'open',
  'resolved',
  'open',
]);

const AUDIT_SPAN_DAYS = 400;

const PRODUCT_STRIDE = 7;

const PRODUCT_OFFSET = 3;

const USER_STRIDE = 11;

const USER_OFFSET = 5;

const entityContextOf = (
  profile: ScaleProfile,
  context: DatasetContext,
): EntityContext => ({
  seed: context.seed,
  baseDate: context.baseDate,
  profile,
  ...(context.logoFileId === undefined
    ? {}
    : { logoFileId: context.logoFileId }),
});

interface CaseTarget {
  readonly kind: CaseKind;
  readonly targetId: string;
  readonly ownerUserId: string;
  readonly productId: string | null;
  readonly userIndex: number | null;
}

interface PlannedCase {
  readonly id: string;
  readonly index: number;
  readonly target: CaseTarget;
  readonly status: CaseStatus;
  readonly firstReportedAt: Date;
  readonly reportCount: number;
}

function* adminRows(context: DatasetContext): Generator<SqlRow> {
  for (let index = 0; index < ADMIN_COUNT; index += 1) {
    const admin = adminAt(context, index);
    yield {
      id: admin.id,
      email: admin.email,
      passwordHash: UNUSABLE_PASSWORD_HASH,
      nickname: admin.nickname,
      role: 'moderator',
      status: 'active',
      activatedAt: admin.createdAt,
      createdAt: admin.createdAt,
      updatedAt: admin.createdAt,
    };
  }
}

// 対象が重ならないよう、種類ごとの通し番号から互いに素な刻みで対象を選ぶ
function* casePlansOf(entities: EntityContext): Generator<PlannedCase> {
  const { profile, seed, baseDate } = entities;
  const comments = commentPlansOf(entities);
  const start =
    baseInstantOf(baseDate).getTime() - CASE_SPAN_START_DAYS * DAY_MS;
  const counters = { product: 0, user: 0, comment: 0 };
  for (let index = 0; index < profile.reportCases; index += 1) {
    const kind = KIND_PATTERN[index % KIND_PATTERN.length] ?? 'product';
    const ordinal = counters[kind];
    counters[kind] += 1;
    const firstReportedAt = new Date(
      start + Math.floor((index * CASE_SPAN_MS) / profile.reportCases),
    );
    yield {
      id: deterministicUlid(
        firstReportedAt,
        `${String(seed)}:case:${String(index)}`,
      ),
      index,
      target: targetOf(entities, kind, ordinal, comments),
      status: STATUS_PATTERN[index % STATUS_PATTERN.length] ?? 'open',
      firstReportedAt,
      reportCount: (index % MAX_REPORTS_PER_CASE) + 1,
    };
  }
}

function targetOf(
  entities: EntityContext,
  kind: CaseKind,
  ordinal: number,
  comments: Iterator<PlannedComment>,
): CaseTarget {
  if (kind === 'product') {
    const product = productAt(
      entities,
      (ordinal * PRODUCT_STRIDE + PRODUCT_OFFSET) % entities.profile.products,
    );
    return {
      kind,
      targetId: product.id,
      ownerUserId: product.ownerId,
      productId: product.id,
      userIndex: null,
    };
  }
  if (kind === 'user') {
    const userIndex =
      (ordinal * USER_STRIDE + USER_OFFSET) % entities.profile.users;
    const user = userAt(entities, userIndex);
    return {
      kind,
      targetId: user.id,
      ownerUserId: user.id,
      productId: null,
      userIndex,
    };
  }
  const next = comments.next();
  if (next.done === true) {
    throw new RangeError('通報の対象にするコメントが足りません');
  }
  return {
    kind,
    targetId: next.value.id,
    ownerUserId: next.value.authorUserId,
    productId: next.value.productId,
    userIndex: null,
  };
}

const lastReportedAtOf = (plan: PlannedCase): Date =>
  new Date(
    plan.firstReportedAt.getTime() + (plan.reportCount - 1) * REPORT_GAP_MS,
  );

const isClosed = (status: CaseStatus): boolean =>
  status === 'resolved' || status === 'rejected';

function caseRow(plan: PlannedCase): SqlRow {
  const lastReportedAt = lastReportedAtOf(plan);
  const closedAt = isClosed(plan.status)
    ? new Date(lastReportedAt.getTime() + CLOSE_DELAY_MS)
    : null;
  const infringement = plan.index % INFRINGEMENT_PERIOD === 0;
  return {
    id: plan.id,
    targetKind: plan.target.kind,
    targetId: plan.target.targetId,
    targetOwnerUserId: plan.target.ownerUserId,
    productId: plan.target.productId,
    status: plan.status,
    statusChangedAt: closedAt ?? lastReportedAt,
    lastReportedAt,
    infringementReportedAt: infringement ? plan.firstReportedAt : null,
    closedAt,
    resolution: plan.status === 'resolved' ? 'none' : null,
    posterNoticeStatus: 'none',
    createdAt: plan.firstReportedAt,
    updatedAt: closedAt ?? lastReportedAt,
  };
}

function reporterIndexOf(
  entities: EntityContext,
  plan: PlannedCase,
  position: number,
): number {
  const { users } = entities.profile;
  const index = (plan.index * 13 + position * 17 + 1) % users;
  return index === plan.target.userIndex ? (index + 1) % users : index;
}

function* reportRows(
  entities: EntityContext,
  plans: readonly PlannedCase[],
): Generator<SqlRow> {
  for (const plan of plans) {
    for (let position = 0; position < plan.reportCount; position += 1) {
      const reportedAt = new Date(
        plan.firstReportedAt.getTime() + position * REPORT_GAP_MS,
      );
      const category =
        position === 0 && plan.index % INFRINGEMENT_PERIOD === 0
          ? RIGHTS_CATEGORY
          : OTHER_CATEGORY;
      const guest = position === GUEST_REPORT_POSITION;
      yield {
        id: deterministicUlid(
          reportedAt,
          `${String(entities.seed)}:report:${String(plan.index)}:${String(position)}`,
        ),
        caseId: plan.id,
        reporterUserId: guest
          ? null
          : userAt(entities, reporterIndexOf(entities, plan, position)).id,
        contactEmail: guest
          ? `synthetic-guest-${String(plan.index + 1).padStart(6, '0')}@readiness.example`
          : null,
        categoryId: category.id,
        categoryName: category.name,
        reason: `合成の通報${String(plan.index + 1)}の${String(position + 1)}件目: 性能の検証のために自動で作った通報の理由です。`,
        reportedAt,
        createdAt: reportedAt,
        updatedAt: reportedAt,
      };
    }
  }
}

export interface AuditEntry {
  readonly log: SqlRow;
  readonly target: SqlRow | null;
}

const ACTION_COUNT = AUDIT_ACTIONS.length;

const AUDIT_USER_STRIDE = 7;

const AUDIT_PRODUCT_STRIDE = 5;

function auditTargetId(
  entities: EntityContext,
  definition: AuditActionDefinition,
  index: number,
  occurredAt: Date,
  keyPrefix: string,
): string {
  switch (definition.targetKind) {
    case 'user': {
      return userAt(
        entities,
        (index * AUDIT_USER_STRIDE + 1) % entities.profile.users,
      ).pseudonymousId;
    }
    case 'product': {
      return productAt(
        entities,
        (index * AUDIT_PRODUCT_STRIDE) % entities.profile.products,
      ).id;
    }
    case 'admin': {
      return adminAt(entities, index % ADMIN_COUNT).id;
    }
    default: {
      return deterministicUlid(
        occurredAt,
        `${keyPrefix}:audit-target-id:${String(index)}`,
      );
    }
  }
}

// 監査ログ1件と、その対象の行(対象の種類が無い操作は無し)を、登録済みの操作種別の規則(理由・詳細の鍵・対象の種類)どおりに作る
export function auditEntryAt(
  entities: EntityContext,
  index: number,
  occurredAt: Date,
  keyPrefix: string,
): AuditEntry {
  const definition = AUDIT_ACTIONS[index % ACTION_COUNT];
  if (definition === undefined) {
    throw new RangeError('監査ログの操作種別が登録されていません');
  }
  const id = deterministicUlid(
    occurredAt,
    `${keyPrefix}:audit:${String(index)}`,
  );
  const detail = Object.fromEntries(
    definition.detailKeys.map((key) => [key, `合成値${String(index % 10)}`]),
  );
  const log: SqlRow = {
    id,
    operatorAdminId: adminAt(entities, index % ADMIN_COUNT).id,
    action: definition.name,
    targetKind: definition.targetKind,
    reason:
      definition.reason === 'none'
        ? null
        : `合成の理由${String(index + 1)}: 性能の検証のために自動で作った操作です。`,
    detail: JSON.stringify(detail),
    occurredAt,
    createdAt: occurredAt,
    updatedAt: occurredAt,
  };
  const target: SqlRow | null =
    definition.targetKind === null
      ? null
      : {
          id: deterministicUlid(
            occurredAt,
            `${keyPrefix}:audit-target:${String(index)}`,
          ),
          logId: id,
          targetKind: definition.targetKind,
          targetId: auditTargetId(
            entities,
            definition,
            index,
            occurredAt,
            keyPrefix,
          ),
          createdAt: occurredAt,
          updatedAt: occurredAt,
        };
  return { log, target };
}

export function* auditStatements(
  entries: () => Iterable<AuditEntry>,
): Generator<SqlStatement> {
  yield* insertStatements(
    adminAuditLogs,
    (function* () {
      for (const entry of entries()) {
        yield entry.log;
      }
    })(),
  );
  yield* insertStatements(
    adminAuditLogTargets,
    (function* () {
      for (const entry of entries()) {
        if (entry.target !== null) {
          yield entry.target;
        }
      }
    })(),
  );
}

function* currentAuditEntries(entities: EntityContext): Generator<AuditEntry> {
  const { auditLogs } = entities.profile;
  const end = baseInstantOf(entities.baseDate).getTime() - HOUR_MS;
  const span = AUDIT_SPAN_DAYS * DAY_MS;
  for (let index = 0; index < auditLogs; index += 1) {
    const occurredAt = new Date(
      end - Math.floor(((auditLogs - 1 - index) * span) / auditLogs),
    );
    yield auditEntryAt(entities, index, occurredAt, String(entities.seed));
  }
}

function* generate(
  profile: ScaleProfile,
  context: DatasetContext,
): Generator<SqlStatement> {
  assertScaleProfile(profile);
  const entities = entityContextOf(profile, context);
  const plans = [...casePlansOf(entities)];
  yield* insertStatements(admins, adminRows(context));
  yield* insertStatements(reportCases, plans.map(caseRow));
  yield* insertStatements(reports, reportRows(entities, plans));
  yield* auditStatements(() => currentAuditEntries(entities));
}

export const moderationDataset: SyntheticDataset = {
  name: 'moderation',
  dependsOn: ['users', 'products', 'comments'],
  generate,
};
