import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRouter,
  RouterContextProvider,
  RouterProvider,
} from '@tanstack/react-router';
import { type ReactNode, useState } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles/base.css';
import type { AppRuntime, RouterContext } from '../../start/router-context.ts';
import { runAxe } from '../../test/a11y.ts';
import {
  lastTurnstileProps,
  resetFakeTurnstile,
  turnstileResetCount,
} from '../../test/fake-turnstile.tsx';
import { setThemePreference } from '../../utilities/theme/theme-preference.ts';
import {
  recordTurnstileScriptFailure,
  resetTurnstileScriptFailure,
} from './turnstile-script-failure.ts';
import { TurnstileWidget } from './turnstile-widget.tsx';
import { useTurnstileToken } from './use-turnstile-token.ts';

vi.mock(
  '@marsidev/react-turnstile',
  () => import('../../test/fake-turnstile.tsx'),
);

const SITE_KEY = '1x00000000000000000000BB';
const NONCE = 'bm9uY2Utb2YtcmVxdWVzdA==';
const FAILURE_MESSAGE =
  '認証に失敗しました。ページを再読み込みして再度お試しください。';

const RUNTIME: AppRuntime = {
  publicConfig: {
    environment: 'staging',
    turnstileSiteKey: SITE_KEY,
    sentry: { dsn: undefined, environment: 'staging', tracesSampleRate: 0.1 },
    webAnalyticsToken: undefined,
  },
  display: { timeZone: 'Asia/Tokyo', locale: 'ja-JP' },
};

type RuntimeContext = Pick<RouterContext, 'runtime'>;

const runtimeContext: RuntimeContext = {
  runtime: {
    get: () => RUNTIME,
    set: () => undefined,
  },
};

interface RouterOptions {
  readonly nonce: string | undefined;
  readonly context?: object;
}

function createTestRouter(
  ui: ReactNode,
  { nonce, context = runtimeContext }: RouterOptions,
) {
  const rootRoute = createRootRouteWithContext<object>()({
    component: () => ui,
    errorComponent: ({ error }) => (
      <p role="alert">{error instanceof Error ? error.message : ''}</p>
    ),
  });
  return createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory(),
    context,
    ssr: { nonce },
  });
}

async function renderInRouter(
  ui: ReactNode,
  options: RouterOptions = { nonce: NONCE },
): Promise<void> {
  await render(<RouterProvider router={createTestRouter(ui, options)} />);
}

const consumed: (string | undefined)[] = [];

function TokenHarness({ action }: { readonly action?: string }) {
  const turnstile = useTurnstileToken();
  return (
    <div className="flex flex-col gap-2 p-4">
      <TurnstileWidget {...turnstile.widgetProps} action={action} />
      <p data-testid="status">{turnstile.status}</p>
      <p data-testid="token">{turnstile.token ?? 'なし'}</p>
      <button
        type="button"
        onClick={() => {
          consumed.push(turnstile.consume());
        }}
      >
        送信する
      </button>
    </div>
  );
}

interface NamedHarnessProps {
  readonly name: string;
}

// 同じページに複数置いた時に、どのウィジェットの状態と文言かを区画の名前で見分ける
function NamedHarness({ name }: NamedHarnessProps) {
  const turnstile = useTurnstileToken();
  return (
    <section aria-label={name}>
      <TurnstileWidget {...turnstile.widgetProps} />
      <p data-testid={`status-${name}`}>{turnstile.status}</p>
    </section>
  );
}

function LatePlacementHarness() {
  const [placed, setPlaced] = useState(false);
  return (
    <>
      <NamedHarness name="1つ目" />
      <button
        type="button"
        onClick={() => {
          setPlaced(true);
        }}
      >
        2つ目のウィジェットを置く
      </button>
      {placed ? <NamedHarness name="2つ目" /> : null}
    </>
  );
}

function RemountHarness() {
  const [generation, setGeneration] = useState(0);
  return (
    <>
      <NamedHarness key={generation} name="描き直すウィジェット" />
      <button
        type="button"
        onClick={() => {
          setGeneration((current) => current + 1);
        }}
      >
        描き直す
      </button>
    </>
  );
}

