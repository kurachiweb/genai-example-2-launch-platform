import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { describe, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import { useFragmentToken } from './use-fragment-token.ts';

const TOKEN = ['link', 'token', 'value'].join('_');

function TokenState() {
  const link = useFragmentToken();
  return <p>{link.status === 'found' ? `found:${link.token}` : link.status}</p>;
}

async function renderAt(path: string) {
  const router = createRouter({
    routeTree: createRootRoute({ component: TokenState }),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  await render(<RouterProvider router={router} />);
  return router;
}

describe('useFragmentToken', () => {
  test('フラグメントのトークンを読み、パスと検索のクエリを残して同じ履歴の項目からフラグメントを消す', async () => {
    const router = await renderAt(`/links/confirm?from=mail#token=${TOKEN}`);

    await expect.element(page.getByText(`found:${TOKEN}`)).toBeVisible();
    await expect.poll(() => router.history.location.hash).toBe('');
    expect(router.history.location.pathname).toBe('/links/confirm');
    expect(router.history.location.search).toBe('?from=mail');
    expect(router.history.length).toBe(1);
  });

  test('フラグメントを消した後も、最初に読んだトークンを保つ', async () => {
    const router = await renderAt(`/links/confirm#token=${TOKEN}`);
    await expect.poll(() => router.history.location.hash).toBe('');

    await router.invalidate();

    await expect.element(page.getByText(`found:${TOKEN}`)).toBeVisible();
  });

  test('トークンを持たないフラグメントは消さず、トークンが無いとする', async () => {
    const router = await renderAt('/links/confirm#section-2');

    await expect.element(page.getByText('missing')).toBeVisible();
    expect(router.history.location.hash).toBe('#section-2');
  });

  test('フラグメントが無ければ、トークンが無いとする', async () => {
    await renderAt('/links/confirm');

    await expect.element(page.getByText('missing')).toBeVisible();
  });
});
