import type {
  OpenReportCaseStatus,
  ReportCaseStatus,
  ReportResolution,
} from '../../../common-lib/reporting/report-case-rules.ts';
import type { ReportTargetKind } from '../../../common-lib/reporting/report-rules.ts';
import type { PreparedAuditEntry } from '../../../lib/core/admin/audit-log.ts';
import type { CurrentAdmin } from '../../../lib/core/admin/current-admin.ts';
import type { ResponseTime } from '../../../lib/core/reporting/response-time.ts';
import type { SessionView } from '../../../lib/core/session/session-view.ts';

export interface ResolvedReportTarget {
  readonly kind: ReportTargetKind;
  readonly targetId: string;
  // ユーザーの対象は本人
  readonly ownerUserId: string;
  // プロダクトとコメントの対象のプロダクト
  readonly productId: string | null;
}

export interface ReportTargetKey {
  readonly kind: ReportTargetKind;
  // 対象の物理削除で対象への参照を消した案件はnull
  readonly targetId: string | null;
  readonly productId: string | null;
}

export interface ReportTargetView {
  // 退会・削除・物理削除で読めない対象と、対象への参照を消した案件はfalse
  readonly available: boolean;
  readonly handle: string | null;
  // ユーザーはニックネーム、プロダクトは名称
  readonly label: string | null;
  readonly excerpt: string | null;
  readonly productName: string | null;
  readonly productHandle: string | null;
  // 匿名化されたコメントだけtrue。匿名化で投稿者との紐付きが消え、投稿者へ通知を送れないため
  readonly anonymized: boolean;
}

export interface ReportTargetResolver {
  // refはユーザーがハンドル、プロダクト・コメントがID。他者に見えない対象はundefined
  resolveForSubmission(
    kind: ReportTargetKind,
    ref: string,
  ): Promise<ResolvedReportTarget | undefined>;
  // 鍵は'<kind>:<targetId>'。targetIdがnullの鍵は照会せずavailable: falseを返す
  describe(
    keys: readonly ReportTargetKey[],
  ): Promise<ReadonlyMap<string, ReportTargetView>>;
}

export interface ReportSubmissionInput {
  readonly targetKind: ReportTargetKind;
  readonly targetRef: string;
  readonly categoryId: string;
  // リゾルバが形式を検証済み
  readonly reason: string;
  // リゾルバが要否を判定し、要らなければundefined
  readonly contactEmail: string | undefined;
}

export interface ReportRequestMeta {
  readonly clientIp: string | undefined;
  // リゾルバが要求ごとに1回読んだ時刻で、回数制限と保存で共有する
  readonly now: Date;
}

export interface ReportSubmissionService {
  submit(
    session: SessionView,
    input: ReportSubmissionInput,
    meta: ReportRequestMeta,
  ): Promise<void>;
}

// 停止中の利用者は通報者として記録しないため、未ログインと同じguestとして数える
export type ReportSubmitter =
  | { readonly kind: 'member'; readonly userId: string }
  | { readonly kind: 'guest' };

export interface ReportSubmissionRateLimit {
  // 超過はAppError(rate_limited, rate_limit_exceeded)とretryAfterSeconds
  consume(
    submitter: ReportSubmitter,
    clientIp: string | undefined,
    now: Date,
  ): Promise<void>;
}

export interface ReportSubmissionRecord {
  readonly reportId: string;
  // 対象に未完了の案件が無いときに使うID
  readonly newCaseId: string;
  readonly target: ResolvedReportTarget;
  readonly reporterUserId: string | null;
  readonly contactEmail: string | null;
  readonly categoryId: string;
  readonly reason: string;
  readonly infringement: boolean;
  readonly at: Date;
}

export interface ReportSubmissionStore {
  // 通報と案件の作成または未完了の案件への集約を1つの一括の書き込みで確定する
  submit(
    record: ReportSubmissionRecord,
  ): Promise<'accepted' | 'category-missing'>;
}

