import { useRef } from 'react';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  type Mock,
  test,
  vi,
} from 'vitest';
import { page } from 'vitest/browser';

import '../../styles.css';
import { runAxe } from '../../../lib/test/a11y.ts';
import {
  applyColorScheme,
  COLOR_SCHEMES,
  computedColorOf,
} from '../../../lib/test/computed-style.ts';
import {
  createPageRouterContext,
  renderInRouter,
} from '../../../test/page-router.tsx';
import type { RenderSwaggerUi, SwaggerUiLoader } from './swagger-ui-loader.ts';
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
const HEADING = 'APIドキュメント';
const REFERENCE_HEADING = 'APIリファレンス';
const LOADING_LABEL = 'APIドキュメントを読み込み中';
const LOAD_ERROR =
  'APIドキュメントを読み込めませんでした。時間をおいて再度お試しください。解決しない場合はお問い合わせください。';
const RENDERED_TEXT = '描画したAPIリファレンス';

const OPENAPI_DOCUMENT = Object.freeze({
  openapi: '3.1.0',
  info: { title: '公開API', version: '1.0.0' },
  servers: [{ url: '/v1' }],
  paths: {},
});

const originalFetch = window.fetch.bind(window);

// 仕様書の要求だけを差し替え、テストの基盤の通信はそのまま通す
const stubDocumentFetch = (
  respond: () => Promise<Response>,
): Mock<() => Promise<Response>> => {
  const documentFetch = vi.fn(respond);
  vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
    const url =
      input instanceof Request ? input.url : new URL(String(input)).href;
    if (url === DOCUMENT_URL) {
      return documentFetch();
    }
    return originalFetch(input, init);
  });
  return documentFetch;
};

const renderReference: RenderSwaggerUi = ({ domNode }) => {
  const rendered = document.createElement('p');
  rendered.textContent = RENDERED_TEXT;
  domNode.append(rendered);
};

const loaderOf = (render: RenderSwaggerUi = renderReference) =>
  vi.fn<SwaggerUiLoader>(() => Promise.resolve(render));

interface HarnessProps {
  readonly loadSwaggerUi: SwaggerUiLoader;
}

// ページの見出しへのフォーカスの移動を確かめるため、ページと同じく見出しを持つ枠に置く
function Harness({ loadSwaggerUi }: HarnessProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  return (
    <main className="bg-background p-4 text-foreground">
      <h1 ref={headingRef} tabIndex={-1}>
        {HEADING}
      </h1>
      <SwaggerUiViewer
        loadSwaggerUi={loadSwaggerUi}
        retryFocusRef={headingRef}
      />
    </main>
  );
}

const renderViewer = (
  loadSwaggerUi: SwaggerUiLoader,
  { publicApiOrigin }: { readonly publicApiOrigin: string | undefined } = {
    publicApiOrigin: PUBLIC_API_ORIGIN,
  },
) =>
  renderInRouter(<Harness loadSwaggerUi={loadSwaggerUi} />, {
    path: '/api-docs',
    context: createPageRouterContext('local', { publicApiOrigin }),
  });

const reference = () => page.getByRole('region', { name: REFERENCE_HEADING });

const loadError = () => reference().getByRole('alert');

