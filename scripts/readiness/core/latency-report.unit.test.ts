import { describe, expect, test } from 'bun:test';

import {
  formatLatencyReport,
  joinBrowserSpansWithOperations,
  type LatencySample,
  percentile,
  summarizeLatency,
  type TraceSpanRow,
} from './latency-report.ts';

const OPTIONS = { thresholdMs: 300, minSamples: 200 } as const;

const samplesOf = (
  operation: string,
  durations: readonly number[],
): readonly LatencySample[] =>
  durations.map((durationMs) => ({ operation, durationMs }));

const sequence = (count: number): readonly number[] =>
  Array.from({ length: count }, (_, index) => index + 1);

const browser = (
  traceId: string,
  spanId: string,
  durationMs = 100,
): TraceSpanRow => ({ traceId, spanId, side: 'browser', durationMs });

const frontend = (
  traceId: string,
  spanId: string,
  parentSpanId: string,
): TraceSpanRow => ({
  traceId,
  spanId,
  parentSpanId,
  side: 'frontend',
  durationMs: 80,
});

const api = (
  traceId: string,
  spanId: string,
  parentSpanId: string,
  operation?: string,
): TraceSpanRow => ({
  traceId,
  spanId,
  parentSpanId,
  side: 'api',
  durationMs: 50,
  ...(operation === undefined ? {} : { operation }),
});

describe('percentile', () => {
  test('20件の95パーセンタイルは19番目の値になる', () => {
    expect(percentile(sequence(20), 95)).toBe(19);
  });

  test('200件の95パーセンタイルは190番目の値になる', () => {
    expect(percentile(sequence(200), 95)).toBe(190);
  });

  test('入力の並びに依らず昇順で順位を数える', () => {
    expect(percentile([5, 1, 4, 2, 3], 95)).toBe(5);
    expect(percentile([5, 1, 4, 2, 3], 50)).toBe(3);
  });

  test('1件だけならその値を返す', () => {
    expect(percentile([42], 95)).toBe(42);
  });

  test('0パーセンタイルは最小値、100パーセンタイルは最大値を返す', () => {
    expect(percentile([3, 1, 2], 0)).toBe(1);
    expect(percentile([3, 1, 2], 100)).toBe(3);
  });

  test('入力の配列を並べ替えない', () => {
    const values = [3, 1, 2];
    percentile(values, 95);
    expect(values).toEqual([3, 1, 2]);
  });

  test('空の配列は拒否する', () => {
    expect(() => percentile([], 95)).toThrow(RangeError);
  });

  test.each([-1, 101, Number.NaN])('範囲外の割合%pは拒否する', (p) => {
    expect(() => percentile([1], p)).toThrow(RangeError);
  });
});

describe('summarizeLatency', () => {
  test('標本が200件で95パーセンタイルが300msなら合格にする', () => {
    const durations = [
      ...Array<number>(190).fill(300),
      ...Array<number>(10).fill(900),
    ];
    const [result] = summarizeLatency(samplesOf('Q', durations), OPTIONS);
    expect(result).toEqual({
      operation: 'Q',
      samples: 200,
      p95Ms: 300,
      verdict: 'pass',
    });
  });

  test('95パーセンタイルが301msなら不合格にする', () => {
    const durations = [
      ...Array<number>(190).fill(301),
      ...Array<number>(10).fill(900),
    ];
    const [result] = summarizeLatency(samplesOf('Q', durations), OPTIONS);
    expect(result).toMatchObject({ p95Ms: 301, verdict: 'fail' });
  });

  test('標本が199件なら閾値を超えていなくても標本不足にする', () => {
    const [result] = summarizeLatency(
      samplesOf('Q', Array<number>(199).fill(10)),
      OPTIONS,
    );
    expect(result).toMatchObject({ samples: 199, verdict: 'insufficient' });
  });

  test('標本不足でも閾値を超えているなら標本不足として返す', () => {
    const [result] = summarizeLatency(samplesOf('Q', [900, 900]), OPTIONS);
    expect(result).toMatchObject({ p95Ms: 900, verdict: 'insufficient' });
  });

  test('最小の標本数と閾値を引数で変えられる', () => {
    const [result] = summarizeLatency(samplesOf('Q', sequence(20)), {
      thresholdMs: 18,
      minSamples: 20,
    });
    expect(result).toMatchObject({ p95Ms: 19, verdict: 'fail' });
  });

  test('操作ごとに分けて、操作名の昇順で返す', () => {
    const results = summarizeLatency(
      [...samplesOf('B', [10]), ...samplesOf('A', [20, 30])],
      { thresholdMs: 300, minSamples: 1 },
    );
    expect(
      results.map(({ operation, samples }) => [operation, samples]),
    ).toEqual([
      ['A', 2],
      ['B', 1],
    ]);
  });

  test('標本が無ければ空の配列を返す', () => {
    expect(summarizeLatency([], OPTIONS)).toEqual([]);
  });

  test('操作を指定すると、その操作だけを指定の順に返す', () => {
    const results = summarizeLatency(
      [
        ...samplesOf('A', [10]),
        ...samplesOf('B', [10]),
        ...samplesOf('C', [10]),
      ],
      { thresholdMs: 300, minSamples: 1, operations: ['C', 'A'] },
    );
    expect(results.map(({ operation }) => operation)).toEqual(['C', 'A']);
  });

  test('指定した操作に標本が無ければ標本不足で返す', () => {
    const results = summarizeLatency(samplesOf('A', [10]), {
      thresholdMs: 300,
      minSamples: 1,
      operations: ['A', 'Missing'],
    });
    expect(results[1]).toEqual({
      operation: 'Missing',
      samples: 0,
      p95Ms: Number.NaN,
      verdict: 'insufficient',
    });
  });

  test('指定した操作の重複は1行にまとめる', () => {
    const results = summarizeLatency([], {
      thresholdMs: 300,
      minSamples: 1,
      operations: ['A', 'A'],
    });
    expect(results).toHaveLength(1);
  });

  test('大量の標本でも集計できる', () => {
    const [result] = summarizeLatency(
      samplesOf('Q', sequence(20_000)),
      OPTIONS,
    );
    expect(result).toMatchObject({ samples: 20_000, p95Ms: 19_000 });
  });
});

