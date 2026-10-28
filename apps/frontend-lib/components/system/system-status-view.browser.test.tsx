import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles/base.css';
import { runAxe } from '../../test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../../test/computed-style.ts';
import { emulateBrowserDisplay } from '../../test/display-emulation.ts';
import { emulateReducedMotion } from '../../test/reduced-motion.ts';
import type { DisplayPreferences } from '../../utilities/datetime/display-preferences.ts';
import {
  createNetworkError,
  GraphQLClientError,
} from '../../utilities/graphql/graphql-result.ts';
import type { SystemStatusResult } from '../../utilities/system/system-status-result.ts';
import { DisplayPreferencesProvider } from '../datetime/display-preferences-provider.tsx';
import {
  SystemStatusView,
  type SystemStatusViewProps,
} from './system-status-view.tsx';

const TOKYO_JA: DisplayPreferences = {
  timeZone: 'Asia/Tokyo',
  locale: 'ja-JP',
};

const SERVER_TIME = '2026-01-15T07:40:00.000Z';
const SERVER_TIME_TEXT = '2026年1月15日(木) 16:40';
const BROWSER_TIME = '2026-01-15T07:52:00.000Z';
const BROWSER_TIME_TEXT = '2026年1月15日(木) 16:52';

const API_UNREACHABLE_MESSAGE = 'APIサーバーへ到達できません。';
const UPSTREAM_MESSAGE =
  '現在ご利用いただけません。時間をおいて再度お試しください。';
const INTERNAL_ERROR_MESSAGE =
  '予期しないエラーが発生しました。時間をおいて再度お試しください。';

const reachableAt = (serverTime: string): SystemStatusResult => ({
  ok: true,
  data: { serverTime, databaseReachable: true },
});

const REACHABLE = reachableAt(SERVER_TIME);

const DATABASE_UNREACHABLE: SystemStatusResult = {
  ok: true,
  data: { serverTime: SERVER_TIME, databaseReachable: false },
};

const failureOf = (error: GraphQLClientError): SystemStatusResult => ({
  ok: false,
  error,
});

const UPSTREAM_UNAVAILABLE = failureOf(
  new GraphQLClientError({
    code: 'upstream_unavailable',
    message: UPSTREAM_MESSAGE,
    status: 502,
  }),
);

const API_UNREACHABLE_RESULTS: readonly (readonly [
  string,
  SystemStatusResult,
])[] = [
  ['upstream_unavailable', UPSTREAM_UNAVAILABLE],
  [
    'upstream_timeout',
    failureOf(
      new GraphQLClientError({
        code: 'upstream_timeout',
        message: UPSTREAM_MESSAGE,
        status: 504,
      }),
    ),
  ],
  ['network_error', failureOf(createNetworkError(new TypeError('failed')))],
];

const INTERNAL_ERROR = failureOf(
  new GraphQLClientError({
    code: 'internal_error',
    message: INTERNAL_ERROR_MESSAGE,
    status: 500,
  }),
);

function StatusView(props: Partial<SystemStatusViewProps>) {
  return (
    <DisplayPreferencesProvider initial={TOKYO_JA}>
      <SystemStatusView
        server={REACHABLE}
        onRecheck={() => undefined}
        rechecking={false}
        {...props}
      />
    </DisplayPreferencesProvider>
  );
}

const serverRegion = () =>
  page.getByRole('region', { name: 'サーバー側の描画時の結果' });
const browserRegion = () =>
  page.getByRole('region', { name: 'ブラウザからの再確認の結果' });
const browserStatus = () => browserRegion().getByRole('status');
const recheckButton = () => browserRegion().getByRole('button');

const definitionsOf = (region: Element): Record<string, string> =>
  Object.fromEntries(
    [...region.querySelectorAll('dt')].map((term) => [
      term.textContent,
      term.nextElementSibling?.textContent ?? '',
    ]),
  );

const resultTextOf = (region: Element): string =>
  [...region.children]
    .filter((child) => !/^H\d$/u.test(child.tagName))
    .map((child) => child.textContent)
    .join('');

beforeEach(async () => {
  await emulateBrowserDisplay(TOKYO_JA);
});

