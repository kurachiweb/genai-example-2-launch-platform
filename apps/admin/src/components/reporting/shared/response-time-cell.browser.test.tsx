import { afterEach, describe, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../../styles.css';
import { runAxe } from '../../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../../lib/test/computed-style.ts';
import type { ReportResponseTimeView } from '../../../graphql/admin-reporting-cases.ts';
import { ResponseTimeCell } from './response-time-cell.tsx';

const HOUR = 60 * 60;

const responseTimeOf = (
  patch: Partial<ReportResponseTimeView> = {},
): ReportResponseTimeView => ({
  startedAt: '2026-11-01T00:00:00.000Z',
  completedAt: null,
  elapsedSeconds: 3 * 24 * HOUR + 4 * HOUR + 120,
  alerts: [],
  ...patch,
});

const START_OVERDUE = '確認開始の目標(1営業日)を超えています';

const DECISION_OVERDUE = '判断の目標(9日)を超えています';

afterEach(() => {
  applyColorScheme('light');
});

describe('ResponseTimeCell', () => {
  test('未完了の案件は対応中の経過を示し、経過を機械可読な期間の<time>で示す', async () => {
    const { container } = await render(
      <ResponseTimeCell responseTime={responseTimeOf()} />,
    );

    await expect.element(page.getByText('対応中 3日4時間')).toBeVisible();
    const time = container.querySelector('time');
    expect(time?.textContent).toBe('3日4時間');
    expect(time?.getAttribute('datetime')).toBe(
      `PT${String(3 * 24 * HOUR + 4 * HOUR + 120)}S`,
    );
  });

  test('完了した案件は対応期間を示す', async () => {
    await render(
      <ResponseTimeCell
        responseTime={responseTimeOf({
          completedAt: '2026-11-01T04:30:00.000Z',
          elapsedSeconds: 4 * HOUR + 30 * 60,
        })}
      />,
    );

    await expect.element(page.getByText('対応期間 4時間')).toBeVisible();
  });

  test('1時間未満の経過は「1時間未満」と示す', async () => {
    await render(
      <ResponseTimeCell
        responseTime={responseTimeOf({ elapsedSeconds: 59 })}
      />,
    );

    await expect.element(page.getByText('対応中 1時間未満')).toBeVisible();
  });

  test('完了の日時を得られない案件は「不明」と示し、経過の<time>を置かない', async () => {
    const { container } = await render(
      <ResponseTimeCell
        responseTime={responseTimeOf({
          completedAt: null,
          elapsedSeconds: null,
        })}
      />,
    );

    await expect.element(page.getByText('不明', { exact: true })).toBeVisible();
    expect(container.querySelector('time')).toBeNull();
  });

  test('目標の超過は色だけに頼らず文言で示し、両方を超えた時は両方を示す', async () => {
    await render(
      <ResponseTimeCell
        responseTime={responseTimeOf({
          elapsedSeconds: 10 * 24 * HOUR,
          alerts: ['start-overdue', 'decision-overdue'],
        })}
      />,
    );

    await expect.element(page.getByText(START_OVERDUE)).toBeVisible();
    await expect.element(page.getByText(DECISION_OVERDUE)).toBeVisible();
    await expect
      .element(page.getByText(START_OVERDUE))
      .toHaveClass('text-destructive');
  });

  test('超過していない案件は超過の文言を示さない', async () => {
    await render(<ResponseTimeCell responseTime={responseTimeOf()} />);

    await expect.element(page.getByText('対応中 3日4時間')).toBeVisible();
    expect(page.getByText(START_OVERDUE).query()).toBeNull();
    expect(page.getByText(DECISION_OVERDUE).query()).toBeNull();
  });

  test('権利侵害の案件でない(対応期間が無い)案件には何も示さない', async () => {
    const { container } = await render(
      <ResponseTimeCell responseTime={null} />,
    );

    expect(container.textContent).toBe('');
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test('超過を示す対応期間のアクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    const { container } = await render(
      <main className="bg-background p-4">
        <ResponseTimeCell
          responseTime={responseTimeOf({
            alerts: ['start-overdue', 'decision-overdue'],
          })}
        />
      </main>,
    );

    expect(await runAxe(container)).toStrictEqual([]);
  });
});
