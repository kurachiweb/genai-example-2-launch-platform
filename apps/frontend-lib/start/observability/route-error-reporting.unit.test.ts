import { describe, expect, mock, test } from 'bun:test';

import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';

import {
  installRouteErrorReporting,
  type ReportableRoute,
} from './route-error-reporting.ts';

const failure = new Error('取得に失敗しました');

const routeWith = (options: ReportableRoute['options']): ReportableRoute => ({
  options: { ...options },
});

const onErrorOf = (route: ReportableRoute): ((error: unknown) => void) => {
  const { onError } = route.options;
  if (onError === undefined) {
    throw new Error('onErrorが付いていません');
  }
  return onError;
};

describe('installRouteErrorReporting', () => {
  test('loaderを持ちonErrorの無いルートに、失敗を送るonErrorを付ける', () => {
    const report = mock<(error: unknown) => void>();
    const route = routeWith({ loader: () => undefined });

    installRouteErrorReporting([route], report);
    onErrorOf(route)(failure);

    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(failure);
  });

  test('beforeLoadを持ちonErrorの無いルートに、失敗を送るonErrorを付ける', () => {
    const report = mock<(error: unknown) => void>();
    const route = routeWith({ beforeLoad: () => undefined });

    installRouteErrorReporting([route], report);
    onErrorOf(route)(failure);

    expect(report).toHaveBeenCalledWith(failure);
  });

  test('loaderもbeforeLoadも持たないルートにはonErrorを付けない', () => {
    const report = mock<(error: unknown) => void>();
    const route = routeWith({});

    installRouteErrorReporting([route], report);

    expect(route.options.onError).toBeUndefined();
  });

  test('ルートが自身のonErrorを持つ時は、失敗を送ってからそのonErrorを呼ぶ', () => {
    const calls: string[] = [];
    const report = mock((error: unknown) => {
      calls.push(`report:${String(error)}`);
    });
    const route = routeWith({
      loader: () => undefined,
      onError: (error) => {
        calls.push(`route:${String(error)}`);
      },
    });

    installRouteErrorReporting([route], report);
    onErrorOf(route)(failure);

    expect(calls).toEqual([
      `report:${String(failure)}`,
      `route:${String(failure)}`,
    ]);
  });

  test('ルートのonErrorが投げた値はそのまま呼び出し元へ伝わる', () => {
    const replacement = new Error('ルートが置き換えた失敗');
    const route = routeWith({
      loader: () => undefined,
      onError: () => {
        throw replacement;
      },
    });
    let thrown: unknown;

    installRouteErrorReporting([route], () => undefined);
    try {
      onErrorOf(route)(failure);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(replacement);
  });

  test('同じルートへ何度呼んでも、1回の失敗を1回だけ送る', () => {
    const report = mock<(error: unknown) => void>();
    const route = routeWith({ loader: () => undefined });

    installRouteErrorReporting([route], report);
    installRouteErrorReporting([route], report);
    onErrorOf(route)(failure);

    expect(report).toHaveBeenCalledTimes(1);
  });

  test('TanStack Routerのloaderの失敗が、付けたonErrorを経て送られる', async () => {
    const report = mock<(error: unknown) => void>();
    const rootRoute = createRootRoute();
    const failingRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/',
      loader: () => {
        throw failure;
      },
    });
    const router = createRouter({
      routeTree: rootRoute.addChildren([failingRoute]),
      history: createMemoryHistory({ initialEntries: ['/'] }),
      isServer: true,
    });

    installRouteErrorReporting(Object.values(router.routesById), report);
    await router.load();

    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(failure);
  });
});