const widgetProbe = {
  status: 'idle',
  widgetRef: { current: undefined },
  onSuccess: () => undefined,
  onExpire: () => undefined,
} as const;

interface LayoutHarnessProps {
  readonly layoutClassName: string;
}

function LayoutHarness({ layoutClassName }: LayoutHarnessProps) {
  const turnstile = useTurnstileToken();
  return (
    <div className={layoutClassName}>
      <p data-testid="before">前の要素</p>
      <TurnstileWidget {...turnstile.widgetProps} />
      <p data-testid="after">後の要素</p>
    </div>
  );
}

const rectOf = (testId: string): DOMRect => {
  const element = page.getByTestId(testId).element();
  return element.getBoundingClientRect();
};

const remInPixels = (): number =>
  Number.parseFloat(getComputedStyle(document.documentElement).fontSize);

const LAYOUTS = [
  { name: 'flexの間隔', layoutClassName: 'flex flex-col gap-4' },
  { name: '兄弟の間の余白', layoutClassName: 'space-y-4' },
] as const;

const succeed = () =>
  userEvent.click(page.getByRole('button', { name: '判定を成功させる' }));
const expire = () =>
  userEvent.click(page.getByRole('button', { name: '判定の期限を切らす' }));
const fail = () =>
  userEvent.click(page.getByRole('button', { name: '判定を失敗させる' }));
const failScript = () =>
  userEvent.click(
    page.getByRole('button', { name: 'スクリプトの読み込みを失敗させる' }),
  );
const failScriptFromFirstWidget = () =>
  userEvent.click(
    page
      .getByRole('button', { name: 'スクリプトの読み込みを失敗させる' })
      .first(),
  );
const regionOf = (name: string) => page.getByRole('region', { name });
const statusOf = (name: string) => page.getByTestId(`status-${name}`);
const renderedWidgetCount = () =>
  page.getByTestId('fake-turnstile').elements().length;
const submit = () =>
  userEvent.click(page.getByRole('button', { name: '送信する' }));
const statusText = () => page.getByTestId('status');
const tokenText = () => page.getByTestId('token');

beforeEach(() => {
  resetFakeTurnstile();
  resetTurnstileScriptFailure();
  consumed.length = 0;
});

afterEach(() => {
  setThemePreference(document.documentElement, undefined, 'light');
  document.documentElement.style.colorScheme = '';
  resetFakeTurnstile();
  resetTurnstileScriptFailure();
  vi.restoreAllMocks();
});

