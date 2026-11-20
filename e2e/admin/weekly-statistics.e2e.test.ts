import {
  ADMIN_FLOW_TIMEOUT_MS,
  signInAsNewAdmin,
} from '../support/admin-bootstrap.ts';
import {
  businessDateOf,
  triggerScheduled,
} from '../support/scheduled-trigger.ts';
import { test } from './admin-test.ts';
import {
  expectInProgressWeekRow,
  statisticsWeekStartOf,
} from './weekly-statistics-steps.ts';

test.describe.configure({ timeout: ADMIN_FLOW_TIMEOUT_MS });

const WEEKLY_STATISTICS_TIME = '04:21';

// 集計中の今週の行は実行のたびに上書きされ、確定した週は書き換わらないため、後片付けをしない
test.describe('週ごとの統計(管理者側)', () => {
  test('4:21のジョブを動かすと、モデレーターのダッシュボードの統計のカードの表に今週の行が集計中として出る', async ({
    page,
  }) => {
    const businessDate = businessDateOf(new Date());
    await triggerScheduled({
      worker: 'api',
      businessDate,
      businessTime: WEEKLY_STATISTICS_TIME,
    });

    await signInAsNewAdmin(page, { role: 'moderator' });

    await expectInProgressWeekRow(page, statisticsWeekStartOf(businessDate));
  });
});
