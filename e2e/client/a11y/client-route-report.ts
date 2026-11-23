import type { A11yViolation } from '../../support/a11y-scan.ts';

export interface RouteAuditFinding {
  readonly route: string;
  readonly state: string;
  readonly url: string;
  readonly status: number | null;
  readonly violations: readonly A11yViolation[];
  readonly headerProblems: readonly string[];
}

export interface FindingSummary {
  readonly checked: number;
  readonly withFindings: number;
  readonly violationCount: number;
  readonly headerProblemCount: number;
}

const CASE_KEY_SEPARATOR = '|';

export const routeCaseKey = (route: string, state: string): string =>
  `${route}${CASE_KEY_SEPARATOR}${state}`;

export const routeTestTitle = (route: string, state: string): string =>
  `${route}(${state})は自動のアクセシビリティの検査の違反が0件で、応答にセキュリティヘッダーが付く`;

export const hasFindings = ({
  violations,
  headerProblems,
}: RouteAuditFinding): boolean =>
  violations.length > 0 || headerProblems.length > 0;

const describeViolation = ({
  rule,
  impact,
  wcag,
  targets,
}: A11yViolation): string =>
  [
    `  - 規則 ${rule}(影響度 ${impact ?? '不明'}、WCAG ${wcag.join(', ')})`,
    ...targets.map((target) => `      対象 ${target}`),
  ].join('\n');

export function describeFinding(finding: RouteAuditFinding): string {
  const status =
    finding.status === null
      ? '応答なし'
      : `状態コード${String(finding.status)}`;
  const lines = [`${finding.route}(${finding.state}) ${finding.url} ${status}`];
  if (finding.violations.length > 0) {
    lines.push(
      `アクセシビリティの違反 ${String(finding.violations.length)}件`,
      ...finding.violations.map(describeViolation),
    );
  }
  if (finding.headerProblems.length > 0) {
    lines.push(
      'セキュリティヘッダーの不足',
      ...finding.headerProblems.map((problem) => `  - ${problem}`),
    );
  }
  return lines.join('\n');
}

export function summarizeFindings(
  findings: readonly RouteAuditFinding[],
): FindingSummary {
  return {
    checked: findings.length,
    withFindings: findings.filter(hasFindings).length,
    violationCount: findings.reduce(
      (total, { violations }) => total + violations.length,
      0,
    ),
    headerProblemCount: findings.reduce(
      (total, { headerProblems }) => total + headerProblems.length,
      0,
    ),
  };
}

// 再実行で同じ経路と状態が重ねて書かれても、最後の結果だけを数える
export function parseFindingLines(text: string): readonly RouteAuditFinding[] {
  const latest = new Map<string, RouteAuditFinding>();
  for (const line of text.split('\n')) {
    if (line.trim() === '') {
      continue;
    }
    const finding = JSON.parse(line) as RouteAuditFinding;
    latest.set(routeCaseKey(finding.route, finding.state), finding);
  }
  return [...latest.values()];
}

export const describeSummary = ({
  checked,
  withFindings,
  violationCount,
  headerProblemCount,
}: FindingSummary): string =>
  `検査した経路と状態 ${String(checked)}件、問題のある経路と状態 ${String(withFindings)}件(アクセシビリティの違反 ${String(violationCount)}件、セキュリティヘッダーの不足 ${String(headerProblemCount)}件)`;
