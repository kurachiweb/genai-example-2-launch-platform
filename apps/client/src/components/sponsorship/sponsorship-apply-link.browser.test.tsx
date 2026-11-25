import { afterEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import { renderInRouter } from '../../../test/page-router.tsx';
import { SponsorshipApplyLink } from './sponsorship-apply-link.tsx';
import {
  SPONSORSHIP_APPLY_HREF,
  SPONSORSHIP_APPLY_LINK_LABEL,
} from './sponsorship-messages.ts';

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const MIN_TARGET_SIZE_PX = 24;

const applyLink = () =>
  page.getByRole('link', { name: SPONSORSHIP_APPLY_LINK_LABEL });

afterEach(() => {
  applyColorScheme('light');
});

describe('SponsorshipApplyLink', () => {
  test('「スポンサー広告を申し込む」を料金ページのスポンサー広告の区画へのリンクで示し、同じタブで開く', async () => {
    await renderInRouter(<SponsorshipApplyLink />);

    await expect.element(applyLink()).toBeVisible();
    await expect
      .element(applyLink())
      .toHaveAttribute('href', SPONSORSHIP_APPLY_HREF);
    expect(applyLink().element().getAttribute('target')).toBeNull();
    expect(page.getByRole('link').elements()).toHaveLength(1);
  });

  test('押せる範囲は24px四方以上である', async () => {
    await renderInRouter(<SponsorshipApplyLink />);

    await expect.element(applyLink()).toBeVisible();
    const rect = applyLink().element().getBoundingClientRect();
    expect(rect.width).toBeGreaterThanOrEqual(MIN_TARGET_SIZE_PX);
    expect(rect.height).toBeGreaterThanOrEqual(MIN_TARGET_SIZE_PX);
  });

  test.each(COLOR_SCHEMES)('%sの配色でaxeの違反が0件である', async (scheme) => {
    applyColorScheme(scheme);

    await renderInRouter(<SponsorshipApplyLink />);

    await expect.element(applyLink()).toBeVisible();
    expect(await runAxe(document.body)).toStrictEqual([]);
  });
});
