import { describe, expect, test, vi } from 'vitest';

import { Route } from '../src/routes/__root.tsx';
import { PAGE_ROUTER_ROOT_COMPONENTS } from './page-router.tsx';

// 文書の外枠はサーバーの描画の文脈を読む部品を含み、Startのビルドを経ないブラウザテストでは読み込めないため、空の部品に差し替える
vi.mock('../lib/components/app-shell/app-document.tsx', () => ({
  AppDocument: () => null,
}));

describe('画面のテスト用のルーター', () => {
  test('存在しないページと想定外のエラーに、アプリのルートと同じ部品を使う', () => {
    expect(Route.options.notFoundComponent).toBe(
      PAGE_ROUTER_ROOT_COMPONENTS.notFoundComponent,
    );
    expect(Route.options.errorComponent).toBe(
      PAGE_ROUTER_ROOT_COMPONENTS.errorComponent,
    );
  });
});
