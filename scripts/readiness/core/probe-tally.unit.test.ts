import { describe, expect, test } from 'bun:test';

import {
  formatProbeReport,
  isSuccessfulStatus,
  type ProbeObservation,
  probeSucceeded,
  tallyProbe,
} from './probe-tally.ts';

const observe = (
  target: string,
  status: ProbeObservation['status'],
  durationMs = 10,
  at = '2026-11-23T00:00:00.000Z',
): ProbeObservation => ({ target, at, status, durationMs });

describe('isSuccessfulStatus', () => {
  test.each([200, 204, 299, 300, 302, 399])(
    '状態コード%dを成功として扱う',
    (status) => {
      expect(isSuccessfulStatus(status)).toBe(true);
    },
  );

  test.each([199, 400, 404, 500, 502, 503, 599])(
    '状態コード%dを失敗として扱う',
    (status) => {
      expect(isSuccessfulStatus(status)).toBe(false);
    },
  );

  test.each(['network-error', 'timeout'] as const)(
    '%sを失敗として扱う',
    (status) => {
      expect(isSuccessfulStatus(status)).toBe(false);
    },
  );
});

describe('tallyProbe', () => {
  test('観測が無ければ空の一覧を返す', () => {
    expect(tallyProbe([])).toEqual([]);
  });

  test('対象ごとに件数・失敗・最大の応答時間を数え、対象は最初に現れた順に並べる', () => {
    const failed = observe('api', 503, 40, '2026-11-23T00:00:01.000Z');

    const summaries = tallyProbe([
      observe('client', 200, 30),
      observe('api', 200, 20),
      observe('client', 302, 90),
      failed,
      observe('client', 200, 10),
    ]);

    expect(summaries).toEqual([
      { target: 'client', total: 3, failures: [], maxDurationMs: 90 },
      { target: 'api', total: 2, failures: [failed], maxDurationMs: 40 },
    ]);
  });

  test('2xx・3xx以外の応答・通信の失敗・時間切れを失敗に数え、発生の順に保つ', () => {
    const notFound = observe('admin', 404);
    const refused = observe('admin', 'network-error');
    const slow = observe('admin', 'timeout', 10_000);

    const [summary] = tallyProbe([
      observe('admin', 200),
      notFound,
      refused,
      slow,
      observe('admin', 301),
    ]);

    expect(summary).toEqual({
      target: 'admin',
      total: 5,
      failures: [notFound, refused, slow],
      maxDurationMs: 10_000,
    });
  });

  test('失敗した応答の時間も最大の応答時間に含める', () => {
    const [summary] = tallyProbe([
      observe('event', 200, 50),
      observe('event', 500, 700),
    ]);

    expect(summary?.maxDurationMs).toBe(700);
  });

  test('入力の観測の配列を書き換えない', () => {
    const observations = [observe('api', 500), observe('api', 200)];
    const snapshot = structuredClone(observations);

    tallyProbe(observations);

    expect(observations).toEqual(snapshot);
  });
});

describe('probeSucceeded', () => {
  test('全対象で失敗が0件なら成功とする', () => {
    const summaries = tallyProbe([
      observe('client', 200),
      observe('admin', 302),
      observe('api', 200),
      observe('event', 204),
    ]);

    expect(probeSucceeded(summaries)).toBe(true);
  });

  test('1つの対象でも失敗があれば失敗とする', () => {
    const summaries = tallyProbe([
      observe('client', 200),
      observe('admin', 200),
      observe('api', 200),
      observe('event', 'timeout', 10_000),
    ]);

    expect(probeSucceeded(summaries)).toBe(false);
  });

  test('観測が1件も無いときは成功とみなさない', () => {
    expect(probeSucceeded([])).toBe(false);
  });
});

describe('formatProbeReport', () => {
  test('対象ごとの件数・失敗・最大の応答時間と、成功の判定を表示する', () => {
    const report = formatProbeReport(
      tallyProbe([
        observe('利用者側 http://client.example/', 200, 120),
        observe('利用者側 http://client.example/', 200, 80),
        observe('APIサーバー http://api.example/health', 200, 15),
      ]),
    );

    expect(report).toContain(
      '- 利用者側 http://client.example/: 2件、失敗0件、最大の応答時間120ms',
    );
    expect(report).toContain(
      '- APIサーバー http://api.example/health: 1件、失敗0件、最大の応答時間15ms',
    );
    expect(report).toContain('判定: 成功(全対象で失敗0件)');
    expect(report).not.toContain('失敗の内訳');
  });

  test('失敗があれば内訳を時刻と状態とともに表示し、失敗の判定にする', () => {
    const report = formatProbeReport(
      tallyProbe([
        observe('api', 200),
        observe('api', 503, 250, '2026-11-23T00:00:05.000Z'),
        observe('api', 'timeout', 10_000, '2026-11-23T00:00:06.000Z'),
        observe('api', 'network-error', 3, '2026-11-23T00:00:07.000Z'),
      ]),
    );

    expect(report).toContain('- api: 4件、失敗3件、最大の応答時間10000ms');
    expect(report).toContain('失敗の内訳');
    expect(report).toContain('2026-11-23T00:00:05.000Z 503(250ms)');
    expect(report).toContain('2026-11-23T00:00:06.000Z 時間切れ(10000ms)');
    expect(report).toContain('2026-11-23T00:00:07.000Z 通信の失敗(3ms)');
    expect(report).toContain('判定: 失敗(失敗した対象があります)');
  });

  test('失敗が多い対象の内訳は先頭の20件に絞り、残りの件数を示す', () => {
    const observations = Array.from({ length: 25 }, (_, index) =>
      observe(
        'api',
        500,
        1,
        `2026-11-23T00:00:${String(index).padStart(2, '0')}.000Z`,
      ),
    );

    const report = formatProbeReport(tallyProbe(observations));

    expect(report).toContain('2026-11-23T00:00:19.000Z 500(1ms)');
    expect(report).not.toContain('2026-11-23T00:00:20.000Z');
    expect(report).toContain('ほか5件');
  });

  test('観測が無いときは対象が無いことと失敗の判定を表示する', () => {
    const report = formatProbeReport([]);

    expect(report).toContain('観測した応答がありません');
    expect(report).toContain('判定: 失敗');
  });
});
