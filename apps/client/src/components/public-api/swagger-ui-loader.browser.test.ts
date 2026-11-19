import { afterEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import type { OpenApiDocument } from './openapi-document.ts';
import {
  createSwaggerUiLoader,
  loadSwaggerUi,
  type SwaggerUiBundle,
} from './swagger-ui-loader.ts';

// TanStack StartのViteのプラグインが無いテストでは、パッケージの入口がサーバーの部品まで読み込んで失敗する。ブラウザのビルドの変換と同じく関数をそのまま返す
vi.mock('@tanstack/react-start', () => ({
  createClientOnlyFn: <T>(fn: T): T => fn,
}));

const API_KEY = 'lsk_0123456789abcdef0123456789abcdef0123456789a';

const SPEC: OpenApiDocument = Object.freeze({
  openapi: '3.1.0',
  info: { title: '公開API', version: '1.0.0' },
  servers: [{ url: 'https://api.example/v1' }],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/products/{handle}': {
      get: {
        summary: 'プロダクトの詳細',
        parameters: [
          {
            name: 'handle',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: { '200': { description: '成功' } },
      },
    },
  },
});

const mountDomNode = (): HTMLElement => {
  const domNode = document.createElement('div');
  document.body.append(domNode);
  return domNode;
};

const storedValues = (): readonly string[] =>
  Array.from({ length: localStorage.length }, (_, index) => {
    const key = localStorage.key(index) ?? '';
    return `${key}=${localStorage.getItem(key) ?? ''}`;
  });

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('loadSwaggerUi', () => {
  test('同じオリジンのSwagger UIの束とスタイルを読み込み、仕様書の経路の一覧を描画する', async () => {
    const render = await loadSwaggerUi();

    render({ domNode: mountDomNode(), spec: SPEC });

    await expect.element(page.getByText('/products/{handle}')).toBeVisible();
    await expect.element(page.getByText('プロダクトの詳細')).toBeVisible();
    const operation = document.querySelector('.swagger-ui .opblock-get');
    expect(operation).not.toBeNull();
    // スタイルを読み込んでいれば、GETの経路の枠に配布物のスタイルの枠線が付く
    expect(getComputedStyle(operation ?? document.body).borderTopStyle).toBe(
      'solid',
    );
  });

  test('入力したAPIキーで経路を試せる状態にし、キーをブラウザに保存しない', async () => {
    const render = await loadSwaggerUi();
    render({ domNode: mountDomNode(), spec: SPEC });
    await page.getByRole('button', { name: 'Authorize', exact: true }).click();

    await page
      .getByRole('textbox', { name: 'auth-bearer-value' })
      .fill(API_KEY);
    await page.getByRole('button', { name: 'Apply credentials' }).click();

    await expect
      .element(page.getByRole('button', { name: 'Remove authorization' }))
      .toBeVisible();
    expect(storedValues().filter((entry) => entry.includes(API_KEY))).toEqual(
      [],
    );
  });
});

describe('createSwaggerUiLoader', () => {
  test('外部の検証サービスを使わず、入力したキーを保存せず、URLの断片を書き換えない設定で、補正した仕様書を渡して描画する', async () => {
    const apis = Object.freeze({ name: 'apis' });
    const bundle = Object.assign(vi.fn(), {
      presets: { apis },
    }) as unknown as SwaggerUiBundle & ReturnType<typeof vi.fn>;
    const domNode = mountDomNode();

    const render = await createSwaggerUiLoader(() => Promise.resolve(bundle))();
    render({ domNode, spec: SPEC });

    expect(bundle).toHaveBeenCalledTimes(1);
    expect(bundle).toHaveBeenCalledWith({
      domNode,
      spec: SPEC,
      presets: [apis],
      validatorUrl: null,
      persistAuthorization: false,
      deepLinking: false,
    });
  });

  test('束の読み込みに失敗すると、読み込みの失敗をそのまま返す', async () => {
    const failure = new Error('チャンクを読み込めません。');

    await expect(
      createSwaggerUiLoader(() => Promise.reject(failure))(),
    ).rejects.toBe(failure);
  });
});
