import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { annotateSkippedCheck } from '../../support/system-status-page.ts';
import {
  browsePathsOf,
  parseTrafficSamples,
  resolveBrowseTraffic,
} from './browse-traffic-plan.ts';

// 指定の時間のほかに、最後の周回の完了と後片付けを待つ余裕
const TIMEOUT_MARGIN_MS = 120_000;

const OK_STATUS = 200;

interface VisitFailure {
  readonly path: string;
  readonly detail: string;
}

// 状態を変える操作は行わず、未ログインで開いて読むだけにする。検証の環境の4:21の要約と画面の応答時間の標本を増やすためのテストで、閲覧の成否はここで数える
test.describe('未ログインの閲覧の繰り返し', { tag: '@traffic' }, () => {
  test('主要6ページと本文が上限のヘルプ記事の詳細を、指定の時間繰り返して開く', async ({
    context,
  }) => {
    const traffic = resolveBrowseTraffic(process.env);
    if (traffic.kind === 'skip') {
      annotateSkippedCheck(traffic.reason);
      return;
    }
    test.setTimeout(traffic.durationMs + TIMEOUT_MARGIN_MS);
    const samples = parseTrafficSamples(
      JSON.parse(readFileSync(traffic.manifestPath, 'utf8')),
    );
    const failures: VisitFailure[] = [];
    let visits = 0;
    let round = 0;
    const deadline = Date.now() + traffic.durationMs;

    do {
      // 同じタブで本文が上限のページを繰り返すとタブが異常終了することがあるため、周回ごとに開き直す
      const page = await context.newPage();
      try {
        for (const path of browsePathsOf(samples, round)) {
          visits += 1;
          const response = await page.goto(path);
          const status = response?.status();
          if (status !== OK_STATUS) {
            failures.push({ path, detail: `状態コード${String(status)}` });
            continue;
          }
          if (!(await page.getByRole('main').first().isVisible())) {
            failures.push({ path, detail: 'mainが表示されていない' });
          }
        }
      } finally {
        await page.close();
      }
      round += 1;
    } while (Date.now() < deadline);

    test.info().annotations.push({
      type: '閲覧の繰り返し',
      description: `${String(round)}周・${String(visits)}回の閲覧・失敗${String(failures.length)}件`,
    });
    expect(failures).toEqual([]);
  });
});
