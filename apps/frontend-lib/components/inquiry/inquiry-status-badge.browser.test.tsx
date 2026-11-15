import { afterEach, describe, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import {
  INQUIRY_STATUSES,
  type InquiryStatus,
} from '../../../common-lib/inquiry/inquiry-status.ts';
import '../../styles/base.css';
import { runAxe } from '../../test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../../test/computed-style.ts';
import { InquiryStatusBadge } from './inquiry-status-badge.tsx';

afterEach(() => {
  applyColorScheme('light');
});

describe('InquiryStatusBadge', () => {
  test.each<[InquiryStatus, string]>([
    ['open', '未対応'],
    ['in_progress', '対応中'],
    ['resolved', '対応済'],
    ['rejected', '却下'],
  ])('%sは色だけでなく表示名「%s」の文言で示す', async (status, label) => {
    await render(<InquiryStatusBadge status={status} />);

    await expect
      .element(page.getByText(label, { exact: true }))
      .toHaveAttribute('data-slot', 'badge');
  });

  test('4種のステータスはそれぞれ異なる見た目にする', async () => {
    const { container } = await render(
      <div>
        {INQUIRY_STATUSES.map((status) => (
          <InquiryStatusBadge key={status} status={status} />
        ))}
      </div>,
    );
    const variants = Array.from(
      container.querySelectorAll('[data-slot="badge"]'),
      (badge) => badge.getAttribute('data-variant'),
    );

    expect(variants).toHaveLength(INQUIRY_STATUSES.length);
    expect(new Set(variants).size).toBe(INQUIRY_STATUSES.length);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('4種のステータスで、アクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await render(
        <div className="flex gap-2 bg-background p-4 text-foreground">
          {INQUIRY_STATUSES.map((status) => (
            <InquiryStatusBadge key={status} status={status} />
          ))}
        </div>,
      );

      expect(await runAxe(container)).toStrictEqual([]);
    });
  });
});
