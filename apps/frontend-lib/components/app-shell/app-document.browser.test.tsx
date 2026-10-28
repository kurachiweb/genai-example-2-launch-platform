import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { act } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToReadableStream } from 'react-dom/server';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  type MockInstance,
  test,
  vi,
} from 'vitest';

import {
  type AppRuntime,
  createAppRuntimeHolder,
} from '../../start/router-context.ts';
import '../../styles/base.css';
import { runAxeOnDocument } from '../../test/a11y.ts';
import { emulateBrowserDisplay } from '../../test/display-emulation.ts';
import {
  emulatePreferredColorScheme,
  type PreferredColorScheme,
} from '../../test/preferred-color-scheme.ts';
import {
  THEME_BOOTSTRAP_SCRIPT,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from '../../utilities/theme/theme-preference.ts';
import type { PreloadRecoveryInput } from '../../start/preload-recovery.ts';
import { DateTime } from '../datetime/date-time.tsx';
import { AppDocument } from './app-document.tsx';
import { MAIN_CONTENT_ID } from './main-content.ts';

const mounted = vi.hoisted(() => ({
  queue: { enqueue: vi.fn(), flush: vi.fn() },
  initBrowserObservability: vi.fn(() => Promise.resolve()),
  uninstallPreloadRecovery: vi.fn(),
  installPreloadRecovery: vi.fn<(input: PreloadRecoveryInput) => () => void>(),
}));

vi.mock('../../start/observability/report-error.ts', () => ({
  browserErrorQueue: mounted.queue,
}));

vi.mock('../../start/observability/browser-observability.ts', () => ({
  initBrowserObservability: mounted.initBrowserObservability,
}));

vi.mock('../../start/preload-recovery.ts', () => ({
  installPreloadRecovery: mounted.installPreloadRecovery,
}));

const NONCE = 'bm9uY2Utb2YtcmVxdWVzdA==';
const HOME_TITLE = 'ホーム | Launch Stadium';
const KICKOFF = new Date('2026-01-15T07:40:00.000Z');

const RUNTIME: AppRuntime = {
  publicConfig: {
    environment: 'staging',
    turnstileSiteKey: '1x00000000000000000000BB',
    sentry: {
      dsn: 'https://public@sentry.example/1',
      environment: 'staging',
      tracesSampleRate: 0.1,
    },
    webAnalyticsToken: undefined,
  },
  display: { timeZone: 'Asia/Tokyo', locale: 'ja-JP' },
};

interface DocumentRouterOptions {
  readonly isServer?: boolean;
}

// 開発時の条件ではTanStack Routerの実行環境の判定が未定になりルーターの指定に従うため、サーバー側の描画に使うルーターはサーバーとして作る
function createDocumentRouter({
  isServer = false,
}: DocumentRouterOptions = {}) {
  const rootRoute = createRootRouteWithContext<object>()({
    head: () => ({ meta: [{ title: HOME_TITLE }] }),
    shellComponent: AppDocument,
  });
  const homeRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => (
      <main id={MAIN_CONTENT_ID}>
        <h1>ホーム</h1>
        <DateTime value={KICKOFF} format="longDateTime" />
      </main>
    ),
  });
  return createRouter({
    routeTree: rootRoute.addChildren([homeRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context: { runtime: createAppRuntimeHolder(RUNTIME) },
    ssr: { nonce: NONCE },
    isServer,
  });
}

type DocumentRouter = ReturnType<typeof createDocumentRouter>;

interface ActEnvironment {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}

const actEnvironment = globalThis as ActEnvironment;

// vitest-browser-reactのrenderは自分のactの後にactの環境の指定を戻すため、Reactのactを直接呼ぶたびに指定し直す
async function actInTestEnvironment(
  callback: () => Promise<void>,
): Promise<void> {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(callback);
  } finally {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  }
}

// TanStack Startと同じストリームの描画を使う。ルーターはhtml要素ごとSuspenseで包み、renderToStringはその内側のheadの通常の要素を出力しないため
async function renderServerMarkup(): Promise<string> {
  const router = createDocumentRouter({ isServer: true });
  await router.load();
  const stream = await renderToReadableStream(
    <RouterProvider router={router} />,
  );
  await stream.allReady;
  return new Response(stream).text();
}

const frames: HTMLIFrameElement[] = [];
const roots: Root[] = [];

