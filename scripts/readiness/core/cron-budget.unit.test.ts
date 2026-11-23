import { describe, expect, test } from 'bun:test';

import {
  CRON_BUDGET,
  DAILY_BATCH_CRON,
  type ScheduledRunSummary,
  cronBudgetFailures,
  judgeCronBudget,
  judgeCronBudgetRuns,
  parseExpectedOrder,
  parseScheduledRunSummary,
  renderCronBudgetMarkdown,
} from './cron-budget.ts';

type Job = ScheduledRunSummary['jobs'][number];

const job = (
  name: string,
  durationMs: number,
  result: Job['result'] = 'succeeded',
): Job => ({ name, result, durationMs });

const sumOf = (jobs: readonly Job[]): number =>
  jobs.reduce((total, { durationMs }) => total + durationMs, 0);

const runOf = (
  jobs: readonly Job[],
  overrides: Partial<ScheduledRunSummary> = {},
): ScheduledRunSummary => ({
  time: '2026-11-24T12:21:30.000Z',
  cron: DAILY_BATCH_CRON,
  result: jobs.every(({ result }) => result === 'succeeded')
    ? 'succeeded'
    : 'failed',
  jobs,
  totalDurationMs: sumOf(jobs),
  ...overrides,
});

const runWithTotal = (totalMs: number): ScheduledRunSummary =>
  runOf([job('a.first', totalMs - 1), job('a.second', 1)]);

const summaryLine = (overrides: Record<string, unknown> = {}) => ({
  time: '2026-11-24T12:21:30.000Z',
  level: 'info',
  category: 'api.scheduled.dispatcher',
  message: '定期実行を終えました',
  correlationId: 'c0ffee00-0000-4000-8000-000000000000',
  kind: 'scheduled',
  cron: '21 12 * * *',
  result: 'succeeded',
  jobs: [
    { name: 'a.first', result: 'succeeded', durationMs: 120 },
    { name: 'a.second', result: 'succeeded', durationMs: 80 },
  ],
  totalDurationMs: 200,
  ...overrides,
});

const EXPECTED = ['a.first', 'a.second', 'a.third'] as const;

// 目安を超えるジョブを含めずに、合計が指定のmsになるジョブを作る
const totalJobs = (totalMs: number): readonly Job[] => {
  const full = Math.floor(totalMs / 30_000);
  const rest = totalMs - full * 30_000;
  return [
    ...Array.from({ length: full }, (_, index) =>
      job(`j.${String(index)}`, 30_000),
    ),
    ...(rest > 0 ? [job('j.rest', rest)] : []),
  ];
};

const totalNames = (totalMs: number): readonly string[] =>
  totalJobs(totalMs).map(({ name }) => name);

describe('CRON_BUDGET', () => {
  test('予算・上限・各ジョブの目安・Cron Triggersの上限を仮1の値で持つ', () => {
    expect(CRON_BUDGET).toStrictEqual({
      budgetMs: 300_000,
      ceilingMs: 600_000,
      perJobTargetMs: 30_000,
      platformLimitMs: 900_000,
    });
  });

  test('4:21の起動のcron式は業務時刻の4:21をUTCにした式である', () => {
    expect(DAILY_BATCH_CRON).toBe('21 12 * * *');
  });
});

