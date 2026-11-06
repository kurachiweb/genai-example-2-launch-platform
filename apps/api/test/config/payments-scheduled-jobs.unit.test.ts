import { describe, expect, test } from 'bun:test';

import { createCronRegistry } from '../../lib/core/scheduling/cron-registry.ts';
import { toUtcCronExpression } from '../../lib/core/time/business-time.ts';
import { CHECKOUT_RECONCILIATION_JOB_DEFINITION } from '../../src/application/payments/jobs/checkout-reconciliation-job.ts';
import { PAYMENT_HISTORY_RETENTION_JOB_DEFINITION } from '../../src/application/payments/jobs/payment-history-retention-job.ts';
import { PENDING_CHECKOUT_SWEEP_JOB_DEFINITION } from '../../src/application/payments/jobs/pending-checkout-sweep-job.ts';
import { SCHEDULED_JOBS } from '../../src/composition/scheduled-jobs.ts';

describe('決済のジョブの定期実行の一覧への登録', () => {
  test('突合・日次の確認・7年の削除の3つの定義を、そのまま定期実行の一覧に載せる', () => {
    const paymentsJobs = SCHEDULED_JOBS.filter(({ name }) =>
      name.startsWith('payments.'),
    );

    expect(paymentsJobs).toHaveLength(3);
    expect(paymentsJobs).toContain(CHECKOUT_RECONCILIATION_JOB_DEFINITION);
    expect(paymentsJobs).toContain(PENDING_CHECKOUT_SWEEP_JOB_DEFINITION);
    expect(paymentsJobs).toContain(PAYMENT_HISTORY_RETENTION_JOB_DEFINITION);
  });

  test('定期実行の一覧はジョブの定義の検証(名前・時刻・同じ時刻の順序の重複の拒否)を通る', () => {
    expect(() => createCronRegistry(SCHEDULED_JOBS)).not.toThrow();
  });

  test('23:40の起動(40 7 * * *)では突合のジョブがorder 10で最初に動く', () => {
    const cron = toUtcCronExpression({ hour: 23, minute: 40 });
    const [first] = createCronRegistry(SCHEDULED_JOBS).jobsFor(cron);

    expect(cron).toBe('40 7 * * *');
    expect(first).toBe(CHECKOUT_RECONCILIATION_JOB_DEFINITION);
  });

  test('4:21の起動では日次の確認・7年の削除が問い合わせのジョブ(300)の後、メディアのジョブ(810)の前に順に動く', () => {
    const orders = createCronRegistry(SCHEDULED_JOBS)
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
