import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import '../../styles.css';
import { DisplayPreferencesProvider } from '../../../lib/components/datetime/display-preferences-provider.tsx';
import { emulateBrowserDisplay } from '../../../lib/test/display-emulation.ts';
import type { DisplayPreferences } from '../../../lib/utilities/datetime/display-preferences.ts';
import { GraphQLClientError } from '../../../lib/utilities/graphql/graphql-result.ts';
import type { SystemStatusResult } from '../../../lib/utilities/system/system-status-result.ts';
import { SystemStatusPage } from './system-status-page.tsx';

const TOKYO_JA: DisplayPreferences = {
  timeZone: 'Asia/Tokyo',
  locale: 'ja-JP',
};

const SERVER_RESULT: SystemStatusResult = {
  ok: true,
  data: { serverTime: '2026-01-15T07:40:00.000Z', databaseReachable: true },
};
const SERVER_TIME_TEXT = '2026年1月15日(木) 16:40';

const BROWSER_RESULT: SystemStatusResult = {
  ok: true,
  data: { serverTime: '2026-01-15T07:52:00.000Z', databaseReachable: false },
};
const BROWSER_TIME_TEXT = '2026年1月15日(木) 16:52';

const UPSTREAM_UNAVAILABLE: SystemStatusResult = {
  ok: false,
  error: new GraphQLClientError({
    code: 'upstream_unavailable',
    message: '現在ご利用いただけません。時間をおいて再度お試しください。',
    status: 503,
  }),
};

const serverRegion = () =>
  page.getByRole('region', { name: 'サーバー側の描画時の結果' });
const browserRegion = () =>
  page.getByRole('region', { name: 'ブラウザからの再確認の結果' });
const recheckButton = () => browserRegion().getByRole('button');

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

async function renderPage(
  server: SystemStatusResult,
  recheck: () => Promise<SystemStatusResult>,
) {
  await render(
    <DisplayPreferencesProvider initial={TOKYO_JA}>
      <SystemStatusPage server={server} recheck={recheck} />
    </DisplayPreferencesProvider>,
  );
}

beforeEach(async () => {
  await emulateBrowserDisplay(TOKYO_JA);
});

afterEach(async () => {
  await emulateBrowserDisplay(null);
});

describe('SystemStatusPage', () => {
  test('サーバー側の描画時の結果を表示し、再確認の前はブラウザの結果を案内だけにする', async () => {
    await renderPage(SERVER_RESULT, () => Promise.resolve(BROWSER_RESULT));

    await expect.element(serverRegion()).toHaveTextContent(SERVER_TIME_TEXT);
    await expect
      .element(browserRegion().getByRole('status'))
      .toHaveTextContent(
        '「再確認」を押すと、ブラウザから確認した結果を表示します。',
      );
  });

  test('サーバー側でAPIサーバーへ到達できなかった結果を区別して表示する', async () => {
    await renderPage(UPSTREAM_UNAVAILABLE, () =>
      Promise.resolve(BROWSER_RESULT),
    );

    await expect
      .element(serverRegion())
      .toHaveTextContent('APIサーバーへ到達できません。');
  });

  test('「再確認」でブラウザから取得し、取得中は再確認中と示し、結果をサーバー側の結果と分けて表示する', async () => {
    const pending = deferred<SystemStatusResult>();
    let calls = 0;
    await renderPage(SERVER_RESULT, () => {
      calls += 1;
      return pending.promise;
    });

    await userEvent.click(recheckButton());

    await expect.element(recheckButton()).toHaveTextContent('再確認中');
    await userEvent.keyboard('{Enter}');
    expect(calls).toBe(1);

    pending.resolve(BROWSER_RESULT);

    await expect.element(browserRegion()).toHaveTextContent(BROWSER_TIME_TEXT);
    await expect.element(browserRegion()).toHaveTextContent('到達できません');
    await expect.element(serverRegion()).toHaveTextContent(SERVER_TIME_TEXT);
    await expect.element(recheckButton()).toHaveTextContent('再確認');
    await expect.element(recheckButton()).not.toHaveAttribute('aria-busy');
  });

  test('ブラウザからの取得そのものが失敗しても、通信の失敗として表示し再び確認できる', async () => {
    let calls = 0;
    await renderPage(SERVER_RESULT, () => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new TypeError('Failed to fetch'))
        : Promise.resolve(BROWSER_RESULT);
    });

    await userEvent.click(recheckButton());

    await expect
      .element(browserRegion())
      .toHaveTextContent('APIサーバーへ到達できません。');

    await userEvent.click(recheckButton());

    await expect.element(browserRegion()).toHaveTextContent(BROWSER_TIME_TEXT);
  });
});