describe('parseScheduledRunSummary', () => {
  test('定期実行の要約の行を要約として読む', () => {
    expect(parseScheduledRunSummary(summaryLine())).toStrictEqual({
      time: '2026-11-24T12:21:30.000Z',
      cron: '21 12 * * *',
      result: 'succeeded',
      jobs: [
        { name: 'a.first', result: 'succeeded', durationMs: 120 },
        { name: 'a.second', result: 'succeeded', durationMs: 80 },
      ],
      totalDurationMs: 200,
    });
  });

  test('失敗したジョブを含む要約の結果とジョブの結果をそのまま読む', () => {
    const parsed = parseScheduledRunSummary(
      summaryLine({
        result: 'failed',
        jobs: [{ name: 'a.first', result: 'failed', durationMs: 5 }],
        totalDurationMs: 5,
      }),
    );

    expect(parsed?.result).toBe('failed');
    expect(parsed?.jobs[0]?.result).toBe('failed');
  });

  test('ジョブの失敗の行は要約として読まない', () => {
    const line = {
      time: '2026-11-24T12:21:10.000Z',
      level: 'error',
      category: 'api.scheduled.dispatcher',
      message: '定期実行のジョブが失敗しました',
      kind: 'scheduled',
      cron: '21 12 * * *',
      job: 'a.first',
      durationMs: 5,
      error: { name: 'Error', message: 'boom' },
    };

    expect(parseScheduledRunSummary(line)).toBeUndefined();
  });

  test('予算の超過の警告の行は合計の所要時間を持っていても要約として読まない', () => {
    const line = {
      time: '2026-11-24T12:26:40.000Z',
      level: 'warning',
      category: 'api.scheduled.dispatcher',
      message: '定期実行の合計の所要時間が予算を超えました',
      kind: 'scheduled',
      cron: '21 12 * * *',
      totalDurationMs: 300_001,
      maxTotalDurationMs: 300_000,
      jobCount: 2,
    };

    expect(parseScheduledRunSummary(line)).toBeUndefined();
  });

  test('警告の水準の行はジョブの配列を持っていても要約として読まない', () => {
    expect(
      parseScheduledRunSummary(summaryLine({ level: 'warning' })),
    ).toBeUndefined();
  });

  test('ジョブが登録されていない時刻の警告の行は要約として読まない', () => {
    const line = {
      time: '2026-11-24T12:22:00.000Z',
      level: 'warning',
      message: 'ジョブが登録されていない時刻で定期実行が起動しました',
      kind: 'scheduled',
      cron: '22 12 * * *',
    };

    expect(parseScheduledRunSummary(line)).toBeUndefined();
  });

  test('kindがscheduledでない行は要約として読まない', () => {
    expect(
      parseScheduledRunSummary(summaryLine({ kind: 'request' })),
    ).toBeUndefined();
  });

  test.each([
    ['null', null],
    ['未定義', undefined],
    ['文字列', '定期実行を終えました'],
    ['数値', 200],
    ['配列', [summaryLine()]],
  ])('オブジェクトでない値(%s)は要約として読まない', (_label, value) => {
    expect(parseScheduledRunSummary(value)).toBeUndefined();
  });

  test.each([
    ['time', { time: undefined }],
    ['timeが文字列でない', { time: 1_700_000_000 }],
    ['cron', { cron: undefined }],
    ['resultが未知の値', { result: 'running' }],
    ['jobsが配列でない', { jobs: 'a.first' }],
    ['jobsが無い', { jobs: undefined }],
    ['totalDurationMsが無い', { totalDurationMs: undefined }],
    ['totalDurationMsが文字列', { totalDurationMs: '200' }],
    ['totalDurationMsが負', { totalDurationMs: -1 }],
    ['totalDurationMsが非有限', { totalDurationMs: Number.NaN }],
  ])(
    '項目の欠落や型の誤り(%s)がある行は要約として読まない',
    (_label, patch) => {
      expect(parseScheduledRunSummary(summaryLine(patch))).toBeUndefined();
    },
  );

  test.each([
    ['名前が無い', { result: 'succeeded', durationMs: 1 }],
    ['名前が空', { name: '', result: 'succeeded', durationMs: 1 }],
    ['結果が未知', { name: 'a.first', result: 'skipped', durationMs: 1 }],
    ['所要時間が無い', { name: 'a.first', result: 'succeeded' }],
    ['所要時間が負', { name: 'a.first', result: 'succeeded', durationMs: -1 }],
    [
      '所要時間が文字列',
      { name: 'a.first', result: 'succeeded', durationMs: '1' },
    ],
    ['オブジェクトでない', 'a.first'],
  ])('ジョブの項目が不正(%s)な行は要約として読まない', (_label, badJob) => {
    expect(
      parseScheduledRunSummary(summaryLine({ jobs: [badJob] })),
    ).toBeUndefined();
  });

  test('所要時間が0のジョブと空のジョブの配列は要約として読む', () => {
    const parsed = parseScheduledRunSummary(
      summaryLine({
        jobs: [{ name: 'a.first', result: 'succeeded', durationMs: 0 }],
        totalDurationMs: 0,
      }),
    );

    expect(parsed?.jobs).toHaveLength(1);
    expect(
      parseScheduledRunSummary(summaryLine({ jobs: [], totalDurationMs: 0 })),
    ).toBeDefined();
  });
});