afterEach(async () => {
  applyColorScheme('light');
  await emulateReducedMotion('no-preference');
  await emulateBrowserDisplay(null);
});

describe('SystemStatusView(サーバー側の描画時の結果)', () => {
  test('疎通確認の画面の見出しを持ち、サーバー側の描画時とブラウザからの再確認の結果を別々の区画に分ける', async () => {
    await render(<StatusView />);

    await expect
      .element(page.getByRole('heading', { level: 1 }))
      .toHaveTextContent('疎通確認');
    await expect.element(serverRegion()).toBeVisible();
    await expect.element(browserRegion()).toBeVisible();
  });

  test('到達可能な時は、APIサーバーの時刻を表示設定に従って日時の要素で表示し、データベースを「到達可能」と表示する', async () => {
    await render(<StatusView />);

    const region = serverRegion().element();
    expect(definitionsOf(region)).toStrictEqual({
      APIサーバーの時刻: SERVER_TIME_TEXT,
      データベース: '到達可能',
    });
    expect(region.querySelector('time')?.getAttribute('datetime')).toBe(
      SERVER_TIME,
    );
    expect(region.textContent).not.toContain('到達できません');
  });

  test('データベースに到達できない時は、APIサーバーの時刻とともにデータベースを「到達できません」と表示する', async () => {
    await render(<StatusView server={DATABASE_UNREACHABLE} />);

    expect(definitionsOf(serverRegion().element())).toStrictEqual({
      APIサーバーの時刻: SERVER_TIME_TEXT,
      データベース: '到達できません',
    });
    expect(serverRegion().element().textContent).not.toContain(
      API_UNREACHABLE_MESSAGE,
    );
  });

  test.each(API_UNREACHABLE_RESULTS)(
    'APIサーバーへ到達できない(%s)時は「APIサーバーへ到達できません。」を表示し、時刻とデータベースの項目を出さない',
    async (_code, result) => {
      await render(<StatusView server={result} />);

      const region = serverRegion().element();
      expect(resultTextOf(region)).toBe(API_UNREACHABLE_MESSAGE);
      expect(region.querySelector('dl')).toBeNull();
      expect(region.querySelector('time')).toBeNull();
    },
  );

  test('APIサーバーへ到達した後の失敗は、APIサーバーへ到達できない表示と区別して失敗の文言を表示する', async () => {
    await render(<StatusView server={INTERNAL_ERROR} />);

    const region = serverRegion().element();
    expect(resultTextOf(region)).toBe(INTERNAL_ERROR_MESSAGE);
    expect(region.textContent).not.toContain(API_UNREACHABLE_MESSAGE);
  });

  test('到達可能・データベースに到達できない・APIサーバーへ到達できないの3つの状態の文言が互いに異なる', async () => {
    const texts: string[] = [];
    for (const result of [
      REACHABLE,
      DATABASE_UNREACHABLE,
      UPSTREAM_UNAVAILABLE,
    ]) {
      const screen = await render(<StatusView server={result} />);
      texts.push(resultTextOf(serverRegion().element()));
      await screen.unmount();
    }

    expect(new Set(texts).size).toBe(3);
    expect(texts.every((text) => text.length > 0)).toBe(true);
  });
});

