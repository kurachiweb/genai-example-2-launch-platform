import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import {
  environmentManager,
  focusManager,
  QueryClient,
  QueryObserver,
} from '@tanstack/react-query';

import {
  LIVE_REFRESH_INTERVAL_MS,
  LIVE_REFRESH_QUERY_OPTIONS,
} from './live-refresh.ts';

const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 10; turn += 1) {
    await Promise.resolve();
  }
};

// 純粋な関数の層からstartのクライアントの生成を読めないため、アプリの既定値(start/query-client.tsの鮮度30秒・フォーカスで取り直さない)を写したクライアントに重ねる
const APP_QUERY_DEFAULTS = {
  staleTime: 30_000,
  refetchOnWindowFocus: false,
} as const;

// 画面へ戻った時の通知は、アプリの提供の部品と同じくクライアントを結び付けた時だけ届く
const observeLiveQuery = async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: APP_QUERY_DEFAULTS },
  });
  queryClient.mount();
  const queryFn = jest.fn(() => Promise.resolve('メッセージ'));
  const observer = new QueryObserver(queryClient, {
    queryKey: ['live-refresh-test'],
    queryFn,
    ...LIVE_REFRESH_QUERY_OPTIONS,
  });
  const unsubscribe = observer.subscribe(() => undefined);
  await settle();
  return {
    queryFn,
    dispose: () => {
      unsubscribe();
      queryClient.clear();
      queryClient.unmount();
    },
  };
};

describe('定期再取得の共通の値', () => {
  test('間隔は30秒', () => {
    expect(LIVE_REFRESH_INTERVAL_MS).toBe(30_000);
    expect(LIVE_REFRESH_QUERY_OPTIONS.refetchInterval).toBe(
      LIVE_REFRESH_INTERVAL_MS,
    );
  });

  test('非表示のタブでは止め、画面へ戻った時に取り直し、取得した値をすぐ古いものとみなす', () => {
    expect(LIVE_REFRESH_QUERY_OPTIONS).toStrictEqual({
      refetchInterval: 30_000,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: true,
      staleTime: 0,
    });
  });

  test('値を書き換えられない', () => {
    expect(Object.isFrozen(LIVE_REFRESH_QUERY_OPTIONS)).toBe(true);
  });
});

describe('定期再取得の値を重ねた取得', () => {
  const detectedIsServer = environmentManager.isServer();

  beforeEach(() => {
    environmentManager.setIsServer(() => false);
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    focusManager.setFocused(undefined);
    environmentManager.setIsServer(() => detectedIsServer);
  });

  test('表示中は30秒ごとに取り直し、30秒に満たない間は取り直さない', async () => {
    const { queryFn, dispose } = await observeLiveQuery();

    expect(queryFn).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(LIVE_REFRESH_INTERVAL_MS - 1);
    await settle();
    expect(queryFn).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    await settle();
    expect(queryFn).toHaveBeenCalledTimes(2);
    jest.advanceTimersByTime(LIVE_REFRESH_INTERVAL_MS);
    await settle();
    expect(queryFn).toHaveBeenCalledTimes(3);
    dispose();
  });

  test('タブが非表示の間は30秒を過ぎても取り直さない', async () => {
    const { queryFn, dispose } = await observeLiveQuery();

    focusManager.setFocused(false);
    jest.advanceTimersByTime(LIVE_REFRESH_INTERVAL_MS * 3);
    await settle();

    expect(queryFn).toHaveBeenCalledTimes(1);
    dispose();
  });

  test('画面へ戻った時は、アプリの既定の鮮度の30秒に満たなくても取り直す', async () => {
    const { queryFn, dispose } = await observeLiveQuery();

    focusManager.setFocused(false);
    jest.advanceTimersByTime(1_000);
    focusManager.setFocused(true);
    await settle();

    expect(queryFn).toHaveBeenCalledTimes(2);
    dispose();
  });
});