describe('parseExpectedOrder', () => {
  test('1行に1つのジョブの名前を、空行と前後の空白を除いて順に読む', () => {
    const text = '  a.first \n\na.second\r\n\t\na.third\n';

    expect(parseExpectedOrder(text)).toStrictEqual([
      'a.first',
      'a.second',
      'a.third',
    ]);
  });

  test('#で始まる行は注釈として読み飛ばす', () => {
    expect(parseExpectedOrder('# 4:21の表\na.first\n  # 補足\n')).toStrictEqual(
      ['a.first'],
    );
  });

  test('空の入力は空の順序になる', () => {
    expect(parseExpectedOrder('')).toStrictEqual([]);
    expect(parseExpectedOrder('\n  \n')).toStrictEqual([]);
  });
});

describe('judgeCronBudget の全体の所要時間の判定', () => {
  test.each([
    [0, 'within-budget'],
    [299_999, 'within-budget'],
    [300_000, 'within-budget'],
    [300_001, 'over-budget'],
    [600_000, 'over-budget'],
    [600_001, 'over-ceiling'],
    [900_000, 'over-ceiling'],
  ] as const)('ジョブの合計が%dmsなら%sと判定する', (totalMs, verdict) => {
    const judgement = judgeCronBudget(
      totalMs === 0 ? runOf([job('a.first', 0)]) : runWithTotal(totalMs),
      ['a.first', 'a.second'],
    );

    expect(judgement.totalMs).toBe(totalMs);
    expect(judgement.verdict).toBe(verdict);
  });

  test('全体の所要時間はジョブの所要時間の合計で判定し、要約のtotalDurationMsは差だけを並べる', () => {
    const run = runOf([job('a.first', 200_000), job('a.second', 100_000)], {
      totalDurationMs: 300_450,
    });

    const judgement = judgeCronBudget(run, ['a.first', 'a.second']);

    expect(judgement.totalMs).toBe(300_000);
    expect(judgement.verdict).toBe('within-budget');
    expect(judgement.totalMismatchMs).toBe(450);
  });

  test('要約の合計がジョブの和より小さいときの差は負になる', () => {
    const run = runOf([job('a.first', 1000)], { totalDurationMs: 900 });

    expect(judgeCronBudget(run, ['a.first']).totalMismatchMs).toBe(-100);
  });

  test('要約の合計とジョブの和が等しければ差は0である', () => {
    const run = runOf([job('a.first', 1000)]);

    expect(judgeCronBudget(run, ['a.first']).totalMismatchMs).toBe(0);
  });

  test('判定には元の要約をそのまま添える', () => {
    const run = runOf([job('a.first', 1000)]);

    expect(judgeCronBudget(run, ['a.first']).run).toBe(run);
  });
});

describe('judgeCronBudget の各ジョブの目安', () => {
  test('目安ちょうどの30,000msは超過とせず、30,001msは超過とする', () => {
    const run = runOf([job('a.first', 30_000), job('a.second', 30_001)]);

    const judgement = judgeCronBudget(run, ['a.first', 'a.second']);

    expect(judgement.slowJobs).toStrictEqual([
      { name: 'a.second', durationMs: 30_001 },
    ]);
  });

  test('目安を超えたジョブは起動の順に全て並べる', () => {
    const run = runOf([
      job('a.first', 40_000),
      job('a.second', 10),
      job('a.third', 90_000),
    ]);

    const judgement = judgeCronBudget(run, EXPECTED);

    expect(judgement.slowJobs.map(({ name }) => name)).toStrictEqual([
      'a.first',
      'a.third',
    ]);
  });

  test('失敗したジョブの所要時間が目安を超えていても超過として並べる', () => {
    const run = runOf([job('a.first', 31_000, 'failed')]);

    expect(judgeCronBudget(run, ['a.first']).slowJobs).toHaveLength(1);
  });
});

