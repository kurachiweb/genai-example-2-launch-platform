import { describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles.css';
import type { AuditLogSearch } from './audit-log-search.ts';
import { AuditLogFilters } from './audit-log-filters.tsx';
import { APPLY_FILTER_LABEL } from '../../../lib/utilities/messages/admin-console-messages.ts';
import { FROM_FILTER_LABEL, TO_FILTER_LABEL } from './audit-logs-messages.ts';

const APPLIED_DATE = '2026-11-04';
const NEXT_DATE = '2001-01-01';

const filtersOf = (
  search: AuditLogSearch,
  onApply: (search: AuditLogSearch) => void,
) => (
  <AuditLogFilters
    search={search}
    operators={[]}
    actions={[]}
    onApply={onApply}
    onReset={vi.fn()}
  />
);

describe('監査ログの絞り込みのフォーム', () => {
  test('適用した条件がURLへ反映されるより前に入力した値は、反映された時に失わない', async () => {
    const onApply = vi.fn<(search: AuditLogSearch) => void>();
    const screen = await render(filtersOf({}, onApply));
    const from = page.getByLabelText(FROM_FILTER_LABEL, { exact: true });
    const to = page.getByLabelText(TO_FILTER_LABEL, { exact: true });

    await from.fill(APPLIED_DATE);
    await to.fill(APPLIED_DATE);
    await page.getByRole('button', { name: APPLY_FILTER_LABEL }).click();
    expect(onApply).toHaveBeenLastCalledWith({
      from: APPLIED_DATE,
      to: APPLIED_DATE,
    });

    await from.fill(NEXT_DATE);
    await to.fill(NEXT_DATE);
    await screen.rerender(
      filtersOf({ from: APPLIED_DATE, to: APPLIED_DATE }, onApply),
    );

    await expect.element(from).toHaveValue(NEXT_DATE);
    await expect.element(to).toHaveValue(NEXT_DATE);
  });

  test('ブラウザの戻る操作などで外からURLの条件が変わった時は、入力欄をその値に戻す', async () => {
    const onApply = vi.fn<(search: AuditLogSearch) => void>();
    const screen = await render(filtersOf({}, onApply));
    const from = page.getByLabelText(FROM_FILTER_LABEL, { exact: true });

    await from.fill(NEXT_DATE);
    await screen.rerender(
      filtersOf({ from: APPLIED_DATE, to: APPLIED_DATE }, onApply),
    );

    await expect.element(from).toHaveValue(APPLIED_DATE);
  });
});