// 文書の外枠はhtml要素ごと描画するため、テストのページとは別の文書へサーバー側の描画結果を書き込み、ブラウザに解析させてheadのスクリプトを本文より前に実行させる
async function openServerRenderedDocument(): Promise<Document> {
  const markup = await renderServerMarkup();
  const frame = document.createElement('iframe');
  frame.title = '文書の外枠の確認';
  const loaded = new Promise<void>((resolve) => {
    frame.addEventListener('load', () => {
      resolve();
    });
  });
  frame.srcdoc = markup;
  document.body.append(frame);
  frames.push(frame);
  await loaded;
  const frameDocument = frame.contentDocument;
  if (frameDocument === null) {
    throw new Error('確認用の文書を開けません。');
  }
  return frameDocument;
}

async function hydrateDocument(
  target: Document,
  router: DocumentRouter = createDocumentRouter(),
): Promise<DocumentRouter> {
  // TanStack Startはブラウザでサーバーの描画結果を引き継ぐ時にルーターへSSRの印を付け、サーバーと同じ要素の構成で描画させる。テストではその印を直接付ける
  router.ssr = { manifest: undefined };
  await router.load();
  await actInTestEnvironment(async () => {
    roots.push(hydrateRoot(target, <RouterProvider router={router} />));
    await Promise.resolve();
  });
  return router;
}

// 配色ごとのコントラストを検査するため、テストのページに読み込んだデザイントークンと基本のスタイルを確認用の文書へ写す
function adoptTestPageStyles(target: Document): void {
  for (const style of document.head.querySelectorAll('style')) {
    target.head.append(target.importNode(style, true));
  }
}

const themeOf = (target: Document): ThemePreference | 'unset' => {
  const root = target.documentElement;
  if (root.style.colorScheme === '') {
    return 'unset';
  }
  return root.classList.contains('dark') ? 'dark' : 'light';
};

function resetTestPageTheme(): void {
  document.documentElement.classList.remove('dark');
  document.documentElement.style.colorScheme = '';
}

let consoleError: MockInstance<Console['error']>;

// サーバー側の描画とハイドレーションを同じページで行うと、Reactが2つの描画系による同じContextの描画を開発時の警告として出す。実際の配信では両者は別の実行環境のため、その警告だけを除いて数える
const MULTIPLE_RENDERERS_WARNING =
  'Detected multiple renderers concurrently rendering the same context provider.';

const hydrationWarningsOf = (
  spy: MockInstance<Console['error']>,
): readonly unknown[][] =>
  spy.mock.calls.filter(
    ([message]) =>
      typeof message !== 'string' ||
      !message.startsWith(MULTIPLE_RENDERERS_WARNING),
  );

beforeEach(async () => {
  localStorage.removeItem(THEME_STORAGE_KEY);
  await emulatePreferredColorScheme('light');
  await emulateBrowserDisplay(RUNTIME.display);
  mounted.installPreloadRecovery.mockReturnValue(
    mounted.uninstallPreloadRecovery,
  );
  consoleError = vi.spyOn(console, 'error');
});

afterEach(async () => {
  await actInTestEnvironment(async () => {
    for (const root of roots.splice(0)) {
      root.unmount();
    }
    await Promise.resolve();
  });
  for (const frame of frames.splice(0)) {
    frame.remove();
  }
  vi.restoreAllMocks();
  vi.clearAllMocks();
  localStorage.removeItem(THEME_STORAGE_KEY);
  resetTestPageTheme();
  await emulatePreferredColorScheme(null);
  await emulateBrowserDisplay(null);
});