describe('judgeCronBudget の失敗したジョブ', () => {
  test('失敗したジョブの名前を起動の順に並べる', () => {
    const run = runOf([
      job('a.first', 1, 'failed'),
      job('a.second', 1),
      job('a.third', 1, 'failed'),
    ]);

    expect(judgeCronBudget(run, EXPECTED).failedJobs).toStrictEqual([
      'a.first',
      'a.third',
    ]);
  });

  test('全て成功なら失敗したジョブは空である', () => {
    expect(
      judgeCronBudget(runOf([job('a.first', 1)]), ['a.first']).failedJobs,
    ).toStrictEqual([]);
  });
});

describe('judgeCronBudget の順序の食い違い', () => {
  test('期待の順序と同じなら食い違いは無い', () => {
    const run = runOf([
      job('a.first', 1),
      job('a.second', 1),
      job('a.third', 1),
    ]);

    expect(judgeCronBudget(run, EXPECTED).orderMismatches).toStrictEqual([]);
  });

  test('隣り合う2つが入れ替わると、入れ替わった位置ごとに期待と実際を並べる', () => {
    const run = runOf([
      job('a.second', 1),
      job('a.first', 1),
      job('a.third', 1),
    ]);

    expect(judgeCronBudget(run, EXPECTED).orderMismatches).toStrictEqual([
      { expected: 'a.first', actual: 'a.second' },
      { expected: 'a.second', actual: 'a.first' },
    ]);
  });

  test('期待にあるジョブが実際に無ければ、実際の欄を(なし)として並べる', () => {
    const run = runOf([job('a.first', 1), job('a.third', 1)]);

    expect(judgeCronBudget(run, EXPECTED).orderMismatches).toStrictEqual([
      { expected: 'a.second', actual: '(なし)' },
    ]);
  });

  test('期待に無いジョブが実際にあれば、期待の欄を(なし)として並べる', () => {
    const run = runOf([
      job('a.first', 1),
      job('a.second', 1),
      job('a.third', 1),
      job('z.extra', 1),
    ]);

    expect(judgeCronBudget(run, EXPECTED).orderMismatches).toStrictEqual([
      { expected: '(なし)', actual: 'z.extra' },
    ]);
  });

  test('欠落と追加があっても、共通のジョブの順序の食い違いは別に並べる', () => {
    const run = runOf([
      job('a.third', 1),
      job('z.extra', 1),
      job('a.first', 1),
    ]);

    expect(judgeCronBudget(run, EXPECTED).orderMismatches).toStrictEqual([
      { expected: 'a.second', actual: '(なし)' },
      { expected: '(なし)', actual: 'z.extra' },
      { expected: 'a.first', actual: 'a.third' },
      { expected: 'a.third', actual: 'a.first' },
    ]);
  });

  test('同じジョブが2回あれば、余分な実行を期待の欄を(なし)として並べる', () => {
    const run = runOf([
      job('a.first', 1),
      job('a.second', 1),
      job('a.first', 1),
    ]);

    expect(
      judgeCronBudget(run, ['a.first', 'a.second']).orderMismatches,
    ).toStrictEqual([{ expected: '(なし)', actual: 'a.first' }]);
  });

  test('期待の順序が空なら、実際の全てのジョブが期待に無いものとして並ぶ', () => {
    const run = runOf([job('a.first', 1)]);

    expect(judgeCronBudget(run, []).orderMismatches).toStrictEqual([
      { expected: '(なし)', actual: 'a.first' },
    ]);
  });
});

