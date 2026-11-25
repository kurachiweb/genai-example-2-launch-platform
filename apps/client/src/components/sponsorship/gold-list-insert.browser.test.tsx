import { useState } from 'react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import type { RouterContext } from '../../../lib/start/router-context.ts';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import {
  createPageRouterContext,
  renderInRouter,
} from '../../../test/page-router.tsx';
import {
  ClientSponsoredPlacementsDocument,
  type ClientSponsoredPlacementsQuery,
} from '../../graphql/generated/graphql.ts';
import { goldInsertTracker } from './gold-insert-tracker.ts';
import { GoldListInsert } from './gold-list-insert.tsx';
import { renderPlacementsOnServer } from './render-placements-on-server.tsx';
import {
  adNamesIn,
  PLACEMENTS_LOAD_FAILURE,
  placementsOf,
} from './sponsored-placements-fixtures.ts';
import { sponsoredPlacementsQueryOptions } from './use-sponsored-placements.ts';

const { executeGraphQL } = vi.hoisted(() => ({ executeGraphQL: vi.fn() }));

vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL,
}));

const OTHER_CONTENT = 'ページの他の内容';

const VIEWPORT_HEIGHT = 900;

const REMOVE_LABEL = '差し込みを外す';

const respond = (result: unknown) => {
  executeGraphQL.mockImplementation((document: unknown) =>
    document === ClientSponsoredPlacementsDocument
      ? Promise.resolve(result)
      : Promise.reject(new Error('想定外の操作です。')),
  );
};

const respondWith = (data: ClientSponsoredPlacementsQuery) => {
  respond({ ok: true, data });
};

const placementCalls = () =>
  executeGraphQL.mock.calls.filter(
    ([document]) => document === ClientSponsoredPlacementsDocument,
  );

const host = () => page.getByTestId('insert-host');

// ディレクトリの一覧と同じく、ページが置く一覧の項目の中に差し込みを描く
const renderInsert = async (position: number): Promise<RouterContext> => {
  const context = createPageRouterContext('local');
  await renderInRouter(
    <>
      <ul>
        <li data-testid="insert-host">
          <GoldListInsert position={position} />
        </li>
      </ul>
      <p>{OTHER_CONTENT}</p>
    </>,
    { context },
  );
  return context;
};

function RemovableInsert({ position }: { readonly position: number }) {
  const [shown, setShown] = useState(true);
  return (
    <>
      <div data-testid="insert-host">
        {shown && <GoldListInsert position={position} />}
      </div>
      <button
        type="button"
        onClick={() => {
          setShown(false);
        }}
      >
        {REMOVE_LABEL}
      </button>
    </>
  );
}

const waitForSettled = async (context: RouterContext) => {
  await vi.waitFor(() => {
    expect(['success', 'error']).toContain(
      context.queryClient.getQueryState(
        sponsoredPlacementsQueryOptions().queryKey,
      )?.status,
    );
  });
  // 取得の結果を受けた描き直し(失敗ならエラーの境界への伝播)と、描いた後の登録を終えてから確かめる
  for (let frame = 0; frame < 2; frame += 1) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
};

afterEach(() => {
  executeGraphQL.mockReset();
  applyColorScheme('light');
});

describe('GoldListInsert', () => {
  test.each([375, 1023])(
    '画面幅%ipxでは、position番目のGoldの広告を1枚描き、一覧の項目の要素を描かない',
    async (width) => {
      await page.viewport(width, VIEWPORT_HEIGHT);
      respondWith(placementsOf({ legend: 1, gold: 3, silver: 1 }));

      await renderInsert(2);

      await expect.element(host().getByRole('link')).toBeVisible();
      expect(adNamesIn([host().element()])).toEqual(['Gold Ad 2']);
      expect(host().element().querySelectorAll('li')).toHaveLength(0);
      expect(host().getByRole('region').elements()).toHaveLength(0);
    },
  );

  test.each([1024, 1280])(
    '画面幅%ipxでは、差し込みを表示しない',
    async (width) => {
      await page.viewport(width, VIEWPORT_HEIGHT);
      respondWith(placementsOf({ gold: 3 }));

      const context = await renderInsert(1);

      await waitForSettled(context);
      expect(adNamesIn([host().element()])).toEqual(['Gold Ad 1']);
      expect(host().getByRole('link').elements()).toHaveLength(0);
      expect(host().element().getBoundingClientRect().height).toBe(0);
    },
  );

  test('描いた差し込みを描画済みの数に登録し、外すと登録を解除する', async () => {
    await page.viewport(375, VIEWPORT_HEIGHT);
    respondWith(placementsOf({ gold: 3 }));

    const context = createPageRouterContext('local');
    await renderInRouter(<RemovableInsert position={3} />, { context });

    await waitForSettled(context);
    await expect.element(host().getByRole('link')).toBeVisible();
    expect(goldInsertTracker.getSnapshot()).toBe(1);

    await page.getByRole('button', { name: REMOVE_LABEL }).click();

    await expect.element(host().getByRole('link')).not.toBeInTheDocument();
    expect(goldInsertTracker.getSnapshot()).toBe(0);
  });

  test('position番目のGoldの広告が無ければ、何も描かず登録もしない', async () => {
    await page.viewport(375, VIEWPORT_HEIGHT);
    respondWith(placementsOf({ legend: 1, gold: 2 }));

    const context = await renderInsert(3);

    await waitForSettled(context);
    await expect.element(page.getByText(OTHER_CONTENT)).toBeVisible();
    expect(host().element().childElementCount).toBe(0);
    expect(goldInsertTracker.getSnapshot()).toBe(0);
  });

  test('取得に失敗したら、何も描かず、失敗の表示も出さずにページの他の内容を残す', async () => {
    await page.viewport(375, VIEWPORT_HEIGHT);
    respond(PLACEMENTS_LOAD_FAILURE);

    const context = await renderInsert(1);

    await waitForSettled(context);
    await expect.element(page.getByText(OTHER_CONTENT)).toBeVisible();
    expect(placementCalls()).toHaveLength(1);
    expect(host().element().childElementCount).toBe(0);
    expect(page.getByRole('link').elements()).toHaveLength(0);
    expect(page.getByRole('button').elements()).toHaveLength(0);
    expect(page.getByRole('alert').elements()).toHaveLength(0);
    expect(goldInsertTracker.getSnapshot()).toBe(0);
  });

  test('サーバーの描画の結果に、position番目のGoldの広告を含める', () => {
    const html = renderPlacementsOnServer(
      <GoldListInsert position={2} />,
      placementsOf({ gold: 3 }),
    );

    expect(adNamesIn([html.body])).toEqual(['Gold Ad 2']);
  });

  test.each(COLOR_SCHEMES)('%sの配色でaxeの違反が0件である', async (scheme) => {
    await page.viewport(375, VIEWPORT_HEIGHT);
    applyColorScheme(scheme);
    respondWith(placementsOf({ gold: 2 }));

    await renderInsert(1);

    await expect.element(host().getByRole('link')).toBeVisible();
    expect(await runAxe(document.body)).toStrictEqual([]);
  });
});