describe('AppDocument', () => {
  test('ルートのheadの指定に頼らず、headの中にnonce付きの初回描画前の配色のスクリプトを1つだけ置く', async () => {
    const markup = await renderServerMarkup();
    const parsed = new DOMParser().parseFromString(markup, 'text/html');
    const [bootstrap, ...others] = [
      ...parsed.querySelectorAll('script'),
    ].filter((script) => script.textContent.startsWith(THEME_BOOTSTRAP_SCRIPT));
    expect(others).toStrictEqual([]);
    expect(bootstrap?.getAttribute('nonce')).toBe(NONCE);
    expect(bootstrap?.parentElement).toBe(parsed.head);
    expect(bootstrap?.textContent).toBe(
      `${THEME_BOOTSTRAP_SCRIPT};document.currentScript.remove()`,
    );
  });

  test('ページの言語を日本語と示し、初回描画前の配色のスクリプトは実行後に自身を取り除く', async () => {
    const target = await openServerRenderedDocument();

    expect(target.documentElement.lang).toBe('ja');
    expect(target.title).toBe(HOME_TITLE);
    expect(
      [...target.querySelectorAll('script')].filter((script) =>
        script.textContent.startsWith(THEME_BOOTSTRAP_SCRIPT),
      ),
    ).toStrictEqual([]);
    expect(themeOf(target)).toBe('light');
  });

  test('本文へ移動するリンクを本文より前の最初の操作として置き、トーストと画面遷移の通知の領域と表示設定の提供を含める', async () => {
    const target = await openServerRenderedDocument();

    const firstFocusable = target.body.querySelector('a[href], button');
    expect(firstFocusable?.textContent).toBe('本文へ移動');
    expect(firstFocusable?.getAttribute('href')).toBe(`#${MAIN_CONTENT_ID}`);
    expect(
      target
        .querySelector('section[aria-label^="通知"]')
        ?.getAttribute('aria-live'),
    ).toBe('polite');
    expect(
      target
        .querySelector('[data-slot="route-announcer"]')
        ?.getAttribute('aria-live'),
    ).toBe('polite');
    expect(target.querySelector('main time')?.textContent).toBe(
      '2026年1月15日(木) 16:40',
    );
  });

  test.each<[string, string | null, PreferredColorScheme, ThemePreference]>([
    ['保存したダークを、OSがライトでも', 'dark', 'light', 'dark'],
    ['保存したライトを、OSがダークでも', 'light', 'dark', 'light'],
    ['保存が無い時はOSのダークを', null, 'dark', 'dark'],
    ['保存が無い時はOSのライトを', null, 'light', 'light'],
  ])(
    '%s本文の解析より前に文書へ反映する',
    async (_name, stored, scheme, expected) => {
      if (stored !== null) {
        localStorage.setItem(THEME_STORAGE_KEY, stored);
      }
      await emulatePreferredColorScheme(scheme);

      const target = await openServerRenderedDocument();

      expect(themeOf(target)).toBe(expected);
    },
  );

  test('初回描画前のスクリプトが変えたhtml要素の配色の属性で、ハイドレーションの不一致の警告を出さない', async () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    const target = await openServerRenderedDocument();
    expect(themeOf(target)).toBe('dark');

    await hydrateDocument(target);

    expect(themeOf(target)).toBe('dark');
    expect(hydrationWarningsOf(consoleError)).toStrictEqual([]);
  });

  test('マウント後に、ルーター・公開設定のSentryの設定・送信待ちの列でブラウザ側のSentryを初期化する', async () => {
    const target = await openServerRenderedDocument();

    const router = await hydrateDocument(target);

    expect(mounted.initBrowserObservability).toHaveBeenCalledTimes(1);
    expect(mounted.initBrowserObservability).toHaveBeenCalledWith({
      router,
      config: RUNTIME.publicConfig.sentry,
      queue: mounted.queue,
    });
  });

  test('マウント後に、ウィンドウとsessionStorageで消えたスクリプトの再読み込みの仕組みを入れ、外す時に解除する', async () => {
    const target = await openServerRenderedDocument();

    await hydrateDocument(target);

    expect(mounted.installPreloadRecovery).toHaveBeenCalledTimes(1);
    const [input] = mounted.installPreloadRecovery.mock.calls[0] ?? [];
    expect(input?.target).toBe(window);
    expect(input?.storage).toBe(window.sessionStorage);
    expect(input?.reload).toBeTypeOf('function');

    await actInTestEnvironment(async () => {
      for (const root of roots.splice(0)) {
        root.unmount();
      }
      await Promise.resolve();
    });

    expect(mounted.uninstallPreloadRecovery).toHaveBeenCalledTimes(1);
  });

  test.each<ThemePreference>(['light', 'dark'])(
    '%sの配色でハイドレーションした文書全体のアクセシビリティの自動検査の違反が0件',
    async (theme) => {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
      const target = await openServerRenderedDocument();

      await hydrateDocument(target);

      expect(themeOf(target)).toBe(theme);
      adoptTestPageStyles(target);
      expect(await runAxeOnDocument(target)).toStrictEqual([]);
    },
  );

  test('sessionStorageを参照するだけで例外になる環境では、保存先無しで再読み込みの仕組みを入れる', async () => {
    const target = await openServerRenderedDocument();
    vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('サイトデータを使えません', 'SecurityError');
    });

    await hydrateDocument(target);

    expect(mounted.installPreloadRecovery).toHaveBeenCalledWith(
      expect.objectContaining({ target: window, storage: undefined }),
    );
  });
});