describe('judgeCronBudget の上限までの余裕', () => {
  test('合計が300,000msで10個のジョブなら、平均30,000msのジョブをあと10個足せる', () => {
    const jobs = Array.from({ length: 10 }, (_, index) =>
      job(`j.${String(index)}`, 30_000),
    );
    const judgement = judgeCronBudget(
      runOf(jobs),
      jobs.map(({ name }) => name),
    );

    expect(judgement.ceilingMarginMs).toBe(300_000);
    expect(judgement.headroomJobs).toBe(10);
  });

  test('余裕を平均の所要時間で割った商の整数部分を足せるジョブの数とする', () => {
    const run = runOf([job('a.first', 100_000), job('a.second', 100_001)]);

    const judgement = judgeCronBudget(run, ['a.first', 'a.second']);

    expect(judgement.ceilingMarginMs).toBe(399_999);
    expect(judgement.headroomJobs).toBe(3);
  });

  test('合計が上限ちょうどの600,000msなら余裕は0で、足せるジョブは0個である', () => {
    const judgement = judgeCronBudget(runWithTotal(600_000), [
      'a.first',
      'a.second',
    ]);

    expect(judgement.ceilingMarginMs).toBe(0);
    expect(judgement.headroomJobs).toBe(0);
  });

  test('上限を超えた合計の余裕は負で、足せるジョブは0個である', () => {
    const judgement = judgeCronBudget(runWithTotal(600_001), [
      'a.first',
      'a.second',
    ]);

    expect(judgement.ceilingMarginMs).toBe(-1);
    expect(judgement.headroomJobs).toBe(0);
  });

  test('合計が900,000msならCron Triggersの上限までの余裕は0で、900,001msなら負になる', () => {
    const atLimit = judgeCronBudget(runWithTotal(900_000), [
      'a.first',
      'a.second',
    ]);
    const overLimit = judgeCronBudget(runWithTotal(900_001), [
      'a.first',
      'a.second',
    ]);

    expect(atLimit.platformMarginMs).toBe(0);
    expect(atLimit.headroomJobs).toBe(0);
    expect(overLimit.platformMarginMs).toBe(-1);
  });

  test('合計が300,000msならCron Triggersの上限までの余裕は600,000msである', () => {
    const judgement = judgeCronBudget(runWithTotal(300_000), [
      'a.first',
      'a.second',
    ]);

    expect(judgement.platformMarginMs).toBe(600_000);
  });

  test('全てのジョブが0msでも平均を1msとして数え、足せるジョブの数は有限になる', () => {
    const judgement = judgeCronBudget(runOf([job('a.first', 0)]), ['a.first']);

    expect(judgement.headroomJobs).toBe(600_000);
  });

  test('ジョブが無い要約の足せるジョブの数は0である', () => {
    const judgement = judgeCronBudget(runOf([]), []);

    expect(judgement.totalMs).toBe(0);
    expect(judgement.headroomJobs).toBe(0);
  });
});

describe('judgeCronBudget の参考の値', () => {
  test('期待の順序を渡さなければ判定を参考とし、目安・順序・余裕の判定をしない', () => {
    const run = runOf([job('a.second', 700_000), job('a.first', 31_000)], {
      cron: '45 7 * * *',
    });

    const judgement = judgeCronBudget(run, undefined);

    expect(judgement.verdict).toBe('reference');
    expect(judgement.totalMs).toBe(731_000);
    expect(judgement.slowJobs).toStrictEqual([]);
    expect(judgement.orderMismatches).toStrictEqual([]);
    expect(judgement.headroomJobs).toBe(0);
  });

  test('参考の値でも失敗したジョブと要約との差は並べる', () => {
    const run = runOf([job('a.first', 10, 'failed')], {
      cron: '45 7 * * *',
      totalDurationMs: 25,
    });

    const judgement = judgeCronBudget(run, undefined);

    expect(judgement.failedJobs).toStrictEqual(['a.first']);
    expect(judgement.totalMismatchMs).toBe(15);
  });
});