export interface ReportCaseFilter {
  readonly status?: ReportCaseStatus;
  readonly targetKind?: ReportTargetKind;
  // そのカテゴリの通報を含む案件
  readonly categoryId?: string;
  // その期間に受け付けた通報を含む案件。開始は含み、終了は含まない
  readonly reportedFrom?: Date;
  readonly reportedBefore?: Date;
}

export interface ReportCategoryCount {
  readonly categoryId: string;
  // カテゴリの現在の名前
  readonly name: string;
  readonly count: number;
}

export interface ReportCaseRecord {
  readonly caseId: string;
  readonly targetKind: ReportTargetKind;
  readonly targetId: string | null;
  readonly targetDetachedAt: Date | null;
  readonly targetOwnerUserId: string | null;
  readonly productId: string | null;
  readonly status: ReportCaseStatus;
  readonly statusChangedAt: Date;
  readonly infringementReportedAt: Date | null;
  readonly closedAt: Date | null;
  readonly resolution: ReportResolution | null;
  readonly closingReason: string | null;
  readonly lastInquiredAt: Date | null;
  readonly lastInquiryMessage: string | null;
  // 論理削除した通報を除く
  readonly reportCount: number;
  readonly firstReportedAt: Date;
  readonly lastReportedAt: Date;
  readonly categoryCounts: readonly ReportCategoryCount[];
}

export interface ReportCaseReportRecord {
  readonly reportId: string;
  readonly categoryId: string;
  readonly categoryName: string;
  readonly reason: string;
  readonly reportedAt: Date;
  readonly reporterUserId: string | null;
  // 連絡先のメールアドレスは返さず、有無だけを返す
  readonly hasContact: boolean;
}

export interface UnhandledReportCount {
  readonly open: number;
  readonly infringementOpen: number;
}

export interface ProductReportSummary {
  // 対象がそのプロダクトの案件の、論理削除した通報を除く通報の累計
  readonly reportCount: number;
  readonly openCase: {
    readonly caseId: string;
    readonly status: OpenReportCaseStatus;
  } | null;
}

// どの照会も、論理削除した通報を除く通報が1件以上ある案件だけを扱う
export interface ReportCaseStore {
  // (last_reported_at, id)の降順
  search(
    filter: ReportCaseFilter,
    page: { readonly after?: string; readonly limit: number },
  ): Promise<{
    readonly items: readonly ReportCaseRecord[];
    readonly nextCursor: string | null;
  }>;
  find(caseId: string): Promise<ReportCaseRecord | undefined>;
  // 受付日時の昇順
  listReports(caseId: string): Promise<readonly ReportCaseReportRecord[]>;
  countUnhandled(): Promise<UnhandledReportCount>;
  productSummary(productId: string): Promise<ProductReportSummary>;
}

// 申出者が全員退会して全ての通報を論理削除した案件の当事者にも通知を送るため、表示する通報の有無で絞らずに読む
export interface ReportNoticeCaseReader {
  // 表示する通報が無い案件はreportCountが0、categoryCountsが空、firstReportedAtがlastReportedAt
  findForNotice(caseId: string): Promise<ReportCaseRecord | undefined>;
}

export interface CaseClosing {
  readonly caseId: string;
  readonly to: 'resolved' | 'rejected';
  // 却下はnull
  readonly resolution: ReportResolution | null;
  readonly reason: string;
  // 却下で投稿者がいればpending、却下で対象への参照を消した案件はskipped、対応済はnone
  readonly posterNotice: 'pending' | 'skipped' | 'none';
  readonly at: Date;
  readonly audit: PreparedAuditEntry;
}

export interface ReportCaseStatusChange {
  readonly caseId: string;
  readonly from: ReportCaseStatus;
  readonly to: ReportCaseStatus;
  readonly reason: string | undefined;
  readonly at: Date;
  readonly audit: PreparedAuditEntry;
}

export interface ReportCaseInquiryRecord {
  readonly caseId: string;
  readonly message: string;
  readonly at: Date;
  readonly audit: PreparedAuditEntry;
}

