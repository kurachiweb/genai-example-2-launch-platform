import { sqlStringLiteral } from '../../apps/api/scripts/admin/sql-string-literal.ts';
import {
  checkReportReason,
  isInfringementCategory,
  REPORT_REASON_MAX,
  type ReportTargetKind,
  requiresContactEmail,
} from '../../apps/common-lib/reporting/report-rules.ts';
import type { LocalD1Row } from './local-d1-command.ts';

export type ReportFixtureTarget =
  | { readonly kind: 'product'; readonly productHandle: string }
  | { readonly kind: 'user'; readonly userHandle: string }
  | { readonly kind: 'comment'; readonly commentId: string };

// ログイン中の通報者は登録メールアドレスで指す。受け付けは未ログインの権利侵害の通報の連絡先だけを残すため、連絡先はその場合だけ指定する
export type ReportFixtureReporter =
  | { readonly kind: 'member'; readonly email: string }
  | { readonly kind: 'guest'; readonly contactEmail: string | null };

export interface ReportFixtureRequest {
  readonly target: ReportFixtureTarget;
  readonly categoryName: string;
  readonly reporter: ReportFixtureReporter;
}

export interface ResolvedReportFixture {
  readonly targetKind: ReportTargetKind;
  readonly targetId: string;
  readonly targetOwnerUserId: string;
  readonly productId: string | null;
  readonly categoryId: string;
  readonly categoryName: string;
  readonly reporterUserId: string | null;
  readonly contactEmail: string | null;
}

export interface ReportFixturePlanInput {
  readonly resolved: ResolvedReportFixture;
  readonly reason: string;
  readonly now: Date;
  readonly nextId: () => string;
}

export interface ReportFixturePlan extends ResolvedReportFixture {
  readonly reportId: string;
  // 対象に未完了の案件が無いときに使うID
  readonly newCaseId: string;
  readonly reason: string;
  readonly infringement: boolean;
  readonly at: Date;
}

export interface CreatedReport {
  readonly reportId: string;
  readonly caseId: string;
  // 既にあった未完了の案件へ集約したか
  readonly aggregated: boolean;
}

export interface ReportCaseReportState {
  readonly reportId: string;
  readonly reporterUserId: string | null;
  readonly contactEmail: string | null;
  readonly categoryId: string;
  readonly categoryName: string;
}

export interface ReportCaseState {
  readonly caseId: string;
  readonly status: string;
  readonly targetKind: string;
  readonly targetId: string | null;
  readonly targetOwnerUserId: string | null;
  readonly productId: string | null;
  readonly infringementReported: boolean;
  readonly reports: readonly ReportCaseReportState[];
}

const integerLiteral = (value: number): string => {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(
      `SQLの整数のリテラルにできない値です: ${String(value)}`,
    );
  }
  return String(value);
};

const nullableLiteral = (value: string | null): string =>
  value === null ? 'NULL' : sqlStringLiteral(value);

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

// 受け付けの対象の解決と同じく、プロダクトは自身、コメントはそのプロダクトを対象のプロダクトにし、利用者はプロダクトを持たない
const targetSql = (target: ReportFixtureTarget): string => {
  switch (target.kind) {
    case 'product':
      return `SELECT p.id AS target_id, p.user_id AS owner_user_id, p.id AS product_id FROM products p WHERE p.handle = ${sqlStringLiteral(target.productHandle)} AND p.deleted_at IS NULL`;
    case 'user':
      return `SELECT u.id AS target_id, u.id AS owner_user_id, NULL AS product_id FROM users u WHERE u.handle = ${sqlStringLiteral(target.userHandle)} AND u.deleted_at IS NULL`;
    case 'comment':
      return `SELECT c.id AS target_id, c.author_user_id AS owner_user_id, c.product_id AS product_id FROM launch_comments c WHERE c.id = ${sqlStringLiteral(target.commentId)} AND c.deleted_at IS NULL AND c.author_user_id IS NOT NULL`;
  }
};

// 受け付けは停止中の利用者を通報者として記録しないため、有効な利用者だけを通報者にする
const reporterSql = (reporter: ReportFixtureReporter): string =>
  reporter.kind === 'guest'
    ? 'NULL'
    : `(SELECT id FROM users WHERE email = ${sqlStringLiteral(reporter.email)} AND deleted_at IS NULL AND status = 'active')`;

export function reportFixtureLookupSql({
  target,
  categoryName,
  reporter,
}: ReportFixtureRequest): string {
  const category = `FROM report_categories WHERE name = ${sqlStringLiteral(categoryName)}`;
  return `SELECT t.target_id AS target_id, t.owner_user_id AS owner_user_id, t.product_id AS product_id, (SELECT id ${category}) AS category_id, (SELECT name ${category}) AS category_name, ${reporterSql(reporter)} AS reporter_user_id FROM (${targetSql(target)}) t;`;
}

