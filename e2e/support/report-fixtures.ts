import { randomBytes } from 'node:crypto';

import { fixtureId, ID_RANDOM_BYTES } from './directory-fixture-sql.ts';
import { executeLocalD1 } from './local-d1.ts';
import {
  type CreatedReport,
  parseReportCaseState,
  parseReportFixtureInsert,
  parseReportFixtureLookup,
  planReportFixture,
  reportCaseStateSql,
  type ReportCaseState,
  type ReportFixtureRequest,
  reportFixtureInsertSql,
  reportFixtureLookupSql,
} from './report-fixture-sql.ts';

export type {
  CreatedReport,
  ReportCaseReportState,
  ReportCaseState,
  ReportFixtureReporter,
  ReportFixtureTarget,
} from './report-fixture-sql.ts';

export interface ReportRequest extends ReportFixtureRequest {
  readonly reason?: string;
}

const DEFAULT_REASON = 'E2Eの通報の理由です。';

const nextFixtureId = (): string =>
  fixtureId(new Date(), randomBytes(ID_RANDOM_BYTES));

// 画面からの受け付けと同じ形で、指定した対象・カテゴリ・通報者の通報を1件作り、対象に未完了の案件があればそこへ集約し、無ければ未対応の案件を作る。受け付けのbot判定・回数制限・通知を通さず、送信元IPアドレスも保存しないため、画面から送る場面はclient-ip.tsとbot-verification.tsを使う
export async function createReport({
  reason = DEFAULT_REASON,
  ...request
}: ReportRequest): Promise<CreatedReport> {
  const resolved = parseReportFixtureLookup(
    await executeLocalD1(reportFixtureLookupSql(request)),
    request,
  );
  const plan = planReportFixture({
    resolved,
    reason,
    now: new Date(),
    nextId: nextFixtureId,
  });
  return parseReportFixtureInsert(
    await executeLocalD1(reportFixtureInsertSql(plan)),
    plan,
  );
}

// 案件の状態と論理削除されていない通報を、画面を介さずに確かめる
export async function readReportCaseState(
  caseId: string,
): Promise<ReportCaseState> {
  return parseReportCaseState(
    await executeLocalD1(reportCaseStateSql(caseId)),
    caseId,
  );
}