// 各操作を監査ログとともに単独の一括の書き込みで確定する。conflictは変更前の状態の不一致、not-foundは読んだ後に案件が物理削除されたことを表す
export interface ReportCaseWriter {
  // open-case-existsは同じ対象に未完了の案件があるための再開の失敗
  changeStatus(
    input: ReportCaseStatusChange,
  ): Promise<'committed' | 'conflict' | 'open-case-exists' | 'not-found'>;
  // 措置なしの対応済と却下で、措置の記録のIDを持たない
  close(input: CaseClosing): Promise<'committed' | 'conflict' | 'not-found'>;
  recordInquiry(
    input: ReportCaseInquiryRecord,
  ): Promise<'committed' | 'conflict' | 'not-found'>;
}

export interface ReportCategoryRecord {
  readonly id: string;
  readonly name: string;
  readonly systemDefault: boolean;
  readonly createdAt: Date;
}

export interface ReportCategoryStore {
  // reportCountは紐付く通報の件数で、論理削除した通報を含む
  list(): Promise<
    readonly (ReportCategoryRecord & { readonly reportCount: number })[]
  >;
  find(id: string): Promise<ReportCategoryRecord | undefined>;
  countReports(id: string): Promise<number>;
  insert(
    category: { readonly id: string; readonly name: string; readonly at: Date },
    audit: PreparedAuditEntry,
  ): Promise<'created' | 'name-taken'>;
  rename(
    id: string,
    name: string,
    at: Date,
    audit: PreparedAuditEntry,
  ): Promise<'renamed' | 'name-taken' | 'not-found'>;
  // 紐付く通報を「その他」へ付け替えてから削除する。受付時点のカテゴリ名は変えない
  deleteAndReassign(
    id: string,
    at: Date,
    audit: PreparedAuditEntry,
  ): Promise<'deleted' | 'not-found'>;
}

export interface PendingOutcomeNotice {
  readonly reportId: string;
  readonly reporterUserId: string | null;
  readonly contactEmail: string | null;
}

export interface ReportNoticeStore {
  // 通報のIDの昇順
  listPendingOutcome(caseId: string): Promise<readonly PendingOutcomeNotice[]>;
  // 依頼待ちの行だけを進める。宛先のまとまりの通報を1文で全部進め、冪等のキーに使う最小の通報のIDを送り直しで変えない
  markOutcome(
    reportIds: readonly string[],
    to: 'requested' | 'skipped',
    at: Date,
  ): Promise<number>;
  // 依頼待ちのときだけ進める
  markPoster(
    caseId: string,
    to: 'requested' | 'skipped',
    at: Date,
  ): Promise<boolean>;
  posterNoticePending(caseId: string): Promise<boolean>;
  listCasesWithPendingNotices(input: {
    readonly closedBefore: Date;
    readonly limit: number;
  }): Promise<readonly string[]>;
}

export type ReportIncident =
  'notice-redispatch-failed' | 'inquiry-record-failed';

export interface ReportIncidentContext {
  readonly job?: string;
  readonly caseId?: string;
  readonly count?: number;
}

// application層はエラートラッキングのSDKを読めないため、定型の通知をこのポート越しに送る
export interface ReportIncidentReporter {
  report(incident: ReportIncident, context: ReportIncidentContext): void;
}

export interface ReportCaseSummaryView {
  readonly caseId: string;
  readonly target: ReportTargetKey & { readonly view: ReportTargetView };
  readonly status: ReportCaseStatus;
  readonly reportCount: number;
  readonly categoryCounts: readonly ReportCategoryCount[];
  readonly firstReportedAt: Date;
  readonly lastReportedAt: Date;
  readonly infringement: boolean;
  // 権利侵害の案件だけ
  readonly responseTime: ResponseTime | null;
}

export interface ReportCaseInquiryView {
  readonly sentAt: Date;
  readonly message: string;
  readonly deadline: Date;
  // 対応中で期限を過ぎていれば真
  readonly overdue: boolean;
}

export type ReportCaseReporterView =
  | {
      readonly kind: 'member';
      readonly nickname: string | null;
      readonly handle: string | null;
    }
  | { readonly kind: 'guest'; readonly hasContact: boolean };