describe('SystemStatusView(ブラウザからの再確認)', () => {
  test('まだ再確認していない時は、再確認の区画に案内を表示する', async () => {
    await render(<StatusView />);

    await expect
      .element(browserStatus())
      .toHaveTextContent(
        '「再確認」を押すと、ブラウザから確認した結果を表示します。',
      );
    expect(browserRegion().element().querySelector('dl')).toBeNull();
  });

  test('再確認の結果は、サーバー側の描画時の結果と区別して再確認の区画に表示する', async () => {
    await render(
      <StatusView server={REACHABLE} browser={reachableAt(BROWSER_TIME)} />,
    );

    expect(definitionsOf(serverRegion().element())).toStrictEqual({
      APIサーバーの時刻: SERVER_TIME_TEXT,
      データベース: '到達可能',
    });
    expect(definitionsOf(browserStatus().element())).toStrictEqual({
      APIサーバーの時刻: BROWSER_TIME_TEXT,
      データベース: '到達可能',
    });
  });

  test('再確認でAPIサーバーへ到達できない時は、サーバー側の描画時の結果を残したまま再確認の区画にだけ表示する', async () => {
    await render(
      <StatusView server={REACHABLE} browser={UPSTREAM_UNAVAILABLE} />,
    );

    await expect
      .element(browserStatus())
      .toHaveTextContent(API_UNREACHABLE_MESSAGE);
    expect(serverRegion().element().textContent).not.toContain(
      API_UNREACHABLE_MESSAGE,
    );
    expect(definitionsOf(serverRegion().element())).toStrictEqual({
      APIサーバーの時刻: SERVER_TIME_TEXT,
      データベース: '到達可能',
    });
  });

  test('「再確認」をキーボードとポインターで操作すると、そのたびに再確認を求める', async () => {
    const onRecheck = vi.fn();
    await render(<StatusView onRecheck={onRecheck} />);

    await userEvent.tab();
    await expect
      .element(page.getByRole('button', { name: '再確認', exact: true }))
      .toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await recheckButton().click();

    expect(onRecheck).toHaveBeenCalledTimes(2);
  });

  test('再確認中は、ボタンを「再確認中」にしてaria-busyとaria-disabledで示し、フォーカスを保ち、重ねて操作しても再確認を求めない', async () => {
    const onRecheck = vi.fn();
    const screen = await render(<StatusView onRecheck={onRecheck} />);
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');

    await screen.rerender(<StatusView onRecheck={onRecheck} rechecking />);

    const button = page.getByRole('button', { name: '再確認中', exact: true });
    await expect.element(button).toHaveFocus();
    await expect.element(button).toHaveAttribute('aria-busy', 'true');
    await expect.element(button).toHaveAttribute('aria-disabled', 'true');
    await expect.element(button).not.toHaveAttribute('disabled');
    await userEvent.keyboard('{Enter}');
    expect(onRecheck).toHaveBeenCalledTimes(1);
  });

  test('再確認中は、前回の結果に代えて「再確認中」を状態の領域の文言で伝え、視差効果を減らす設定でも文言で示す', async () => {
    await emulateReducedMotion('reduce');
    await render(<StatusView browser={reachableAt(BROWSER_TIME)} rechecking />);

    await expect.element(browserStatus()).toHaveTextContent('再確認中');
    expect(browserStatus().element().querySelector('dl')).toBeNull();
    expect(browserStatus().element().textContent).not.toContain(
      BROWSER_TIME_TEXT,
    );
  });

  test('再確認が終わると、ボタンを「再確認」に戻して結果を状態の領域に表示する', async () => {
    const screen = await render(<StatusView rechecking />);

    await screen.rerender(<StatusView browser={DATABASE_UNREACHABLE} />);

    const button = page.getByRole('button', { name: '再確認', exact: true });
    await expect.element(button).not.toHaveAttribute('aria-busy');
    await expect.element(button).not.toHaveAttribute('aria-disabled');
    expect(definitionsOf(browserStatus().element())).toStrictEqual({
      APIサーバーの時刻: SERVER_TIME_TEXT,
      データベース: '到達できません',
    });
  });
});

describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
  test('到達可能とデータベースに到達できない表示でアクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    const { container } = await render(
      <StatusView server={REACHABLE} browser={DATABASE_UNREACHABLE} />,
    );

    expect(await runAxe(container)).toStrictEqual([]);
  });

  test('APIサーバーへ到達できない表示と再確認中の表示でアクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    const { container } = await render(
      <StatusView server={UPSTREAM_UNAVAILABLE} rechecking />,
    );

    expect(await runAxe(container)).toStrictEqual([]);
  });

  test('APIサーバーへ到達した後の失敗の表示でアクセシビリティの検査の違反が0件', async () => {
    applyColorScheme(scheme);
    const { container } = await render(
      <StatusView server={INTERNAL_ERROR} browser={INTERNAL_ERROR} />,
    );

    expect(await runAxe(container)).toStrictEqual([]);
  });
});
