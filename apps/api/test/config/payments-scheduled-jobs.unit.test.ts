import { describe, expect, test } from 'bun:test';

import { createCronRegistry } from '../../lib/core/scheduling/cron-registry.ts';
import { toUtcCronExpression } from '../../lib/core/time/business-time.ts';
import { CHECKOUT_RECONCILIATION_JOB_DEFINITION } from '../../src/application/payments/jobs/checkout-reconciliation-job.ts';
import { PAYMENT_HISTORY_RETENTION_JOB_DEFINITION } from '../../src/application/payments/jobs/payment-history-retention-job.ts';
import { PENDING_CHECKOUT_SWEEP_JOB_DEFINITION } from '../../src/application/payments/jobs/pending-checkout-sweep-job.ts';
import { SCHEDULED_JOBS } from '../../src/composition/scheduled-jobs.ts';

const PAYMENTS_JOBS = [
  CHECKOUT_RECONCILIATION_JOB_DEFINITION,
  PENDING_CHECKOUT_SWEEP_JOB_DEFINITION,
  PAYMENT_HISTORY_RETENTION_JOB_DEFINITION,
];

// 定期実行の一覧へ加えた後も同じ検査になるよう、決済のジョブを除いた他のドメインのジョブと合わせる
const OTHER_JOBS = SCHEDULED_JOBS.filter(
  ({ name }) => !name.startsWith('payments.'),
);

describe('決済のジョブの定義と他のドメインのジョブの定義の合成', () => {
  test('ジョブの定義の検証(名前・時刻・同じ時刻の順序の重複の拒否)を通る', () => {
    expect(() =>
      createCronRegistry([...OTHER_JOBS, ...PAYMENTS_JOBS]),
    ).not.toThrow();
  });

  test('23:40の起動では突合のジョブがorder 10で最初に動く', () => {
    const [first] = createCronRegistry([
      ...OTHER_JOBS,
      ...PAYMENTS_JOBS,
    ]).jobsFor(toUtcCronExpression({ hour: 23, minute: 40 }));

    expect(first).toBe(CHECKOUT_RECONCILIATION_JOB_DEFINITION);
  });

  test('4:21の起動では日次の確認・7年の削除が問い合わせのジョブ(300)の後、メディアのジョブ(810)の前に順に動く', () => {
    const orders = createCronRegistry([...OTHER_JOBS, ...PAYMENTS_JOBS])
      .jobsFor(toUtcCronExpression({ hour: 4, minute: 21 }))
      .map(({ name, order }) => ({ name, order }));
    const sweepIndex = orders.findIndex(
      ({ name }) => name === 'payments.pending-checkout-sweep',
    );

    expect(orders.slice(sweepIndex - 1, sweepIndex + 3)).toEqual([
      { name: 'inquiry-chat.guest-inquiry-retention', order: 300 },
      { name: 'payments.pending-checkout-sweep', order: 400 },
      { name: 'payments.history-retention', order: 410 },
      { name: 'media-pipeline.expired-file-erasure', order: 810 },
    ]);
  });
});
