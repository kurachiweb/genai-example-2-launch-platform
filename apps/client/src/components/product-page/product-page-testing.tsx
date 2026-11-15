import { vi } from 'vitest';
import { page } from 'vitest/browser';

import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { TooltipProvider } from '../../../lib/components/ui/tooltip/tooltip-provider.tsx';
import type { DisplayPreferences } from '../../../lib/utilities/datetime/display-preferences.ts';
import {
  createPageRouterContext,
  GUEST_VIEWER_QUERY,
  renderInRouter,
} from '../../../test/page-router.tsx';
import { signedInViewerQuery } from '../../../test/viewer-fixtures.ts';
import {
  productLiveMatchQueryOptions,
  productPageQueryOptions,
  type ProductPageView,
} from '../../graphql/product-page.ts';
import { toClientViewer } from '../../graphql/viewer.ts';
import type { ProductLiveMatchView } from './live-match-fixtures.ts';
import { ProductPage } from './product-page.tsx';
import { productPageViewOf } from './product-page-fixtures.ts';
import type {
  ProductPagePlacement,
  ProductPageSection,
} from './product-page-section-types.ts';

export const TOKYO_JA: DisplayPreferences = Object.freeze({
  timeZone: 'Asia/Tokyo',
  locale: 'ja-JP',
});

export const DESKTOP = Object.freeze({ width: 1280, height: 900 });

export const VIEWER_QUERY = signedInViewerQuery();

export const VIEWER = toClientViewer(VIEWER_QUERY);

// 業務日付2026-11-10の12:00と、終了の1分前の23:39(日本時間)
export const NOON = new Date('2026-11-10T03:00:00.000Z');
export const BEFORE_FULL_TIME = new Date('2026-11-10T14:39:00.000Z');

// 偽のsetTimeoutでTanStack Queryの結果の通知が止まらないよう、テストの後に既定の通知へ戻す
export const SYSTEM_NOTIFY_SCHEDULER = (callback: () => void): void => {
  setTimeout(callback, 0);
};

export const startClockAt = (now: Date): void => {
  vi.useFakeTimers({
    now,
    toFake: [
      'Date',
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
    ],
  });
};

// 受け取った文脈を文言に出し、区画の並びの確かめに使う目印を付ける
export const labeledSection = (
  label: string,
): ProductPageSection['component'] =>
  function LabeledSection({ product, viewer, page: view, autoRefresh }) {
    return (
      <p data-test-section="" className="rounded-xl border p-3">
        {`${label}(${product.handle}・${view.name}・${viewer.isOwner ? '本人' : '他者'}・自動更新${autoRefresh ? 'オン' : 'オフ'})`}
      </p>
    );
  };

export const registered = (
  id: string,
  placement: ProductPagePlacement,
  order: number,
  component: ProductPageSection['component'] = labeledSection(id),
): ProductPageSection => ({ id, placement, order, component });

export interface RenderProductPageOptions {
  readonly sections?: readonly ProductPageSection[];
  readonly view?: ProductPageView;
  readonly liveMatch?: ProductLiveMatchView | null;
  // 偽ならloaderの開催中のマッチの取得が無かった状態(キャッシュが空)にする
  readonly liveMatchCached?: boolean;
  readonly signedIn?: boolean;
}

export const NO_LIVE_MATCH: ProductLiveMatchView = Object.freeze({
  serverTime: '2026-11-10T03:00:00.000Z',
  awaitingChange: false,
  match: null,
});

// 詳細ページのloaderが読んだ2つの取得を、ハイドレーションで受け取った状態にしてページを描く
export async function renderProductPage({
  sections = [],
  view = productPageViewOf(),
  liveMatch = NO_LIVE_MATCH,
  liveMatchCached = true,
  signedIn = true,
}: RenderProductPageOptions = {}) {
  const context = createPageRouterContext('local');
  const viewer = signedIn ? VIEWER : null;
  if (liveMatchCached) {
    context.queryClient.setQueryData(
      productLiveMatchQueryOptions(viewer, view.handle).queryKey,
      { productLiveMatch: liveMatch },
    );
  }
  context.queryClient.setQueryData(
    productPageQueryOptions(viewer, view.handle).queryKey,
    { productPage: view },
  );
  await renderInRouter(
    <DisplayPreferencesProvider initial={{ ...TOKYO_JA }}>
      <TooltipProvider>
        <main className="bg-background text-foreground">
          <ProductPage sections={sections} page={view} viewer={viewer} />
        </main>
      </TooltipProvider>
    </DisplayPreferencesProvider>,
    {
      context,
      cachedViewer: signedIn ? VIEWER_QUERY : GUEST_VIEWER_QUERY,
      path: `/p/${view.handle}`,
    },
  );
  return context;
}

export const productHeader = () =>
  page.getByRole('region', { name: 'Pitch Notes', exact: true });

export const liveMatchRegion = () =>
  page.getByRole('region', { name: /を戦っています$/u });

export const sidebar = () =>
  page.getByRole('complementary', { name: '評価と投稿者向けの操作' });

export const breadcrumbs = () =>
  page.getByRole('navigation', { name: 'パンくずリスト' });

export const autoRefreshSwitch = () =>
  page.getByRole('switch', { name: '自動更新' });

export const sectionTexts = (): string[] =>
  Array.from(document.querySelectorAll('[data-test-section]')).map(
    (element) => element.textContent,
  );

export const sectionElement = (text: string): HTMLElement =>
  page.getByText(text, { exact: true }).element() as HTMLElement;

export const precedes = (before: Element, after: Element): boolean =>
  (before.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING) !==
  0;

export const rectOf = (element: Element): DOMRect =>
  element.getBoundingClientRect();

export const pageRoot = (): HTMLElement => {
  const root = document.querySelector<HTMLElement>('[data-auto-refresh]');
  if (root === null) {
    throw new Error('ページの根がありません。');
  }
  return root;
};

export const turnstileWidgets = (): Element[] =>
  Array.from(document.querySelectorAll('[data-testid="fake-turnstile"]'));