export function parseReportFixtureLookup(
  rows: readonly LocalD1Row[],
  { target, categoryName, reporter }: ReportFixtureRequest,
): ResolvedReportFixture {
  const [row] = rows;
  if (row === undefined || rows.length !== 1) {
    throw new Error(
      `通報の対象(${JSON.stringify(target)})が見つかりません。削除されていない対象を指定してください`,
    );
  }
  const {
    target_id: targetId,
    owner_user_id: targetOwnerUserId,
    product_id: productId,
    category_id: categoryId,
    category_name: foundCategoryName,
    reporter_user_id: reporterUserId,
  } = row;
  if (
    typeof targetId !== 'string' ||
    typeof targetOwnerUserId !== 'string' ||
    !isNullableString(productId) ||
    !isNullableString(categoryId) ||
    !isNullableString(foundCategoryName) ||
    !isNullableString(reporterUserId)
  ) {
    throw new Error(
      `通報の対象の照会の結果の形式が正しくありません: ${JSON.stringify(rows)}`,
    );
  }
  if (categoryId === null || foundCategoryName === null) {
    throw new Error(`通報カテゴリ(${categoryName})が見つかりません`);
  }
  if (reporter.kind === 'member' && reporterUserId === null) {
    throw new Error(
      `通報者の利用者(${reporter.email})が見つかりません。退会・停止していない利用者を指定してください`,
    );
  }
  if (reporter.kind === 'member' && reporterUserId === targetOwnerUserId) {
    throw new Error(
      `通報者の利用者(${reporter.email})は対象(${JSON.stringify(target)})の投稿者自身です。本人のコンテンツは受け付けで拒否されるため、他の利用者を指定してください`,
    );
  }
  const contactEmail = reporter.kind === 'guest' ? reporter.contactEmail : null;
  const contactRequired = requiresContactEmail({
    reporterKind: reporter.kind,
    categoryId,
  });
  if (contactRequired && contactEmail === null) {
    throw new Error(
      '未ログインの権利侵害の通報には連絡先のメールアドレスが要ります',
    );
  }
  if (!contactRequired && contactEmail !== null) {
    throw new Error(
      '権利侵害以外の未ログインの通報は受け付けで連絡先を捨てるため、連絡先を指定しないでください',
    );
  }
  return {
    targetKind: target.kind,
    targetId,
    targetOwnerUserId,
    productId,
    categoryId,
    categoryName: foundCategoryName,
    reporterUserId,
    contactEmail,
  };
}

export function planReportFixture({
  resolved,
  reason,
  now,
  nextId,
}: ReportFixturePlanInput): ReportFixturePlan {
  if (checkReportReason(reason) !== 'ok') {
    throw new RangeError(
      `通報の理由は空白以外の1〜${String(REPORT_REASON_MAX)}文字で指定してください`,
    );
  }
  return {
    ...resolved,
    reportId: nextId(),
    newCaseId: nextId(),
    reason,
    infringement: isInfringementCategory(resolved.categoryId),
    at: now,
  };
}

// 受け付けと同じ2文(未完了の案件の作成または集約と、その案件への通報の挿入)を作り、通知などの後続の処理は起こさない。案件の対象の参照は受け付けと同じく対象から解決した値を持たせる
export function reportFixtureInsertSql(plan: ReportFixturePlan): string {
  const at = integerLiteral(plan.at.getTime());
  const targetKind = sqlStringLiteral(plan.targetKind);
  const targetId = sqlStringLiteral(plan.targetId);
  const categoryId = sqlStringLiteral(plan.categoryId);
  return [
    `INSERT INTO report_cases (id, target_kind, target_id, target_owner_user_id, product_id, status_changed_at, last_reported_at, infringement_reported_at, created_at, updated_at) VALUES (${[
      sqlStringLiteral(plan.newCaseId),
      targetKind,
      targetId,
      sqlStringLiteral(plan.targetOwnerUserId),
      nullableLiteral(plan.productId),
      at,
      at,
      plan.infringement ? at : 'NULL',
      at,
      at,
    ].join(
      ', ',
    )}) ON CONFLICT (target_kind, target_id) WHERE closed_at IS NULL DO UPDATE SET last_reported_at = max(last_reported_at, excluded.last_reported_at), infringement_reported_at = coalesce(infringement_reported_at, excluded.infringement_reported_at), updated_at = excluded.updated_at;`,
    `INSERT INTO reports (id, case_id, reporter_user_id, contact_email, category_id, category_name, reason, reported_at, created_at, updated_at) VALUES (${[
      sqlStringLiteral(plan.reportId),
      `(SELECT id FROM report_cases WHERE target_kind = ${targetKind} AND target_id = ${targetId} AND closed_at IS NULL)`,
      nullableLiteral(plan.reporterUserId),
      nullableLiteral(plan.contactEmail),
      categoryId,
      `(SELECT name FROM report_categories WHERE id = ${categoryId})`,
      sqlStringLiteral(plan.reason),
      at,
      at,
      at,
    ].join(', ')}) RETURNING id, case_id;`,
  ].join('\n');
}

