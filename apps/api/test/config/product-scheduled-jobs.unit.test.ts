import { describe, expect, test } from 'bun:test';

import { createCronRegistry } from '../../lib/core/scheduling/cron-registry.ts';
import { toUtcCronExpression } from '../../lib/core/time/business-time.ts';
import { PRODUCT_LIFECYCLE_REDISPATCH_JOB_DEFINITION } from '../../src/application/product/jobs/product-lifecycle-redispatch-job.ts';
import { PRODUCT_PURGE_ORCHESTRATOR_JOB_DEFINITION } from '../../src/application/product/jobs/product-purge-orchestrator-job.ts';
import { SCHEDULED_JOBS } from '../../src/composition/scheduled-jobs.ts';

const DAILY_CRON = toUtcCronExpression({ hour: 4, minute: 21 });

describe('プロダクトのジョブの定期実行の一覧への登録', () => {
  test('物理削除の開始と送り直しの2つの定義を、そのまま定期実行の一覧に載せる', () => {
    expect(
      SCHEDULED_JOBS.filter(({ name }) => name.startsWith('product-launch.')),
    ).toEqual([
      PRODUCT_PURGE_ORCHESTRATOR_JOB_DEFINITION,
      PRODUCT_LIFECYCLE_REDISPATCH_JOB_DEFINITION,
    ]);
  });

  test('定期実行の一覧はジョブの定義の検証(名前・時刻・同じ時刻の順序の重複の拒否)を通る', () => {
    expect(() => createCronRegistry(SCHEDULED_JOBS)).not.toThrow();
  });

  test('4:21の起動では、メールの後始末(900)の直後に物理削除の開始・送り直しの順に動き、検索のキーワードの再抽出(2300)より前に終える', () => {
    const orders = createCronRegistry(SCHEDULED_JOBS)
      .jobsFor(DAILY_CRON)
      .map(({ name, order }) => ({ name, order }));
    const purgeIndex = orders.findIndex(
      ({ name }) => name === 'product-launch.purge-orchestrator',
    );

    expect(DAILY_CRON).toBe('21 12 * * *');
    expect(orders.slice(purgeIndex - 1, purgeIndex + 2)).toEqual([
      { name: 'email-delivery.cleanup', order: 900 },
      { name: 'product-launch.purge-orchestrator', order: 1000 },
      { name: 'product-launch.lifecycle-redispatch', order: 1010 },
    ]);
    expect(
      orders.findIndex(
        ({ name }) => name === 'content-processing.keyword-reextraction',
      ),
    ).toBeGreaterThan(purgeIndex + 1);
  });

  test('本機能のジョブの順は、割り当てられた1000番台の帯に収まる', () => {
    for (const { order } of [
      PRODUCT_PURGE_ORCHESTRATOR_JOB_DEFINITION,
      PRODUCT_LIFECYCLE_REDISPATCH_JOB_DEFINITION,
    ]) {
      expect(order).toBeGreaterThanOrEqual(1000);
      expect(order).toBeLessThan(1100);
    }
  });
});
