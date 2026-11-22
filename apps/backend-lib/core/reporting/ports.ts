import type { ReportTargetKind } from '../../../common-lib/reporting/report-rules.ts';

export interface ReportErasureStore {
  eraseByReporter(
    userId: string,
    limit: number,
  ): Promise<{ readonly remaining: boolean }>;
  detachCasesByOwner(
    userId: string,
    at: Date,
    limit: number,
  ): Promise<{ readonly remaining: boolean }>;
  detachCasesByProduct(
    productId: string,
    at: Date,
    limit: number,
  ): Promise<{ readonly remaining: boolean }>;
  eraseGuestReportsClosedBefore(
    threshold: Date,
    limit: number,
  ): Promise<number>;
  eraseDetachedCasesBefore(threshold: Date, limit: number): Promise<number>;
  eraseEmptyCases(limit: number): Promise<number>;
}

export interface ReportExportRecord {
  readonly id: string;
  readonly targetType: ReportTargetKind;
  // ユーザー・プロダクトは現在のハンドル、コメントはコメントのID。解決できない、または対象への参照が消されていればnull
  readonly targetRef: string | null;
  // 受付時点のカテゴリ名
  readonly category: string;
  readonly reason: string;
  // 受付日時
  readonly createdAt: Date;
}

export interface ReportExport {
  // 論理削除されていない本人の通報をIDの昇順に返す。不正な続きの位置はAppError(bad_request, 'invalid_cursor')
  listPage(input: {
    // 直前のページの最後のID
    readonly after?: string;
    readonly userId: string;
    // 呼び出し側が1〜20で渡す
    readonly limit: number;
  }): Promise<{
    readonly records: readonly ReportExportRecord[];
    readonly nextAfter: string | null;
  }>;
}