describe('TurnstileWidget', () => {
  test('ルーターの実行時の値のサイトキーとnonceでウィジェットを描画し、スクリプトは描画を妨げないdefer・asyncで読み込ませる', async () => {
    await renderInRouter(<TokenHarness action="signup" />);

    await expect
      .element(page.getByTestId('fake-turnstile'))
      .toBeInTheDocument();
    const props = lastTurnstileProps();
    expect(props.siteKey).toBe(SITE_KEY);
    expect(props.scriptOptions).toMatchObject({
      nonce: NONCE,
      defer: true,
      async: true,
    });
    expect(props.injectScript).not.toBe(false);
    expect(props.options).toMatchObject({
      action: 'signup',
      refreshExpired: 'never',
    });
  });

  test('判定の枠を画面に出さず場所を取らない非表示の大きさで、ウィジェットを描画させる', async () => {
    await renderInRouter(<TokenHarness />);

    await expect
      .element(page.getByTestId('fake-turnstile'))
      .toBeInTheDocument();
    expect(lastTurnstileProps().options).toMatchObject({ size: 'invisible' });
  });

  test('非表示のウィジェットでも、判定に失敗すると失敗の文言を画面に表示する', async () => {
    await renderInRouter(<TokenHarness />);
    await expect
      .element(page.getByTestId('fake-turnstile'))
      .toBeInTheDocument();

    await fail();

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(FAILURE_MESSAGE);
    await expect.element(page.getByRole('alert')).toBeVisible();
    expect(lastTurnstileProps().options?.size).toBe('invisible');
  });

  test.each(LAYOUTS)(
    '親の$nameの中で、平常時のウィジェットは通常の流れに入らず、前後の要素の間を間隔1つ分だけにする',
    async ({ layoutClassName }) => {
      await renderInRouter(<LayoutHarness layoutClassName={layoutClassName} />);
      await expect
        .element(page.getByTestId('fake-turnstile'))
        .toBeInTheDocument();

      expect(rectOf('after').top - rectOf('before').bottom).toBe(remInPixels());
    },
  );

  test.each(LAYOUTS)(
    '親の$nameの中で、判定に失敗した時は失敗の文言だけが通常の流れに入り、文言の前後を間隔1つ分ずつにする',
    async ({ layoutClassName }) => {
      await renderInRouter(<LayoutHarness layoutClassName={layoutClassName} />);
      await expect
        .element(page.getByTestId('fake-turnstile'))
        .toBeInTheDocument();

      await fail();

      const alert = page.getByRole('alert');
      await expect.element(alert).toHaveTextContent(FAILURE_MESSAGE);
      const message = alert.element().getBoundingClientRect();
      expect(message.top - rectOf('before').bottom).toBe(remInPixels());
      expect(rectOf('after').top - message.bottom).toBe(remInPixels());
    },
  );

  test('ルーターにnonceが無い時は、nonceを付けずにスクリプトを読み込ませる', async () => {
    await renderInRouter(<TokenHarness />, { nonce: undefined });

    await expect
      .element(page.getByTestId('fake-turnstile'))
      .toBeInTheDocument();
    expect(lastTurnstileProps().scriptOptions?.nonce).toBeUndefined();
  });

  test('アプリの配色をウィジェットの配色として渡し、配色の切り替えに追従してもトークンの状態を保つ', async () => {
    await renderInRouter(<TokenHarness />);
    await expect
      .element(page.getByTestId('fake-turnstile'))
      .toBeInTheDocument();
    expect(lastTurnstileProps().options).toMatchObject({ theme: 'light' });
    await succeed();
    await expect.element(statusText()).toHaveTextContent('ready');

    setThemePreference(document.documentElement, undefined, 'dark');

    await expect.poll(() => lastTurnstileProps().options?.theme).toBe('dark');
    await expect.element(statusText()).toHaveTextContent('ready');
    await expect.element(tokenText()).toHaveTextContent('turnstile-token-1');

    setThemePreference(document.documentElement, undefined, 'light');

    await expect.poll(() => lastTurnstileProps().options?.theme).toBe('light');
  });

  test('ルーターの文脈に実行時の値が無い時は、設定の誤りを示す例外で描画を止める', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await renderInRouter(<TokenHarness />, { nonce: NONCE, context: {} });

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent('ルーターの文脈に実行時の値がありません。');
    expect(page.getByTestId('fake-turnstile').elements()).toStrictEqual([]);
  });

  test('同じページの複数のウィジェットは、互いに異なる要素のidで描画する', async () => {
    await renderInRouter(
      <>
        <TokenHarness />
        <TokenHarness />
      </>,
    );

    const widgets = page.getByTestId('fake-turnstile');
    await expect.element(widgets.nth(1)).toBeInTheDocument();
    const ids = widgets.elements().map((element) => element.id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe('');
    expect(ids[0]).not.toBe(ids[1]);
  });

  test('判定に失敗すると、文言規則の失敗の文言を警告として読み上げさせ、検査の補助の違反が無い', async () => {
    await renderInRouter(<TokenHarness />);
    await expect
      .element(page.getByTestId('fake-turnstile'))
      .toBeInTheDocument();
    await expect.element(page.getByRole('alert')).not.toBeInTheDocument();

    await fail();

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(FAILURE_MESSAGE);
    await expect.element(statusText()).toHaveTextContent('error');
    await expect.element(tokenText()).toHaveTextContent('なし');
    expect(await runAxe(document.body)).toStrictEqual([]);
  });

  test('スクリプトの読み込みに失敗した時も、失敗の文言を警告として示す', async () => {
    await renderInRouter(<TokenHarness />);
    await expect
      .element(page.getByTestId('fake-turnstile'))
      .toBeInTheDocument();

    await failScript();

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(FAILURE_MESSAGE);
    await expect.element(statusText()).toHaveTextContent('error');
  });

  test('失敗の後に自動の再試行で判定に成功すると、警告を消してトークンを受け取る', async () => {
    await renderInRouter(<TokenHarness />);
    await expect
      .element(page.getByTestId('fake-turnstile'))
      .toBeInTheDocument();
    await fail();
    await expect.element(page.getByRole('alert')).toBeInTheDocument();

    await succeed();

    await expect.element(page.getByRole('alert')).not.toBeInTheDocument();
    await expect.element(statusText()).toHaveTextContent('ready');
    await expect.element(tokenText()).toHaveTextContent('turnstile-token-1');
  });
});