describe('joinBrowserSpansWithOperations', () => {
  test('ブラウザのスパンにAPIサーバーの操作名を付ける', () => {
    const { samples, unmatchedBrowserSpans } = joinBrowserSpansWithOperations([
      browser('t1', 'b1', 120),
      api('t1', 'a1', 'b1', 'HomeQuery'),
    ]);
    expect(samples).toEqual([{ operation: 'HomeQuery', durationMs: 120 }]);
    expect(unmatchedBrowserSpans).toBe(0);
  });

  test('フロントエンドサーバーの中継のスパンを間に挟んでも結べる', () => {
    const { samples, unmatchedBrowserSpans } = joinBrowserSpansWithOperations([
      browser('t1', 'b1', 120),
      frontend('t1', 'f1', 'b1'),
      api('t1', 'a1', 'f1', 'HomeQuery'),
    ]);
    expect(samples).toEqual([{ operation: 'HomeQuery', durationMs: 120 }]);
    expect(unmatchedBrowserSpans).toBe(0);
  });

  test('行の並びがばらばらでも結べる', () => {
    const { samples } = joinBrowserSpansWithOperations([
      api('t1', 'a1', 'f1', 'HomeQuery'),
      frontend('t1', 'f1', 'b1'),
      browser('t1', 'b1', 120),
    ]);
    expect(samples).toEqual([{ operation: 'HomeQuery', durationMs: 120 }]);
  });

  test('APIサーバーの実行のスパンが子として続いても二重に数えない', () => {
    const { samples } = joinBrowserSpansWithOperations([
      browser('t1', 'b1', 120),
      frontend('t1', 'f1', 'b1'),
      api('t1', 'a1', 'f1', 'HomeQuery'),
      api('t1', 'a2', 'a1', 'HomeQuery'),
    ]);
    expect(samples).toEqual([{ operation: 'HomeQuery', durationMs: 120 }]);
  });

  test('1つのトレースに複数の要求があってもスパンごとに結ぶ', () => {
    const { samples, unmatchedBrowserSpans } = joinBrowserSpansWithOperations([
      browser('t1', 'b1', 100),
      browser('t1', 'b2', 200),
      frontend('t1', 'f1', 'b1'),
      frontend('t1', 'f2', 'b2'),
      api('t1', 'a1', 'f1', 'HomeQuery'),
      api('t1', 'a2', 'f2', 'ProductQuery'),
    ]);
    expect(samples).toEqual([
      { operation: 'HomeQuery', durationMs: 100 },
      { operation: 'ProductQuery', durationMs: 200 },
    ]);
    expect(unmatchedBrowserSpans).toBe(0);
  });

  test('スパンのIDが同じでもトレースが違えば別のスパンとして扱う', () => {
    const { samples, unmatchedBrowserSpans } = joinBrowserSpansWithOperations([
      browser('t1', 'b1', 100),
      browser('t2', 'b1', 200),
      api('t2', 'a1', 'b1', 'ProductQuery'),
    ]);
    expect(samples).toEqual([{ operation: 'ProductQuery', durationMs: 200 }]);
    expect(unmatchedBrowserSpans).toBe(1);
  });

  test('操作名の無いAPIサーバーのスパンしか持たないトレースは結べなかったスパンとして数える', () => {
    const { samples, unmatchedBrowserSpans } = joinBrowserSpansWithOperations([
      browser('t1', 'b1'),
      frontend('t1', 'f1', 'b1'),
      api('t1', 'a1', 'f1'),
    ]);
    expect(samples).toEqual([]);
    expect(unmatchedBrowserSpans).toBe(1);
  });

  test('APIサーバーのスパンが無いトレースのブラウザのスパンは結べなかったスパンとして数える', () => {
    const { samples, unmatchedBrowserSpans } = joinBrowserSpansWithOperations([
      browser('t1', 'b1'),
      browser('t2', 'b2'),
      api('t2', 'a2', 'b2', 'HomeQuery'),
    ]);
    expect(samples).toHaveLength(1);
    expect(unmatchedBrowserSpans).toBe(1);
  });

  test('ブラウザのスパンにたどり着かないAPIサーバーのスパンは標本にしない', () => {
    const { samples, unmatchedBrowserSpans } = joinBrowserSpansWithOperations([
      frontend('t1', 'f1', 'missing'),
      api('t1', 'a1', 'f1', 'HomeQuery'),
    ]);
    expect(samples).toEqual([]);
    expect(unmatchedBrowserSpans).toBe(0);
  });

  test('親の連なりが循環していても止まる', () => {
    const { samples, unmatchedBrowserSpans } = joinBrowserSpansWithOperations([
      browser('t1', 'b1'),
      frontend('t1', 'f1', 'f2'),
      frontend('t1', 'f2', 'f1'),
      api('t1', 'a1', 'f1', 'HomeQuery'),
    ]);
    expect(samples).toEqual([]);
    expect(unmatchedBrowserSpans).toBe(1);
  });

  test('1つのブラウザのスパンに複数の操作名が着いたら最初の操作名だけを使う', () => {
    const { samples } = joinBrowserSpansWithOperations([
      browser('t1', 'b1', 100),
      api('t1', 'a1', 'b1', 'First'),
      api('t1', 'a2', 'b1', 'Second'),
    ]);
    expect(samples).toEqual([{ operation: 'First', durationMs: 100 }]);
  });

  test('親を持たないAPIサーバーのスパンは結べない', () => {
    const { samples } = joinBrowserSpansWithOperations([
      browser('t1', 'b1'),
      {
        traceId: 't1',
        spanId: 'a1',
        side: 'api',
        durationMs: 10,
        operation: 'HomeQuery',
      },
    ]);
    expect(samples).toEqual([]);
  });

  test('行が無ければ空を返す', () => {
    expect(joinBrowserSpansWithOperations([])).toEqual({
      samples: [],
      unmatchedBrowserSpans: 0,
    });
  });
});