beforeEach(() => {
  applyColorScheme('light');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SwaggerUiViewer', () => {
  test('仕様書とSwagger UIを読み込む間は、APIリファレンスの区画に読み込み中を示す', async () => {
    const pending = Promise.withResolvers<Response>();
    stubDocumentFetch(() => pending.promise);

    await renderViewer(loaderOf());

    await expect
      .element(reference().getByRole('status'))
      .toHaveTextContent(LOADING_LABEL);
    await expect
      .element(page.getByRole('heading', { name: REFERENCE_HEADING }))
      .toBeVisible();
    pending.resolve(Response.json(OPENAPI_DOCUMENT));
  });

  test('公開APIの仕様書を取得し、サーバーのURLを公開APIのオリジンの絶対URLにしてSwagger UIへ渡す', async () => {
    const documentFetch = stubDocumentFetch(() =>
      Promise.resolve(Response.json(OPENAPI_DOCUMENT)),
    );
    const render = vi.fn<RenderSwaggerUi>(renderReference);
    const loadSwaggerUi = loaderOf(render);

    await renderViewer(loadSwaggerUi);

    await expect.element(reference().getByText(RENDERED_TEXT)).toBeVisible();
    expect(reference().getByRole('status').elements()).toHaveLength(0);
    expect(documentFetch).toHaveBeenCalledTimes(1);
    expect(loadSwaggerUi).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledTimes(1);
    expect(render.mock.calls[0]?.[0].spec).toStrictEqual({
      ...OPENAPI_DOCUMENT,
      servers: [{ url: 'https://api.example/v1' }],
    });
  });

  test('仕様書の取得に失敗すると、失敗の文言と再試行のボタンと問い合わせへの導線を示す', async () => {
    stubDocumentFetch(() =>
      Promise.resolve(new Response('unavailable', { status: 503 })),
    );

    await renderViewer(loaderOf());

    await expect.element(loadError()).toHaveTextContent(LOAD_ERROR);
    await expect
      .element(reference().getByRole('button', { name: '再試行' }))
      .toBeVisible();
    await expect
      .element(reference().getByRole('link', { name: 'お問い合わせ' }))
      .toHaveAttribute('href', '/contact');
  });

  test('Swagger UIの読み込みに失敗した時も、同じ失敗の文言を示す', async () => {
    stubDocumentFetch(() => Promise.resolve(Response.json(OPENAPI_DOCUMENT)));

    await renderViewer(
      vi.fn<SwaggerUiLoader>(() =>
        Promise.reject(new Error('チャンクを読み込めません。')),
      ),
    );

    await expect.element(loadError()).toHaveTextContent(LOAD_ERROR);
    expect(reference().getByText(RENDERED_TEXT).elements()).toHaveLength(0);
  });

  test('公開APIのオリジンが無い環境では、仕様書を取得せずに失敗の文言を示す', async () => {
    const documentFetch = stubDocumentFetch(() =>
      Promise.resolve(Response.json(OPENAPI_DOCUMENT)),
    );
    const loadSwaggerUi = loaderOf();

    await renderViewer(loadSwaggerUi, { publicApiOrigin: undefined });

    await expect.element(loadError()).toHaveTextContent(LOAD_ERROR);
    expect(documentFetch).not.toHaveBeenCalled();
    expect(loadSwaggerUi).not.toHaveBeenCalled();
  });

  test('再試行を押すと、ページの見出しへフォーカスを移して読み込み直し、成功すればAPIリファレンスを示す', async () => {
    const documentFetch = stubDocumentFetch(() =>
      Promise.resolve(new Response('unavailable', { status: 503 })),
    );
    await renderViewer(loaderOf());
    await expect.element(loadError()).toBeVisible();
    const retried = Promise.withResolvers<Response>();
    documentFetch.mockImplementation(() => retried.promise);

    await reference().getByRole('button', { name: '再試行' }).click();

    await expect
      .element(page.getByRole('heading', { level: 1, name: HEADING }))
      .toHaveFocus();
    await expect
      .element(reference().getByRole('status'))
      .toHaveTextContent(LOADING_LABEL);
    expect(loadError().elements()).toHaveLength(0);
    retried.resolve(Response.json(OPENAPI_DOCUMENT));
    await expect.element(reference().getByText(RENDERED_TEXT)).toBeVisible();
    expect(documentFetch).toHaveBeenCalledTimes(2);
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    // Swagger UIは暗い配色を持たないため、ページの配色に関わらず描画先を明るい配色にする
    test('描画したAPIリファレンスの外側を明るい配色に固定する', async () => {
      stubDocumentFetch(() => Promise.resolve(Response.json(OPENAPI_DOCUMENT)));
      await renderViewer(loaderOf());
      await expect.element(reference().getByText(RENDERED_TEXT)).toBeVisible();

      const surface = reference().getByText(RENDERED_TEXT).element()
        .parentElement as HTMLElement;
      const { backgroundColor, color, colorScheme } = getComputedStyle(surface);
      expect(colorScheme).toBe('light');
      expect(backgroundColor).toBe(computedColorOf('#ffffff'));
      expect(color).not.toBe(computedColorOf('#ffffff'));
    });

    test('読み込み中で、アクセシビリティの検査の違反が0件', async () => {
      const pending = Promise.withResolvers<Response>();
      stubDocumentFetch(() => pending.promise);
      await renderViewer(loaderOf());
      await expect.element(reference().getByRole('status')).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
      pending.resolve(Response.json(OPENAPI_DOCUMENT));
    });

    test('読み込みの失敗で、アクセシビリティの検査の違反が0件', async () => {
      stubDocumentFetch(() =>
        Promise.resolve(new Response('unavailable', { status: 503 })),
      );
      await renderViewer(loaderOf());
      await expect.element(loadError()).toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
