export const CRON_BUDGET = {
  budgetMs: 300_000,
  ceilingMs: 600_000,
  perJobTargetMs: 30_000,
  platformLimitMs: 900_000,
} as const;

export const DAILY_BATCH_CRON = '21 12 * * *';

export interface ScheduledRunSummary {
  readonly time: string;
  readonly cron: string;
  readonly result: 'succeeded' | 'failed';
  readonly jobs: readonly {
    readonly name: string;
    readonly result: 'succeeded' | 'failed';
    readonly durationMs: number;
  }[];
  readonly totalDurationMs: number;
}

export type BudgetVerdict = 'within-budget' | 'over-budget' | 'over-ceiling';

export interface OrderMismatch {
  readonly expected: string;
  readonly actual: string;
}

export interface CronBudgetJudgement {
  readonly run: ScheduledRunSummary;
  readonly totalMs: number;
  readonly verdict: BudgetVerdict | 'reference';
  readonly totalMismatchMs: number;
  readonly slowJobs: readonly {
    readonly name: string;
    readonly durationMs: number;
  }[];
  readonly failedJobs: readonly string[];
  readonly orderMismatches: readonly OrderMismatch[];
  readonly ceilingMarginMs: number;
  readonly platformMarginMs: number;
  readonly headroomJobs: number;
}

type Outcome = 'succeeded' | 'failed';

const ABSENT = '(なし)';

const NOT_EXPECTED_MESSAGE = '4:21の起動の要約の行が見つかりませんでした';

const SUMMARY_KIND = 'scheduled';

const NON_SUMMARY_LEVELS: ReadonlySet<unknown> = new Set([
  'warning',
  'error',
  'fatal',
]);

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isOutcome = (value: unknown): value is Outcome =>
  value === 'succeeded' || value === 'failed';

const isDuration = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value !== '';

const parseJob = (
  value: unknown,
): ScheduledRunSummary['jobs'][number] | undefined => {
  if (!isRecord(value)) return undefined;
  const { name, result, durationMs } = value;
  if (
    !isNonEmptyString(name) ||
    !isOutcome(result) ||
    !isDuration(durationMs)
  ) {
    return undefined;
  }
  return { name, result, durationMs };
};

export function parseScheduledRunSummary(
  line: unknown,
): ScheduledRunSummary | undefined {
  if (!isRecord(line) || line['kind'] !== SUMMARY_KIND) return undefined;
  if (NON_SUMMARY_LEVELS.has(line['level'])) return undefined;
  const { time, cron, result, jobs, totalDurationMs } = line;
  if (
    !isNonEmptyString(time) ||
    !isNonEmptyString(cron) ||
    !isOutcome(result) ||
    !Array.isArray(jobs) ||
    !isDuration(totalDurationMs)
  ) {
    return undefined;
  }
  const parsedJobs = (jobs as readonly unknown[]).map(parseJob);
  if (parsedJobs.some((parsed) => parsed === undefined)) return undefined;
  return {
    time,
    cron,
    result,
    jobs: parsedJobs.filter((parsed) => parsed !== undefined),
    totalDurationMs,
  };
}

export function parseExpectedOrder(text: string): readonly string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
}

const verdictOf = (totalMs: number): BudgetVerdict => {
  if (totalMs <= CRON_BUDGET.budgetMs) return 'within-budget';
  return totalMs <= CRON_BUDGET.ceilingMs ? 'over-budget' : 'over-ceiling';
};

const orderMismatchesOf = (
  expected: readonly string[],
  actual: readonly string[],
): readonly OrderMismatch[] => {
  const expectedNames = new Set(expected);
  const actualNames = new Set(actual);
  const commonExpected = expected.filter((name) => actualNames.has(name));
  const commonActual = actual.filter((name) => expectedNames.has(name));
  const length = Math.max(commonExpected.length, commonActual.length);
  const misplaced = Array.from({ length }, (_, index) => ({
    expected: commonExpected[index] ?? ABSENT,
    actual: commonActual[index] ?? ABSENT,
  })).filter((pair) => pair.expected !== pair.actual);
  return [
    ...expected
      .filter((name) => !actualNames.has(name))
      .map((name) => ({ expected: name, actual: ABSENT })),
    ...actual
      .filter((name) => !expectedNames.has(name))
      .map((name) => ({ expected: ABSENT, actual: name })),
    ...misplaced,
  ];
};

