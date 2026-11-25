export interface ProbeObservation {
  readonly target: string;
  readonly at: string;
  readonly status: number | 'network-error' | 'timeout';
  readonly durationMs: number;
}

export interface ProbeSummary {
  readonly target: string;
  readonly total: number;
  readonly failures: readonly ProbeObservation[];
  readonly maxDurationMs: number;
}

const FIRST_SUCCESS_STATUS = 200;
const FIRST_FAILURE_STATUS = 400;
const MAX_LISTED_FAILURES = 20;

export const isSuccessfulStatus = (
  status: ProbeObservation['status'],
): boolean =>
  typeof status === 'number' &&
  status >= FIRST_SUCCESS_STATUS &&
  status < FIRST_FAILURE_STATUS;

export function tallyProbe(
  observations: readonly ProbeObservation[],
): readonly ProbeSummary[] {
  const byTarget = new Map<string, ProbeObservation[]>();
  for (const observation of observations) {
    const group = byTarget.get(observation.target) ?? [];
    group.push(observation);
    byTarget.set(observation.target, group);
  }
  return [...byTarget].map(([target, group]) => ({
    target,
    total: group.length,
    failures: group.filter(({ status }) => !isSuccessfulStatus(status)),
    maxDurationMs: Math.max(...group.map(({ durationMs }) => durationMs)),
  }));
}

// 1件も観測できていない監視は、何も確かめていないため成功とみなさない
export const probeSucceeded = (summaries: readonly ProbeSummary[]): boolean =>
  summaries.length > 0 &&
  summaries.every(({ failures }) => failures.length === 0);

const describeStatus = (status: ProbeObservation['status']): string => {
  if (status === 'timeout') return '時間切れ';
  if (status === 'network-error') return '通信の失敗';
  return String(status);
};

const summaryLine = ({
  target,
  total,
  failures,
  maxDurationMs,
}: ProbeSummary): string =>
  `- ${target}: ${String(total)}件、失敗${String(failures.length)}件、最大の応答時間${String(maxDurationMs)}ms`;

const failureLines = ({
  target,
  failures,
}: ProbeSummary): readonly string[] => {
  if (failures.length === 0) return [];
  const listed = failures
    .slice(0, MAX_LISTED_FAILURES)
    .map(
      ({ at, status, durationMs }) =>
        `  - ${at} ${describeStatus(status)}(${String(durationMs)}ms)`,
    );
  const omitted = failures.length - listed.length;
  return [
    `${target}:`,
    ...listed,
    ...(omitted > 0 ? [`  - ほか${String(omitted)}件`] : []),
  ];
};

export function formatProbeReport(summaries: readonly ProbeSummary[]): string {
  if (summaries.length === 0) {
    return '観測した応答がありません。\n判定: 失敗(何も確かめられていません)\n';
  }
  const details = summaries.flatMap(failureLines);
  return [
    ...summaries.map(summaryLine),
    ...(details.length > 0 ? ['', '失敗の内訳:', ...details] : []),
    '',
    probeSucceeded(summaries)
      ? '判定: 成功(全対象で失敗0件)'
      : '判定: 失敗(失敗した対象があります)',
    '',
  ].join('\n');
}
