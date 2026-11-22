import { afterEach, describe, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../../styles.css';
import { runAxe } from '../../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../../lib/test/computed-style.ts';
import { REPORT_CASE_STATUSES } from '../../../../common-lib/reporting/report-case-rules.ts';
import { ReportCaseStatusBadge } from './report-case-status-badge.tsx';

afterEach(() => {
  applyColorScheme('light');
});

describe('ReportCaseStatusBadge', () => {
  test.each([
    ['open', '未対応'],
    ['in_progress', '対応中'],
    ['resolved', '対応済'],
    ['rejected', '却下'],
  ] as const)('%sの案件は「%s」と文言で示す', async (status, label) => {
    await render(<ReportCaseStatusBadge status={status} />);

    await expect.element(page.getByText(label, { exact: true })).toBeVisible();
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test('全ての状態のバッジのアクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    const { container } = await render(
      <main>
        {REPORT_CASE_STATUSES.map((status) => (
          <ReportCaseStatusBadge key={status} status={status} />
        ))}
      </main>,
    );

    expect(await runAxe(container)).toStrictEqual([]);
  });
});