// 実行時間の計測は1ms刻みのため、全てのジョブが0msでも平均を1msとして数え、足せるジョブの数を有限にする
const headroomJobsOf = (
  jobCount: number,
  totalMs: number,
  ceilingMarginMs: number,
): number => {
  if (jobCount === 0 || ceilingMarginMs <= 0) return 0;
  const averageMs = Math.max(totalMs / jobCount, 1);
  return Math.floor(ceilingMarginMs / averageMs);
};

export function judgeCronBudget(
  run: ScheduledRunSummary,
  expectedOrder: readonly string[] | undefined,
): CronBudgetJudgement {
  const totalMs = run.jobs.reduce((sum, { durationMs }) => sum + durationMs, 0);
  const ceilingMarginMs = CRON_BUDGET.ceilingMs - totalMs;
  const common = {
    run,
    totalMs,
    totalMismatchMs: run.totalDurationMs - totalMs,
    failedJobs: run.jobs
      .filter(({ result }) => result === 'failed')
      .map(({ name }) => name),
    ceilingMarginMs,
    platformMarginMs: CRON_BUDGET.platformLimitMs - totalMs,
  };
  if (expectedOrder === undefined) {
    return {
      ...common,
      verdict: 'reference',
      slowJobs: [],
      orderMismatches: [],
      headroomJobs: 0,
    };
  }
  return {
    ...common,
    verdict: verdictOf(totalMs),
    slowJobs: run.jobs
      .filter(({ durationMs }) => durationMs > CRON_BUDGET.perJobTargetMs)
      .map(({ name, durationMs }) => ({ name, durationMs })),
    orderMismatches: orderMismatchesOf(
      expectedOrder,
      run.jobs.map(({ name }) => name),
    ),
    headroomJobs: headroomJobsOf(run.jobs.length, totalMs, ceilingMarginMs),
  };
}

const runKeyOf = ({ time, cron }: ScheduledRunSummary): string =>
  `${time}\u0000${cron}`;

export function judgeCronBudgetRuns(
  runs: readonly ScheduledRunSummary[],
  expectedOrder: readonly string[],
): readonly CronBudgetJudgement[] {
  const uniqueRuns = [
    ...new Map(runs.map((run) => [runKeyOf(run), run])).values(),
  ];
  return uniqueRuns
    .toSorted((left, right) => left.time.localeCompare(right.time))
    .map((run) =>
      judgeCronBudget(
        run,
        run.cron === DAILY_BATCH_CRON ? expectedOrder : undefined,
      ),
    );
}

const formatMs = (value: number): string => value.toLocaleString('en-US');

const failuresOf = (judgement: CronBudgetJudgement): readonly string[] => {
  const { run, totalMs, verdict, failedJobs, slowJobs, orderMismatches } =
    judgement;
  const prefix = `${run.time}(${run.cron}): `;
  const messages = [
    ...(verdict === 'over-budget'
      ? [
          `全体の所要時間が予算${formatMs(CRON_BUDGET.budgetMs)}msを超えました(${formatMs(totalMs)}ms)`,
        ]
      : []),
    ...(verdict === 'over-ceiling'
      ? [
          `全体の所要時間が上限${formatMs(CRON_BUDGET.ceilingMs)}msを超えました(${formatMs(totalMs)}ms)`,
        ]
      : []),
    ...(failedJobs.length > 0
      ? [`失敗したジョブがあります: ${failedJobs.join('、')}`]
      : []),
    ...(slowJobs.length > 0
      ? [
          `目安${formatMs(CRON_BUDGET.perJobTargetMs)}msを超えたジョブがあります: ${slowJobs
            .map(({ name, durationMs }) => `${name}(${formatMs(durationMs)}ms)`)
            .join('、')}`,
        ]
      : []),
    ...(orderMismatches.length > 0
      ? [`ジョブの順序の食い違いが${String(orderMismatches.length)}件あります`]
      : []),
  ];
  return messages.map((message) => `${prefix}${message}`);
};

export function cronBudgetFailures(
  judgements: readonly CronBudgetJudgement[],
): readonly string[] {
  const judged = judgements.filter(({ verdict }) => verdict !== 'reference');
  if (judged.length === 0) return [NOT_EXPECTED_MESSAGE];
  return judged.flatMap(failuresOf);
}

const VERDICT_LABELS: Readonly<Record<CronBudgetJudgement['verdict'], string>> =
  {
    'within-budget': '予算内',
    'over-budget': '予算超過(上限内)',
    'over-ceiling': '上限超過',
    reference: '参考',
  };

