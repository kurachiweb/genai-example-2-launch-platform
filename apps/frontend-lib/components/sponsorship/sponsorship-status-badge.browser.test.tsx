import { afterEach, describe, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import {
  SPONSORSHIP_STATUSES,
  type SponsorshipStatus,
} from '../../../common-lib/sponsorship/sponsorship-status.ts';
import '../../styles/base.css';
import { runAxe } from '../../test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../../test/computed-style.ts';
import { SponsorshipStatusBadge } from './sponsorship-status-badge.tsx';

afterEach(() => {
  applyColorScheme('light');
});

const ALL_BADGES = (
  <div className="flex flex-wrap gap-2 bg-background p-4 text-foreground">
    {SPONSORSHIP_STATUSES.map((status) => (
      <SponsorshipStatusBadge key={status} status={status} />
    ))}
  </div>
);

describe('SponsorshipStatusBadge', () => {
  test.each<[SponsorshipStatus, string]>([
    ['pending_payment', '未決済'],
    ['scheduled', '掲載予定'],
    ['active', '掲載中'],
    ['paused', '表示停止中'],
    ['ended', '終了'],
    ['terminated', '強制終了'],
  ])('%sは色だけでなく表示名「%s」の文言で示す', async (status, label) => {
    await render(<SponsorshipStatusBadge status={status} />);

    await expect
      .element(page.getByText(label, { exact: true }))
      .toHaveAttribute('data-slot', 'badge');
  });

  test('6種の掲載状況はそれぞれ異なる見た目にする', async () => {
    const { container } = await render(ALL_BADGES);
    const appearances = Array.from(
      container.querySelectorAll('[data-slot="badge"]'),
      (badge) =>
        `${badge.getAttribute('data-variant') ?? ''} ${badge.className}`,
    );

    expect(appearances).toHaveLength(SPONSORSHIP_STATUSES.length);
    expect(new Set(appearances).size).toBe(SPONSORSHIP_STATUSES.length);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('6種の掲載状況で、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await render(ALL_BADGES);

      expect(await runAxe(container)).toStrictEqual([]);
    });
  });
});
