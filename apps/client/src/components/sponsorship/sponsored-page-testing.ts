import type { QueryClient } from '@tanstack/react-query';
import { expect, vi } from 'vitest';
import { page } from 'vitest/browser';

import { sponsoredPlacementsQueryOptions } from './use-sponsored-placements.ts';

export const DESKTOP = Object.freeze({ width: 1280, height: 900 });

export const MOBILE = Object.freeze({ width: 375, height: 900 });

export const UNEXPECTED_MESSAGE =
  'ページを表示できませんでした。時間をおいて再度お試しください。解決しない場合はお問い合わせください。';

export const legendRegion = () =>
  page.getByRole('region', { name: 'Legendスポンサー広告' });

export const goldRegion = () =>
  page.getByRole('region', { name: 'Goldスポンサー広告' });

export const silverRegion = () =>
  page.getByRole('region', { name: 'Silverスポンサー広告' });

// 広告のカードのリンクの読み上げの名前の末尾
export const AD_LINK_NAME = /のサイトを別タブで開く\(スポンサー広告\)$/u;

// 取得の結果を受けた描き直しと、一覧への差し込みの登録の後の描き直しを終えるまで待つ
export const waitForPlacementsSettled = async (
  queryClient: QueryClient,
): Promise<void> => {
  await vi.waitFor(() => {
    expect(['success', 'error']).toContain(
      queryClient.getQueryState(sponsoredPlacementsQueryOptions().queryKey)
        ?.status,
    );
  });
  for (let frame = 0; frame < 3; frame += 1) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
};

export const rectOf = (element: Element | null | undefined): DOMRect => {
  if (element === null || element === undefined) {
    throw new Error('要素がありません。');
  }
  return element.getBoundingClientRect();
};

export const displayOf = (selector: string): string => {
  const element = document.querySelector(selector);
  if (element === null) {
    throw new Error(`${selector}の要素がありません。`);
  }
  return getComputedStyle(element).display;
};