export function parseReportFixtureInsert(
  rows: readonly LocalD1Row[],
  plan: ReportFixturePlan,
): CreatedReport {
  const [row] = rows;
  if (
    row === undefined ||
    rows.length !== 1 ||
    row.id !== plan.reportId ||
    typeof row.case_id !== 'string'
  ) {
    throw new Error(
      `通報(${plan.reportId})を作れませんでした: ${JSON.stringify(rows)}`,
    );
  }
  return {
    reportId: plan.reportId,
    caseId: row.case_id,
    aggregated: row.case_id !== plan.newCaseId,
  };
}

export function reportCaseStateSql(caseId: string): string {
  return `SELECT rc.id AS case_id, rc.status AS status, rc.target_kind AS target_kind, rc.target_id AS target_id, rc.target_owner_user_id AS target_owner_user_id, rc.product_id AS product_id, rc.infringement_reported_at AS infringement_reported_at, r.id AS report_id, r.reporter_user_id AS reporter_user_id, r.contact_email AS contact_email, r.category_id AS category_id, r.category_name AS category_name FROM report_cases rc LEFT JOIN reports r ON r.case_id = rc.id AND r.deleted_at IS NULL WHERE rc.id = ${sqlStringLiteral(caseId)} ORDER BY r.reported_at, r.id;`;
}

const reportStateOf = (row: LocalD1Row): ReportCaseReportState | undefined => {
  const {
    report_id: reportId,
    reporter_user_id: reporterUserId,
    contact_email: contactEmail,
    category_id: categoryId,
    category_name: categoryName,
  } = row;
  if (reportId === null) {
    return undefined;
  }
  if (
    typeof reportId !== 'string' ||
    !isNullableString(reporterUserId) ||
    !isNullableString(contactEmail) ||
    typeof categoryId !== 'string' ||
    typeof categoryName !== 'string'
  ) {
    throw new TypeError('通報の行の形式が正しくありません');
  }
  return { reportId, reporterUserId, contactEmail, categoryId, categoryName };
};

export function parseReportCaseState(
  rows: readonly LocalD1Row[],
  caseId: string,
): ReportCaseState {
  const [row] = rows;
  if (row === undefined) {
    throw new Error(`ローカルのD1に通報の案件(${caseId})がありません`);
  }
  const {
    status,
    target_kind: targetKind,
    target_id: targetId,
    target_owner_user_id: targetOwnerUserId,
    product_id: productId,
    infringement_reported_at: infringementReportedAt,
  } = row;
  const formatError = new Error(
    `通報の案件の照会の結果の形式が正しくありません: ${JSON.stringify(rows)}`,
  );
  if (
    typeof status !== 'string' ||
    typeof targetKind !== 'string' ||
    !isNullableString(targetId) ||
    !isNullableString(targetOwnerUserId) ||
    !isNullableString(productId) ||
    (infringementReportedAt !== null &&
      typeof infringementReportedAt !== 'number')
  ) {
    throw formatError;
  }
  try {
    return {
      caseId,
      status,
      targetKind,
      targetId,
      targetOwnerUserId,
      productId,
      infringementReported: infringementReportedAt !== null,
      reports: rows.flatMap((report) => reportStateOf(report) ?? []),
    };
  } catch (error) {
    throw new Error(formatError.message, { cause: error });
  }
}

// 画面から受け付けた通報の案件を、受け付けと同じ対象の解決で引いた対象の未完了の案件として探す
export function openReportCaseIdSql(target: ReportFixtureTarget): string {
  return `SELECT rc.id AS id FROM report_cases rc WHERE rc.target_kind = ${sqlStringLiteral(target.kind)} AND rc.target_id = (SELECT t.target_id FROM (${targetSql(target)}) t) AND rc.closed_at IS NULL;`;
}

export function parseOpenReportCaseId(
  rows: readonly LocalD1Row[],
  target: ReportFixtureTarget,
): string {
  const [row] = rows;
  if (rows.length !== 1 || typeof row?.id !== 'string') {
    throw new Error(
      `対象(${JSON.stringify(target)})の未完了の通報の案件が1件ではありません: ${JSON.stringify(rows)}`,
    );
  }
  return row.id;
}