describe('judgeCronBudgetRuns', () => {
  const dailyRun = (time: string, jobs: readonly Job[]) =>
    runOf(jobs, { time, cron: DAILY_BATCH_CRON });
  const otherRun = (time: string, cron: string) =>
    runOf([job('m.settle', 500_000)], { time, cron });

  test('4:21の起動だけ判定し、他の起動の要約は参考の値にする', () => {
    const judgements = judgeCronBudgetRuns(
      [
        otherRun('2026-11-24T07:40:00.000Z', '40 7 * * *'),
        dailyRun('2026-11-24T12:21:00.000Z', [job('a.first', 10)]),
      ],
      ['a.first'],
    );

    expect(judgements.map(({ verdict }) => verdict)).toStrictEqual([
      'reference',
      'within-budget',
    ]);
  });

  test('起動の時刻の昇順に並べ替える', () => {
    const judgements = judgeCronBudgetRuns(
      [
        dailyRun('2026-11-25T12:21:00.000Z', [job('a.first', 10)]),
        dailyRun('2026-11-24T12:21:00.000Z', [job('a.first', 10)]),
      ],
      ['a.first'],
    );

    expect(judgements.map(({ run }) => run.time)).toStrictEqual([
      '2026-11-24T12:21:00.000Z',
      '2026-11-25T12:21:00.000Z',
    ]);
  });

  test('同じ時刻と式の要約が重なっていれば1つにまとめる', () => {
    const run = dailyRun('2026-11-24T12:21:00.000Z', [job('a.first', 10)]);

    const judgements = judgeCronBudgetRuns([run, { ...run }], ['a.first']);

    expect(judgements).toHaveLength(1);
  });

  test('同じ時刻でも式が違う要約は別の起動として残す', () => {
    const time = '2026-11-24T12:21:00.000Z';

    const judgements = judgeCronBudgetRuns(
      [dailyRun(time, [job('a.first', 10)]), otherRun(time, '21 0 * * *')],
      ['a.first'],
    );

    expect(judgements).toHaveLength(2);
  });

  test('要約が無ければ判定も無い', () => {
    expect(judgeCronBudgetRuns([], ['a.first'])).toStrictEqual([]);
  });
});

describe('cronBudgetFailures', () => {
  const judged = (jobs: readonly Job[], order: readonly string[]) =>
    judgeCronBudget(runOf(jobs), order);

  test('予算内で失敗・目安超過・順序の食い違いが全て無ければ失敗は無い', () => {
    const judgements = [judged([job('a.first', 30_000)], ['a.first'])];

    expect(cronBudgetFailures(judgements)).toStrictEqual([]);
  });

  test('4:21の起動が1つも無ければ、判定できなかったことを失敗とする', () => {
    const reference = judgeCronBudget(
      runOf([job('a.first', 1)], { cron: '45 7 * * *' }),
      undefined,
    );

    expect(cronBudgetFailures([reference])).toStrictEqual([
      '4:21の起動の要約の行が見つかりませんでした',
    ]);
    expect(cronBudgetFailures([])).toHaveLength(1);
  });

  test('予算を超えれば予算の超過を失敗とする', () => {
    const failures = cronBudgetFailures([
      judged(totalJobs(300_001), totalNames(300_001)),
    ]);

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('予算');
    expect(failures[0]).toContain('300,001');
  });

  test('上限を超えれば上限の超過を失敗とする', () => {
    const failures = cronBudgetFailures([
      judged([job('a.first', 600_001)], ['a.first']),
    ]);

    expect(failures.some((message) => message.includes('上限'))).toBe(true);
  });

  test('失敗したジョブ・目安を超えたジョブ・順序の食い違いをそれぞれ失敗とする', () => {
    const failures = cronBudgetFailures([
      judged(
        [job('a.second', 40_000, 'failed'), job('a.first', 1)],
        ['a.first', 'a.second'],
      ),
    ]);

    expect(failures.some((message) => message.includes('失敗したジョブ'))).toBe(
      true,
    );
    expect(failures.some((message) => message.includes('目安'))).toBe(true);
    expect(failures.some((message) => message.includes('順序'))).toBe(true);
  });

  test('参考の値の起動は失敗に数えない', () => {
    const reference = judgeCronBudget(
      runOf([job('m.settle', 900_000, 'failed')], { cron: '45 7 * * *' }),
      undefined,
    );
    const daily = judged([job('a.first', 1)], ['a.first']);

    expect(cronBudgetFailures([reference, daily])).toStrictEqual([]);
  });

  test('複数の4:21の起動のどれかが失敗なら、その起動の時刻を示して失敗とする', () => {
    const slow = judgeCronBudget(
      runOf(totalJobs(300_001), { time: '2026-11-25T12:21:00.000Z' }),
      totalNames(300_001),
    );
    const ok = judged([job('a.first', 1)], ['a.first']);

    const failures = cronBudgetFailures([ok, slow]);

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain('2026-11-25T12:21:00.000Z');
  });
});

