import { describe, expect, mock, test } from 'bun:test';
import type { QueryClient } from '@tanstack/react-query';

import { loadPinnedHelpArticles } from '../graphql/help-center.ts';
import {
  loadSiteLayout,
  SITE_LAYOUT_LOADERS,
  type SiteLayoutLoader,
} from './layout-loaders.ts';

const QUERY_CLIENT = {} as QueryClient;

describe('SITE_LAYOUT_LOADERS', () => {
  test('フッターのピン留め記事の取得を含み、凍結されている', () => {
    expect(SITE_LAYOUT_LOADERS).toContain(loadPinnedHelpArticles);
    expect(Object.isFrozen(SITE_LAYOUT_LOADERS)).toBe(true);
  });
});

describe('loadSiteLayout', () => {
  test('登録された取得をすべて同時に始め、すべての完了を待つ', async () => {
    const started: string[] = [];
    const finishers: (() => void)[] = [];
    const loaderOf =
      (name: string): SiteLayoutLoader =>
      (queryClient) => {
        expect(queryClient).toBe(QUERY_CLIENT);
        started.push(name);
        return new Promise((resolve) => {
          finishers.push(resolve);
        });
      };
    let finished = false;

    const loading = loadSiteLayout(QUERY_CLIENT, [
      loaderOf('first'),
      loaderOf('second'),
    ]).then(() => {
      finished = true;
    });

    expect(started).toEqual(['first', 'second']);
    finishers[0]?.();
    await Promise.resolve();
    expect(finished).toBe(false);
    finishers[1]?.();
    await loading;
    expect(finished).toBe(true);
  });

  test('取得の一覧を省くと、登録口の取得を使う', async () => {
    const query = mock(() => Promise.resolve({ pinnedHelpArticles: [] }));

    await loadSiteLayout({ query } as unknown as QueryClient);

    expect(query).toHaveBeenCalledTimes(SITE_LAYOUT_LOADERS.length);
  });
});