export interface ReportCaseReportView {
  readonly reportId: string;
  // 現在のカテゴリ名
  readonly categoryName: string;
  readonly reason: string;
  readonly reportedAt: Date;
  readonly reporter: ReportCaseReporterView;
}

export interface ReportCaseDetailView extends ReportCaseSummaryView {
  readonly statusChangedAt: Date;
  readonly resolution: ReportResolution | null;
  readonly closingReason: string | null;
  readonly closedAt: Date | null;
  readonly lastInquiry: ReportCaseInquiryView | null;
  // 権利侵害・対応中・投稿者の宛先がある
  readonly inquiryAvailable: boolean;
  readonly reports: readonly ReportCaseReportView[];
}

export interface ReportCaseReader {
  list(
    filter: ReportCaseFilter,
    page: { readonly after?: string; readonly first: number },
    now: Date,
  ): Promise<{
    readonly items: readonly ReportCaseSummaryView[];
    readonly nextCursor: string | null;
  }>;
  detail(caseId: string, now: Date): Promise<ReportCaseDetailView | undefined>;
  unhandledSummary(): Promise<UnhandledReportCount>;
  productSummary(productId: string): Promise<ProductReportSummary>;
}

export interface ReportCaseCommand {
  readonly caseId: string;
  readonly operator: { readonly adminId: string };
  readonly at: Date;
}

export interface ReportCaseStatusChangeCommand extends ReportCaseCommand {
  readonly from: ReportCaseStatus;
  readonly to: ReportCaseStatus;
  // 完了への変更と再開では必須
  readonly reason: string | undefined;
}

export interface ReportCaseClosingCommand extends ReportCaseCommand {
  readonly reason: string;
}

// 認可は行わず、呼び出し側のリゾルバが行う
export interface ReportCaseWorkflow {
  changeStatus(
    command: ReportCaseStatusChangeCommand,
  ): Promise<{ readonly status: ReportCaseStatus }>;
  resolveWithMeasure(
    command: ReportCaseClosingCommand,
  ): Promise<{ readonly status: 'resolved' }>;
  resolveWithoutMeasure(
    command: ReportCaseClosingCommand,
  ): Promise<{ readonly status: 'resolved' }>;
  reject(
    command: ReportCaseClosingCommand,
  ): Promise<{ readonly status: 'rejected' }>;
}

export interface InfringementInquiryCommand extends ReportCaseCommand {
  readonly message: string;
  readonly reason: string | undefined;
}

export interface InfringementInquiryService {
  send(
    command: InfringementInquiryCommand,
  ): Promise<{ readonly sentAt: Date; readonly deadline: Date }>;
}

export interface ReportNotifier {
  // 完了していない案件では何もしない。送信の例外は投げ、残りの宛先は依頼待ちのまま残る
  dispatch(
    caseId: string,
  ): Promise<{ readonly requested: number; readonly skipped: number }>;
}

export interface ReportCategoryView {
  readonly id: string;
  readonly name: string;
  readonly systemDefault: boolean;
  readonly infringement: boolean;
  // 管理画面だけで使う。紐付く通報の件数(論理削除した通報を含む)
  readonly reportCount: number;
}

export type ReportCategoryFormView = Omit<
  ReportCategoryView,
  'reportCount' | 'systemDefault'
>;

export interface ReportCategoryService {
  listForForm(): Promise<readonly ReportCategoryFormView[]>;
  listForAdmin(): Promise<readonly ReportCategoryView[]>;
  create(
    current: CurrentAdmin,
    input: { readonly name: string; readonly reason?: string },
  ): Promise<ReportCategoryView>;
  rename(
    current: CurrentAdmin,
    input: {
      readonly id: string;
      readonly name: string;
      readonly reason?: string;
    },
  ): Promise<ReportCategoryView>;
  delete(
    current: CurrentAdmin,
    input: { readonly id: string; readonly reason?: string },
  ): Promise<{ readonly reassignedCount: number }>;
}