const OUTCOME_LABELS: Readonly<Record<Outcome, string>> = {
  succeeded: '成功',
  failed: '失敗',
};

const row = (cells: readonly string[]): string => `| ${cells.join(' | ')} |`;

const table = (
  header: readonly string[],
  rows: readonly (readonly string[])[],
): readonly string[] => [
  row(header),
  row(header.map(() => '---')),
  ...rows.map(row),
];

const jobTable = (
  judgement: CronBudgetJudgement,
  withTarget: boolean,
): readonly string[] =>
  table(
    ['順序', 'ジョブ', '結果', '所要時間(ms)', ...(withTarget ? ['目安'] : [])],
    judgement.run.jobs.map((job, index) => [
      String(index + 1),
      job.name,
      OUTCOME_LABELS[job.result],
      formatMs(job.durationMs),
      ...(withTarget
        ? [job.durationMs > CRON_BUDGET.perJobTargetMs ? '超過' : '以内']
        : []),
    ]),
  );

const mismatchList = (judgement: CronBudgetJudgement): readonly string[] =>
  judgement.orderMismatches.length === 0
    ? []
    : [
        '',
        '順序の食い違い:',
        '',
        ...judgement.orderMismatches.map(
          ({ expected, actual }) =>
            `- 期待 \`${expected}\` に対して実際 \`${actual}\``,
        ),
      ];

const judgedSection = (
  judgements: readonly CronBudgetJudgement[],
): readonly string[] => {
  if (judgements.length === 0) {
    return ['### 4:21の起動', '', '4:21の起動の要約の行はありません。'];
  }
  return [
    '### 4:21の起動',
    '',
    ...table(
      [
        '起動の時刻',
        '結果',
        '全体(ms)',
        '判定',
        '要約との差(ms)',
        '上限までの余裕(ms)',
        '足せるジョブ数',
        'Cron Triggersの上限までの余裕(ms)',
        '失敗',
        '目安を超えたジョブ',
        '順序の食い違い',
      ],
      judgements.map((judgement) => [
        judgement.run.time,
        OUTCOME_LABELS[judgement.run.result],
        formatMs(judgement.totalMs),
        VERDICT_LABELS[judgement.verdict],
        formatMs(judgement.totalMismatchMs),
        formatMs(judgement.ceilingMarginMs),
        String(judgement.headroomJobs),
        formatMs(judgement.platformMarginMs),
        String(judgement.failedJobs.length),
        String(judgement.slowJobs.length),
        String(judgement.orderMismatches.length),
      ]),
    ),
    ...judgements.flatMap((judgement) => [
      '',
      `#### ${judgement.run.time}のジョブ`,
      '',
      ...jobTable(judgement, true),
      ...mismatchList(judgement),
    ]),
  ];
};

const referenceSection = (
  judgements: readonly CronBudgetJudgement[],
): readonly string[] => [
  '### 他の起動(参考の値)',
  '',
  ...table(
    ['起動の時刻', 'cron', '結果', '全体(ms)', 'ジョブの数', '失敗'],
    judgements.map(({ run, totalMs, failedJobs }) => [
      run.time,
      run.cron,
      OUTCOME_LABELS[run.result],
      formatMs(totalMs),
      String(run.jobs.length),
      String(failedJobs.length),
    ]),
  ),
  ...judgements.flatMap((judgement) => [
    '',
    `#### ${judgement.run.time}(${judgement.run.cron})のジョブ`,
    '',
    ...jobTable(judgement, false),
  ]),
];

export function renderCronBudgetMarkdown(
  judgements: readonly CronBudgetJudgement[],
): string {
  const judged = judgements.filter(({ verdict }) => verdict !== 'reference');
  const references = judgements.filter(
    ({ verdict }) => verdict === 'reference',
  );
  const lines = [
    '## 日次バッチの予算の判定',
    '',
    `基準: 予算${formatMs(CRON_BUDGET.budgetMs)}ms・上限${formatMs(CRON_BUDGET.ceilingMs)}ms・各ジョブの目安${formatMs(CRON_BUDGET.perJobTargetMs)}ms・Cron Triggersの上限${formatMs(CRON_BUDGET.platformLimitMs)}ms`,
    '',
    ...judgedSection(judged),
    ...(references.length === 0 ? [] : ['', ...referenceSection(references)]),
  ];
  return `${lines.join('\n')}\n`;
}
