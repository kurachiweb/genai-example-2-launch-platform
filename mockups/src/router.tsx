import {
  createRouter as createTanStackRouter,
  parseSearchWith,
  stringifySearchWith,
} from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    // モックアップの状態はすべて文字列のクエリで表すため、数値風の値もJSONで引用符付きにしない
    parseSearch: parseSearchWith((value) => value),
    stringifySearch: stringifySearchWith((value) => String(value)),
  });

  return router;
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