describe('TurnstileWidgetのスクリプトの読み込みの失敗の共有', () => {
  test('スクリプトの読み込みに失敗すると、失敗を知らせたウィジェットもウィジェットの部品を描かずに失敗の文言を出し続ける', async () => {
    await renderInRouter(<TokenHarness />);
    await expect
      .element(page.getByTestId('fake-turnstile'))
      .toBeInTheDocument();

    await failScript();

    await expect
      .element(page.getByRole('alert'))
      .toHaveTextContent(FAILURE_MESSAGE);
    await expect.element(statusText()).toHaveTextContent('error');
    await expect.poll(renderedWidgetCount).toBe(0);
  });

  test('失敗の時に同じページに置いていた2つ目のウィジェットも、読み込みを待たずに失敗の文言を出す', async () => {
    await renderInRouter(
      <>
        <NamedHarness name="1つ目" />
        <NamedHarness name="2つ目" />
      </>,
    );
    await expect
      .element(page.getByTestId('fake-turnstile').nth(1))
      .toBeInTheDocument();

    await failScriptFromFirstWidget();

    for (const name of ['1つ目', '2つ目']) {
      await expect
        .element(regionOf(name).getByRole('alert'))
        .toHaveTextContent(FAILURE_MESSAGE);
      await expect.element(statusOf(name)).toHaveTextContent('error');
    }
    await expect.poll(renderedWidgetCount).toBe(0);
  });

  test('失敗の後に新しく置いたウィジェットは、読み込みを待たずに失敗の文言を出し、ウィジェットの部品を描かない', async () => {
    await renderInRouter(<LatePlacementHarness />);
    await expect
      .element(page.getByTestId('fake-turnstile'))
      .toBeInTheDocument();
    await failScript();
    await expect
      .element(regionOf('1つ目').getByRole('alert'))
      .toBeInTheDocument();

    await userEvent.click(
      page.getByRole('button', { name: '2つ目のウィジェットを置く' }),
    );

    await expect
      .element(regionOf('2つ目').getByRole('alert'))
      .toHaveTextContent(FAILURE_MESSAGE);
    await expect.element(statusOf('2つ目')).toHaveTextContent('error');
    expect(renderedWidgetCount()).toBe(0);
  });

  test('失敗の後に描き直したウィジェットは、読み込みを待たずに失敗の文言を出し、ウィジェットの部品を描かない', async () => {
    await renderInRouter(<RemountHarness />);
    await expect
      .element(page.getByTestId('fake-turnstile'))
      .toBeInTheDocument();
    await failScript();
    await expect
      .element(statusOf('描き直すウィジェット'))
      .toHaveTextContent('error');

    await userEvent.click(page.getByRole('button', { name: '描き直す' }));

    await expect
      .element(regionOf('描き直すウィジェット').getByRole('alert'))
      .toHaveTextContent(FAILURE_MESSAGE);
    await expect
      .element(statusOf('描き直すウィジェット'))
      .toHaveTextContent('error');
    expect(renderedWidgetCount()).toBe(0);
  });

  test('記録の後に置いたウィジェットは失敗を1回だけ知らせ、描画し直しても知らせ直さない', async () => {
    recordTurnstileScriptFailure();
    const onError = vi.fn<() => void>();

    await renderInRouter(
      <TurnstileWidget {...widgetProbe} onError={onError} />,
    );

    await expect.poll(() => onError.mock.calls.length).toBe(1);
    setThemePreference(document.documentElement, undefined, 'dark');
    await expect
      .poll(() => document.documentElement.classList.contains('dark'))
      .toBe(true);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(renderedWidgetCount()).toBe(0);
  });

  test('サーバーの描画では記録を読まず、ウィジェットの部品を描いて失敗の文言を出さない', () => {
    recordTurnstileScriptFailure();
    const onError = vi.fn<() => void>();
    const router = createTestRouter(null, { nonce: NONCE });

    const html = renderToString(
      <RouterContextProvider router={router}>
        <TurnstileWidget {...widgetProbe} onError={onError} />
      </RouterContextProvider>,
    );

    expect(html).toContain('data-testid="fake-turnstile"');
    expect(html).not.toContain(FAILURE_MESSAGE);
    expect(onError).not.toHaveBeenCalled();
  });

  test('判定の失敗は失敗したウィジェットだけに出し、同じページの他のウィジェットへ広げない', async () => {
    await renderInRouter(
      <>
        <NamedHarness name="1つ目" />
        <NamedHarness name="2つ目" />
      </>,
    );
    await expect
      .element(page.getByTestId('fake-turnstile').nth(1))
      .toBeInTheDocument();

    await userEvent.click(
      page.getByRole('button', { name: '判定を失敗させる' }).first(),
    );

    await expect
      .element(regionOf('1つ目').getByRole('alert'))
      .toHaveTextContent(FAILURE_MESSAGE);
    await expect.element(statusOf('1つ目')).toHaveTextContent('error');
    await expect.element(statusOf('2つ目')).toHaveTextContent('idle');
    await expect
      .element(regionOf('2つ目').getByRole('alert'))
      .not.toBeInTheDocument();
    expect(renderedWidgetCount()).toBe(2);
  });
});

