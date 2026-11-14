import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  HeadContent,
  Link,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { afterEach, describe, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles/base.css';
import { runAxe } from '../../test/a11y.ts';
import { RouteAnnouncer } from './route-announcer.tsx';

const HOME_TITLE = 'ホーム | Launch Stadium';
const DIRECTORY_TITLE = 'ディレクトリ | Launch Stadium';

const originalTitle = document.title;

function announcementRegion(): HTMLElement {
  const regions = [
    ...document.querySelectorAll<HTMLElement>('[data-slot="route-announcer"]'),
  ];
  const [region] = regions;
  if (regions.length !== 1 || region === undefined) {
    throw new Error('画面遷移の通知の領域がちょうど1つではありません。');
  }
  return region;
}

function createAnnouncedRouter() {
  const rootRoute = createRootRoute({
    component: () => (
      <div className="bg-background p-4 text-foreground">
        <HeadContent />
        <nav aria-label="メイン" className="flex gap-4">
          <Link to="/">ホーム</Link>
          <Link to="/p">ディレクトリ</Link>
          <Link to="/p" search={{ sort: 'new' }}>
            新着順
          </Link>
        </nav>
        <main>
          <Outlet />
        </main>
        <RouteAnnouncer />
      </div>
    ),
  });
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    head: () => ({ meta: [{ title: HOME_TITLE }] }),
    component: () => <h1>ホーム</h1>,
  });
  const directoryRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/p',
    head: () => ({ meta: [{ title: DIRECTORY_TITLE }] }),
    component: () => <h1>ディレクトリ</h1>,
  });
  return createRouter({
    routeTree: rootRoute.addChildren([homeRoute, directoryRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
}

type AnnouncedRouter = ReturnType<typeof createAnnouncedRouter>;

// 画面遷移の描画が終わったことを、通知の部品と同じルーターの合図で待つ
function renderedOnce(router: AnnouncedRouter): Promise<void> {
  return new Promise((resolve) => {
    const unsubscribe = router.subscribe('onRendered', () => {
      unsubscribe();
      resolve();
    });
  });
}

// 合図を受けた部品の状態の更新がReactで描画されるまで待つ
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

afterEach(() => {
  document.title = originalTitle;
});

describe('RouteAnnouncer', () => {
  test('最初の表示では何も通知せず、丁寧なライブリージョンを先に置いておく', async () => {
    await render(<RouterProvider router={createAnnouncedRouter()} />);

    await expect
      .element(page.getByRole('heading', { name: 'ホーム' }))
      .toBeVisible();
    await expect.poll(() => document.title).toBe(HOME_TITLE);
    const region = announcementRegion();
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.getAttribute('aria-atomic')).toBe('true');
    expect(region.textContent).toBe('');
  });

  test('ブラウザ内の画面遷移の後に、移動先のページのタイトルを通知する', async () => {
    await render(<RouterProvider router={createAnnouncedRouter()} />);
    await expect
      .element(page.getByRole('heading', { name: 'ホーム' }))
      .toBeVisible();

    await userEvent.click(page.getByRole('link', { name: 'ディレクトリ' }));

    await expect
      .element(page.getByRole('heading', { name: 'ディレクトリ' }))
      .toBeVisible();
    await expect
      .poll(() => announcementRegion().textContent)
      .toBe(DIRECTORY_TITLE);
    expect(document.title).toBe(DIRECTORY_TITLE);

    await userEvent.click(page.getByRole('link', { name: 'ホーム' }));

    await expect.poll(() => announcementRegion().textContent).toBe(HOME_TITLE);
  });

  test('同じページのまま検索条件だけが変わった時は、ページの移動として通知しない', async () => {
    const router = createAnnouncedRouter();
    await render(<RouterProvider router={router} />);
    await userEvent.click(page.getByRole('link', { name: 'ディレクトリ' }));
    await expect
      .poll(() => announcementRegion().textContent)
      .toBe(DIRECTORY_TITLE);
    document.title = '書き換えたタイトル';
    const rendered = renderedOnce(router);

    await userEvent.click(page.getByRole('link', { name: '新着順' }));

    await rendered;
    await nextFrame();
    expect(router.state.location.search).toEqual({ sort: 'new' });
    expect(announcementRegion().textContent).toBe(DIRECTORY_TITLE);
  });

  test('遷移の後もアクセシビリティの自動検査の違反が0件', async () => {
    const { container } = await render(
      <RouterProvider router={createAnnouncedRouter()} />,
    );
    await userEvent.click(page.getByRole('link', { name: 'ディレクトリ' }));
    await expect
      .poll(() => announcementRegion().textContent)
      .toBe(DIRECTORY_TITLE);

    expect(await runAxe(container)).toStrictEqual([]);
  });
});