describe('formatLatencyReport', () => {
  const results = summarizeLatency(
    [...samplesOf('A', [10, 20]), ...samplesOf('B', [400, 500])],
    { thresholdMs: 300, minSamples: 2 },
  );

  test('操作ごとの標本数・95パーセンタイル・判定をマークダウンの表にする', () => {
    const text = formatLatencyReport(results, {
      thresholdMs: 300,
      minSamples: 2,
      unmatchedBrowserSpans: 0,
    });
    expect(text).toContain('| 操作 | 標本数 | 95パーセンタイル(ms) | 判定 |');
    expect(text).toContain('| A | 2 | 20 | 合格 |');
    expect(text).toContain('| B | 2 | 500 | 不合格 |');
  });

  test('標本不足の行は95パーセンタイルを省略した値で表す', () => {
    const text = formatLatencyReport(
      summarizeLatency([], {
        thresholdMs: 300,
        minSamples: 200,
        operations: ['Missing'],
      }),
      { thresholdMs: 300, minSamples: 200, unmatchedBrowserSpans: 0 },
    );
    expect(text).toContain('| Missing | 0 | - | 標本不足 |');
  });

  test('閾値・最小の標本数・結べなかったスパンの数を併記する', () => {
    const text = formatLatencyReport(results, {
      thresholdMs: 300,
      minSamples: 2,
      unmatchedBrowserSpans: 7,
    });
    expect(text).toContain('閾値300ms');
    expect(text).toContain('最小の標本2件');
    expect(text).toContain('結べなかったブラウザのスパン: 7件');
  });

  test('操作が無ければ判定できる標本が無いことを示す', () => {
    const text = formatLatencyReport([], {
      thresholdMs: 300,
      minSamples: 200,
      unmatchedBrowserSpans: 0,
    });
    expect(text).toContain('判定できる標本がありません');
  });

  test('操作名の縦線は表を壊さないようエスケープする', () => {
    const text = formatLatencyReport(
      summarizeLatency(samplesOf('a|b', [1]), {
        thresholdMs: 300,
        minSamples: 1,
      }),
      { thresholdMs: 300, minSamples: 1, unmatchedBrowserSpans: 0 },
    );
    expect(text).toContain('| a\\|b | 1 | 1 | 合格 |');
  });
});