describe('useTurnstileToken', () => {
  test('判定の前はトークンを持たず、取り出しても何も返さずウィジェットを再実行しない', async () => {
    await renderInRouter(<TokenHarness />);
    await expect.element(statusText()).toHaveTextContent('idle');
    await expect.element(tokenText()).toHaveTextContent('なし');

    await submit();

    expect(consumed).toStrictEqual([undefined]);
    expect(turnstileResetCount()).toBe(0);
  });

  test('判定に成功するとトークンを受け取り、使える状態にする', async () => {
    await renderInRouter(<TokenHarness />);
    await expect
      .element(page.getByTestId('fake-turnstile'))
      .toBeInTheDocument();

    await succeed();

    await expect.element(statusText()).toHaveTextContent('ready');
    await expect.element(tokenText()).toHaveTextContent('turnstile-token-1');
  });

  test('取り出したトークンは使用済みにしてウィジェットを再実行し、再実行の成功で新しいトークンを受け取る', async () => {
    await renderInRouter(<TokenHarness />);
    await expect
      .element(page.getByTestId('fake-turnstile'))
      .toBeInTheDocument();
    await succeed();
    await expect.element(tokenText()).toHaveTextContent('turnstile-token-1');

    await submit();

    expect(consumed).toStrictEqual(['turnstile-token-1']);
    expect(turnstileResetCount()).toBe(1);
    await expect.element(statusText()).toHaveTextContent('idle');
    await expect.element(tokenText()).toHaveTextContent('なし');

    await submit();

    expect(consumed).toStrictEqual(['turnstile-token-1', undefined]);
    expect(turnstileResetCount()).toBe(1);

    await succeed();

    await expect.element(statusText()).toHaveTextContent('ready');
    await expect.element(tokenText()).toHaveTextContent('turnstile-token-2');
  });

  test('期限切れのトークンは捨ててウィジェットを再実行し、取り出しても期限切れのトークンを返さない', async () => {
    await renderInRouter(<TokenHarness />);
    await expect
      .element(page.getByTestId('fake-turnstile'))
      .toBeInTheDocument();
    await succeed();
    await expect.element(tokenText()).toHaveTextContent('turnstile-token-1');

    await expire();

    await expect.element(statusText()).toHaveTextContent('expired');
    await expect.element(tokenText()).toHaveTextContent('なし');
    expect(turnstileResetCount()).toBe(1);
    await expect.element(page.getByRole('alert')).not.toBeInTheDocument();

    await submit();

    expect(consumed).toStrictEqual([undefined]);
    expect(turnstileResetCount()).toBe(1);

    await succeed();

    await expect.element(statusText()).toHaveTextContent('ready');
    await expect.element(tokenText()).toHaveTextContent('turnstile-token-2');
  });
});
