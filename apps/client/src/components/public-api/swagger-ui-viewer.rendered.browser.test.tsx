import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
} from '../../../lib/test/computed-style.ts';
import {
  createPageRouterContext,
  renderInRouter,
} from '../../../test/page-router.tsx';
import { loadSwaggerUi } from './swagger-ui-loader.ts';
import { SwaggerUiViewer } from './swagger-ui-viewer.tsx';

// TanStack StartのViteのプラグインが無いテストでは、パッケージの入口がサーバーの部品まで読み込んで失敗する。ブラウザのビルドの変換と同じく関数をそのまま返す
vi.mock('@tanstack/react-start', () => ({
  createClientOnlyFn: <T,>(fn: T): T => fn,
}));

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const PUBLIC_API_ORIGIN = 'https://api.example';
const DOCUMENT_URL = 'https://api.example/v1/openapi.json';
const REFERENCE_HEADING = 'APIリファレンス';

const PRODUCT_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    handle: { type: 'string' },
    name: { type: 'string' },
  },
});

const jsonResponse = Object.freeze({
  '200': {
    description: '成功',
    content: {
      'application/json': {
        schema: { $ref: '#/components/schemas/Product' },
      },
    },
  },
});

const HANDLE_PARAMETER = Object.freeze({
  name: 'handle',
  in: 'path',
  required: true,
  schema: { type: 'string' },
});

// Swagger UIが色を分ける全てのメソッドと、選択欄になる列挙の引数と、例の表示とスキーマの一覧を描かせる
const OPENAPI_DOCUMENT = Object.freeze({
  openapi: '3.1.0',
  info: { title: '公開API', version: '1.0.0' },
  servers: [{ url: '/v1' }],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } },
    schemas: { Product: PRODUCT_SCHEMA },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/products': {
      get: {
        summary: 'プロダクトの一覧',
        parameters: [
          {
            name: 'sort',
            in: 'query',
            schema: { type: 'string', enum: ['new', 'popular'] },
          },
        ],
        responses: jsonResponse,
      },
      post: { summary: 'プロダクトの作成', responses: jsonResponse },
    },
    '/products/{handle}': {
      put: {
        summary: 'プロダクトの置き換え',
        parameters: [HANDLE_PARAMETER],
        responses: jsonResponse,
      },
      patch: {
        summary: 'プロダクトの更新',
        parameters: [HANDLE_PARAMETER],
        responses: jsonResponse,
      },
      delete: {
        summary: 'プロダクトの削除',
        parameters: [HANDLE_PARAMETER],
        responses: { '204': { description: '削除した' } },
      },
    },
  },
});

const originalFetch = window.fetch.bind(window);

const stubDocumentFetch = (): void => {
  vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
    const url =
      input instanceof Request ? input.url : new URL(String(input)).href;
    if (url === DOCUMENT_URL) {
      return Promise.resolve(Response.json(OPENAPI_DOCUMENT));
    }
    return originalFetch(input, init);
  });
};

const reference = () => page.getByRole('region', { name: REFERENCE_HEADING });

const renderRenderedViewer = async (): Promise<void> => {
  stubDocumentFetch();
  await renderInRouter(
    <main className="bg-background p-4 text-foreground">
      <h1>APIドキュメント</h1>
      <SwaggerUiViewer loadSwaggerUi={loadSwaggerUi} />
    </main>,
    {
      path: '/api-docs',
      context: createPageRouterContext('local', {
        publicApiOrigin: PUBLIC_API_ORIGIN,
      }),
    },
  );
  await expect
    .element(reference().getByText('プロダクトの削除', { exact: true }))
    .toBeVisible();
};

const expandAllOperations = async (): Promise<void> => {
  const summaries = Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      '.swagger-ui .opblock-summary-control',
    ),
  );
  for (const summary of summaries) {
    summary.click();
  }
  await expect
    .element(page.getByRole('combobox', { name: 'sort', exact: true }))
    .toBeInTheDocument();
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe.each(COLOR_SCHEMES)(
  '本物のSwagger UIを描画したとき(配色が%s)',
  (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    afterEach(() => {
      applyColorScheme('light');
    });

    test('サーバーの選択欄に日本語の名前があり、アクセシビリティの検査の違反が0件', async () => {
      await renderRenderedViewer();

      await expect
        .element(
          reference().getByRole('combobox', { name: 'サーバー', exact: true }),
        )
        .toHaveValue('https://api.example/v1');
      expect(await runAxe(document.body)).toStrictEqual([]);
    });

    test('全ての操作を開いた状態で、アクセシビリティの検査の違反が0件', async () => {
      await renderRenderedViewer();

      await expandAllOperations();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });

    test('操作を試す状態で、アクセシビリティの検査の違反が0件', async () => {
      await renderRenderedViewer();
      await expandAllOperations();

      await reference()
        .getByRole('button', { name: 'Try it out' })
        .first()
        .click();

      await expect
        .element(reference().getByRole('button', { name: 'Execute' }))
        .toBeVisible();
      expect(await runAxe(document.body)).toStrictEqual([]);
    });

    test('認証のダイアログを開いた状態で、アクセシビリティの検査の違反が0件', async () => {
      await renderRenderedViewer();

      await reference()
        .getByRole('button', { name: 'Authorize', exact: true })
        .click();

      await expect
        .element(page.getByRole('button', { name: '閉じる', exact: true }))
        .toBeVisible();
      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  },
);
