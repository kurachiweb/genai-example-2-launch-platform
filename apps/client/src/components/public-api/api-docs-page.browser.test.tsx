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
import { ApiDocsPage } from './api-docs-page.tsx';
import type { SwaggerUiLoader } from './swagger-ui-loader.ts';

// ルーターの文脈が読み込む同型の関数は、Startのビルドを経ないブラウザテストではサーバーの実装が残り読み込めないため差し替える
vi.mock('../../../lib/start/graphql/execute-graphql.ts', () => ({
  executeGraphQL: vi.fn(),
}));

const PUBLIC_API_ORIGIN = 'https://api.example';
const DOCUMENT_URL = 'https://api.example/v1/openapi.json';
const INTRO =
  '公開APIを使うと、プロダクト・ローンチ履歴・Upvote・コメント・評価・公開プロフィールなどの公開データを読み取り、自分のプロフィールとプロダクトの説明文を更新できます。';
const API_KEY_DESCRIPTION =
  'APIキーは設定のAPIキーのページで発行できます。発行の時に、機能ごとに使える操作を選びます。';
const AUTH_DESCRIPTION =
  '要求のAuthorizationヘッダーにBearer <APIキー>の形でAPIキーを付けてください。下のAPIリファレンスでは、APIキーを入力して経路を試せます。入力したAPIキーはブラウザに保存されません。';
const RATE_LIMIT_DESCRIPTION =
  'APIキーの持ち主ごとに、全てのAPIキーの要求を合わせて、読み取りは1分あたり30回、更新は1分あたり15回までです。加えて、IPアドレスごとに1分あたり60回までです。上限を超えた要求には429を返します。';
const LOAD_ERROR =
  'APIドキュメントを読み込めませんでした。時間をおいて再度お試しください。解決しない場合はお問い合わせください。';

const originalFetch = window.fetch.bind(window);

// 仕様書の要求だけを差し替え、テストの基盤の通信はそのまま通す
const stubDocumentFetch = (respond: () => Promise<Response>): void => {
  vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
    const url =
      input instanceof Request ? input.url : new URL(String(input)).href;
    return url === DOCUMENT_URL ? respond() : originalFetch(input, init);
  });
};

const neverLoads: SwaggerUiLoader = () =>
  Promise.withResolvers<never>().promise;

const renderPage = (loadSwaggerUi: SwaggerUiLoader = neverLoads) =>
  renderInRouter(<ApiDocsPage loadSwaggerUi={loadSwaggerUi} />, {
    path: '/api-docs',
    context: createPageRouterContext('local', {
      publicApiOrigin: PUBLIC_API_ORIGIN,
    }),
  });

const sectionOf = (name: string) => page.getByRole('region', { name });

beforeEach(() => {
  applyColorScheme('light');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ApiDocsPage', () => {
  test('見出しと導入文、APIキー・認証・レート制限の説明を、APIリファレンスの上に順に示す', async () => {
    stubDocumentFetch(() => Promise.withResolvers<Response>().promise);

    await renderPage();

    await expect
      .element(page.getByRole('heading', { level: 1 }))
      .toHaveTextContent('APIドキュメント');
    await expect.element(page.getByText(INTRO)).toBeVisible();
    expect(
      page
        .getByRole('heading', { level: 2 })
        .elements()
        .map((heading) => heading.textContent),
    ).toStrictEqual(['APIキー', '認証', 'レート制限', 'APIリファレンス']);
    await expect
      .element(sectionOf('APIキー'))
      .toHaveTextContent(API_KEY_DESCRIPTION);
    await expect
      .element(
        sectionOf('APIキー').getByRole('link', { name: 'APIキーの設定を開く' }),
      )
      .toHaveAttribute('href', '/settings/api-keys');
    await expect
      .element(sectionOf('認証').getByText(/^要求の/))
      .toHaveTextContent(AUTH_DESCRIPTION);
    expect(
      sectionOf('認証')
        .getByRole('code')
        .elements()
        .map((code) => code.textContent),
    ).toStrictEqual(['Authorization', 'Bearer <APIキー>']);
    await expect
      .element(sectionOf('レート制限'))
      .toHaveTextContent(RATE_LIMIT_DESCRIPTION);
  });

  test('仕様書を読み込む間は、見出しと説明を示したままAPIリファレンスの位置を読み込み中にする', async () => {
    stubDocumentFetch(() => Promise.withResolvers<Response>().promise);

    await renderPage();

    await expect
      .element(sectionOf('APIリファレンス').getByRole('status'))
      .toHaveTextContent('APIドキュメントを読み込み中');
    await expect.element(page.getByText(INTRO)).toBeVisible();
  });

  test('仕様書の取得に失敗すると、見出しと説明を残したまま失敗の文言と再試行と問い合わせへの導線を示し、再試行でページの見出しへフォーカスを移す', async () => {
    stubDocumentFetch(() =>
      Promise.resolve(new Response('unavailable', { status: 503 })),
    );
    await renderPage();
    const reference = sectionOf('APIリファレンス');

    await expect
      .element(reference.getByRole('alert'))
      .toHaveTextContent(LOAD_ERROR);
    await expect
      .element(reference.getByRole('link', { name: 'お問い合わせ' }))
      .toHaveAttribute('href', '/contact');
    await expect.element(page.getByText(INTRO)).toBeVisible();

    await reference.getByRole('button', { name: '再試行' }).click();

    await expect.element(page.getByRole('heading', { level: 1 })).toHaveFocus();
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    beforeEach(() => {
      applyColorScheme(scheme);
    });

    test('説明と読み込み中の表示で、アクセシビリティの検査の違反が0件', async () => {
      stubDocumentFetch(() => Promise.withResolvers<Response>().promise);
      await renderPage();
      await expect
        .element(sectionOf('APIリファレンス').getByRole('status'))
        .toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });

    test('読み込みの失敗の表示で、アクセシビリティの検査の違反が0件', async () => {
      stubDocumentFetch(() =>
        Promise.resolve(new Response('unavailable', { status: 503 })),
      );
      await renderPage();
      await expect
        .element(sectionOf('APIリファレンス').getByRole('alert'))
        .toBeVisible();

      expect(await runAxe(document.body)).toStrictEqual([]);
    });
  });
});
