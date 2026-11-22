import { describe, expect, mock, test } from 'bun:test';

import { dashboardCardStateOf } from './dashboard-card-state.ts';

const FAILURE = new Error('取得の失敗');

describe('dashboardCardStateOf', () => {
  test('値があれば、取り直しの失敗の後や取り直しの間でも本文を示す', () => {
    const refetch = mock(() => undefined);

    expect(
      dashboardCardStateOf({
        hasData: true,
        error: FAILURE,
        isFetching: false,
        refetch,
      }),
    ).toStrictEqual({ status: 'success' });
    expect(
      dashboardCardStateOf({
        hasData: true,
        error: null,
        isFetching: true,
        refetch,
      }),
    ).toStrictEqual({ status: 'success' });
  });

  test('値が無く失敗も無い間と、失敗の後に取り直している間は読み込み中を示す', () => {
    const refetch = mock(() => undefined);

    expect(
      dashboardCardStateOf({
        hasData: false,
        error: null,
        isFetching: true,
        refetch,
      }),
    ).toStrictEqual({ status: 'pending' });
    expect(
      dashboardCardStateOf({
        hasData: false,
        error: FAILURE,
        isFetching: true,
        refetch,
      }),
    ).toStrictEqual({ status: 'pending' });
  });

  test('値が無いまま失敗したら、失敗と取り直す再試行を示す', () => {
    const refetch = mock(() => Promise.resolve());

    const state = dashboardCardStateOf({
      hasData: false,
      error: FAILURE,
      isFetching: false,
      refetch,
    });

    expect(state).toMatchObject({ status: 'error', error: FAILURE });
    if (state.status !== 'error') {
      throw new Error('失敗の状態になりませんでした。');
    }
    state.retry();
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