describe('renderCronBudgetMarkdown', () => {
  const render = (
    runs: readonly ScheduledRunSummary[],
    order: readonly string[] = ['a.first', 'a.second'],
  ): string => renderCronBudgetMarkdown(judgeCronBudgetRuns(runs, order));

  test('基準の値と4:21の起動の判定の行を表にする', () => {
    const markdown = render([
      runOf([job('a.first', 200_000), job('a.second', 100_001)]),
    ]);

    expect(markdown).toContain('予算300,000ms');
    expect(markdown).toContain('上限600,000ms');
    expect(markdown).toContain('目安30,000ms');
    expect(markdown).toContain('900,000ms');
    expect(markdown).toContain('2026-11-24T12:21:30.000Z');
    expect(markdown).toContain('300,001');
    expect(markdown).toContain('予算超過');
    expect(markdown).toContain('| 判定 |');
  });

  test('ジョブごとの所要時間と結果と目安の超過を表にする', () => {
    const markdown = render([
      runOf([job('a.first', 30_001, 'failed'), job('a.second', 30_000)]),
    ]);

    expect(markdown).toMatch(/\| 1 \| a\.first \| 失敗 \| 30,001 \| 超過 \|/);
    expect(markdown).toMatch(/\| 2 \| a\.second \| 成功 \| 30,000 \| 以内 \|/);
  });

  test('順序の食い違いを期待と実際の組で示す', () => {
    const markdown = render([runOf([job('a.second', 1), job('a.first', 1)])]);

    expect(markdown).toContain('順序の食い違い');
    expect(markdown).toContain('期待 `a.first` に対して実際 `a.second`');
  });

  test('順序の食い違いが無ければ食い違いの一覧を出さない', () => {
    const markdown = render([runOf([job('a.first', 1), job('a.second', 1)])]);

    expect(markdown).not.toContain('期待 `');
  });

  test('上限までの余裕と足せるジョブの数と要約との差を並べる', () => {
    const jobs = Array.from({ length: 10 }, (_, index) =>
      job(`j.${String(index)}`, 30_000),
    );
    const markdown = renderCronBudgetMarkdown(
      judgeCronBudgetRuns(
        [runOf(jobs, { totalDurationMs: 300_007 })],
        jobs.map(({ name }) => name),
      ),
    );

    expect(markdown).toContain('| 300,000 | 予算内 | 7 | 300,000 | 10 |');
  });

  test('4:21以外の起動は参考の値の表に並べ、判定の表には入れない', () => {
    const markdown = render([
      runOf([job('a.first', 1), job('a.second', 1)]),
      runOf([job('m.settle', 12_345)], {
        time: '2026-11-24T07:40:00.000Z',
        cron: '40 7 * * *',
      }),
    ]);

    const [judgedPart, referencePart] = markdown.split('参考の値');
    expect(referencePart).toContain('2026-11-24T07:40:00.000Z');
    expect(referencePart).toContain('40 7 * * *');
    expect(referencePart).toContain('m.settle');
    expect(referencePart).toContain('12,345');
    expect(judgedPart).not.toContain('2026-11-24T07:40:00.000Z');
  });

  test('4:21の起動が無ければ、その旨を示す', () => {
    const markdown = render([
      runOf([job('m.settle', 1)], {
        time: '2026-11-24T07:40:00.000Z',
        cron: '40 7 * * *',
      }),
    ]);

    expect(markdown).toContain('4:21の起動の要約の行はありません');
  });

  test('参考の起動が無ければ参考の節を出さない', () => {
    const markdown = render([runOf([job('a.first', 1), job('a.second', 1)])]);

    expect(markdown).not.toContain('参考の値');
  });

  test('日本語と英数字の間に半角スペースを入れない', () => {
    const markdown = render([runOf([job('a.first', 1), job('a.second', 1)])]);

    expect(markdown).not.toMatch(/[ぁ-んァ-ヶ一-龠] [A-Za-z0-9]/);
    expect(markdown).not.toMatch(/[A-Za-z0-9] [ぁ-んァ-ヶ一-龠]/);
  });
});
