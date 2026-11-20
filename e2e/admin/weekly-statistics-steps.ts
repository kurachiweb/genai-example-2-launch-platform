import { expect, type Locator, type Page } from '@playwright/test';

import {
  STATISTICS_IN_PROGRESS_LABEL,
  STATISTICS_TABLE_CAPTION,
  WEEKLY_STATISTICS_TITLE,
} from '../../apps/admin/src/components/moderation/statistics/statistics-messages.ts';
import {
  businessWeekOf,
  parseBusinessDate,
} from '../../apps/backend-lib/core/time/business-time.ts';
import { formatBusinessDateWithWeekdayLabel } from '../../apps/common-lib/time/business-date-label.ts';

// 統計の週は月曜日に始まる業務日付の週で、4:21のジョブは起動の業務日付が属する週を今週として集計する
export const statisticsWeekStartOf = (businessDate: string): string =>
  businessWeekOf(parseBusinessDate(businessDate)).start;

export const weeklyStatisticsCard = (page: Page): Locator =>
  page
    .getByRole('main')
    .getByRole('region', { name: WEEKLY_STATISTICS_TITLE, exact: true });

export const weeklyStatisticsRowOf = (
  card: Locator,
  weekStart: string,
): Locator =>
  card
    .getByRole('table', { name: STATISTICS_TABLE_CAPTION, exact: true })
    .getByRole('row')
    .filter({ hasText: formatBusinessDateWithWeekdayLabel(weekStart) });

export async function expectInProgressWeekRow(
  page: Page,
  weekStart: string,
): Promise<void> {
  const row = weeklyStatisticsRowOf(weeklyStatisticsCard(page), weekStart);
  await expect(row).toHaveCount(1);
  await expect(row.locator('time')).toHaveAttribute('datetime', weekStart);
  await expect(row).toContainText(STATISTICS_IN_PROGRESS_LABEL);
}
