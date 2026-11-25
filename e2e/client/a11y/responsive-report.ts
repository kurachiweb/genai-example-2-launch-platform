import { routeCaseKey } from '../../support/route-audit-report.ts';
import type {
  LayoutIssue,
  LayoutIssueKind,
  StressCondition,
} from './responsive-measure.ts';

export const NARROWEST_WIDTH = 320;

export const VIEWPORT_WIDTHS: readonly number[] = [NARROWEST_WIDTH, 768, 1280];

export const VIEWPORT_HEIGHT = 900;

export const TEXT_STRETCH_RATIO = 1.5;

export const STRESS_CONDITIONS: readonly StressCondition[] = [
  'plain',
  'text-spacing',
  'text-expansion',
  'font-scale',
];

const ISSUE_KINDS: readonly LayoutIssueKind[] = [
  'horizontal-scroll',
  'element-overflow',
  'overlap',
];

export interface ViolationContext {
  readonly route: string;
  readonly state: string;
  readonly width: number;
}

export interface LayoutViolation extends LayoutIssue, ViolationContext {
  readonly condition: StressCondition;
  readonly alsoInPlain: boolean;
}

export interface ResponsiveFinding {
  readonly route: string;
  readonly state: string;
  readonly url: string;
  readonly status: number | null;
  readonly violations: readonly LayoutViolation[];
}

export interface ResponsiveSummary {
  readonly checked: number;
  readonly withViolations: number;
  readonly violationCount: number;
  readonly byKind: Readonly<Record<LayoutIssueKind, number>>;
  readonly byCondition: Readonly<Record<StressCondition, number>>;
}

// 数値の詳細は条件で変わるため、種別と対象だけで同じ問題かを見分ける
export const issueSignature = ({ kind, targets }: LayoutIssue): string =>
  `${kind}:${targets.join(' / ')}`;

export function toViolations(
  context: ViolationContext,
  condition: StressCondition,
  issues: readonly LayoutIssue[],
  plainIssues: readonly LayoutIssue[],
): readonly LayoutViolation[] {
  const plainSignatures = new Set(plainIssues.map(issueSignature));
  return issues.map((issue) => ({
    ...issue,
    ...context,
    condition,
    alsoInPlain: plainSignatures.has(issueSignature(issue)),
  }));
}

export const hasResponsiveViolations = ({
  violations,
}: ResponsiveFinding): boolean => violations.length > 0;

const describeViolation = ({
  width,
  condition,
  kind,
  detail,
  targets,
  alsoInPlain,
}: LayoutViolation): string =>
  [
    `  - ${String(width)}px・${condition}・${kind}: ${detail}${alsoInPlain ? '(伸ばす前から発生)' : ''}`,
    ...targets.map((target) => `      対象 ${target}`),
  ].join('\n');

export function describeResponsiveFinding(finding: ResponsiveFinding): string {
  const status =
    finding.status === null
      ? '応答なし'
      : `状態コード${String(finding.status)}`;
  return [
    `${finding.route}(${finding.state}) ${finding.url} ${status}`,
    ...(finding.violations.length === 0
      ? []
      : [
          `画面の幅と文字列の伸びの違反 ${String(finding.violations.length)}件`,
          ...finding.violations.map(describeViolation),
        ]),
  ].join('\n');
}

const countBy = <Key extends string>(
  keys: readonly Key[],
  values: readonly Key[],
): Readonly<Record<Key, number>> =>
  Object.fromEntries(
    keys.map((key) => [key, values.filter((value) => value === key).length]),
  ) as Record<Key, number>;

export function summarizeResponsiveFindings(
  findings: readonly ResponsiveFinding[],
): ResponsiveSummary {
  const violations = findings.flatMap(({ violations: found }) => found);
  return {
    checked: findings.length,
    withViolations: findings.filter(hasResponsiveViolations).length,
    violationCount: violations.length,
    byKind: countBy(
      ISSUE_KINDS,
      violations.map(({ kind }) => kind),
    ),
    byCondition: countBy(
      STRESS_CONDITIONS,
      violations.map(({ condition }) => condition),
    ),
  };
}

export const describeResponsiveSummary = ({
  checked,
  withViolations,
  violationCount,
  byKind,
  byCondition,
}: ResponsiveSummary): string =>
  `検査した経路と状態 ${String(checked)}件、違反のある経路と状態 ${String(withViolations)}件(違反 ${String(violationCount)}件。種別 ${JSON.stringify(byKind)}、条件 ${JSON.stringify(byCondition)})`;

// 再実行で同じ経路と状態が重ねて書かれても、最後の結果だけを数える
export function parseResponsiveFindingLines(
  text: string,
): readonly ResponsiveFinding[] {
  const latest = new Map<string, ResponsiveFinding>();
  for (const line of text.split('\n')) {
    if (line.trim() === '') {
      continue;
    }
    const finding = JSON.parse(line) as ResponsiveFinding;
    latest.set(routeCaseKey(finding.route, finding.state), finding);
  }
  return [...latest.values()];
}
