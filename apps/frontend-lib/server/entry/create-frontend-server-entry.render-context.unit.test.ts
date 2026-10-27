import { afterEach, describe, expect, test } from 'bun:test';

import { resetSync } from '@logtape/logtape';

import {
  ADMIN_TEST_PROFILE,
  createHarness,
  type Harness,
  pageRequest,
} from '../../test/server-entry-fixtures.ts';

afterEach(() => {
  resetSync();
});

const onlyContextOf = (harness: Harness) => {
  const [call] = harness.startCalls;
  if (harness.startCalls.length !== 1 || call === undefined) {
    throw new Error('描画は1回だけ呼ばれることを期待した');
  }
  return call.context;
};

describe('createFrontendServerEntry(描画中のGraphQLの実行に渡す値)', () => {
  test('ログのカテゴリに使う呼び出し元の種類をアプリのプロファイルから渡す', async () => {
    const client = createHarness();
    const admin = createHarness({ profile: ADMIN_TEST_PROFILE });

    await client.fetch(pageRequest());
    await admin.fetch(pageRequest());

    expect(onlyContextOf(client).caller).toBe('client');
    expect(onlyContextOf(admin).caller).toBe('admin');
  });

  test('描画中の想定外の失敗を、中継と同じ送信の関数へ渡す', async () => {
    const harness = createHarness();
    await harness.fetch(pageRequest());
    const failure = new Error('描画中のAPIの失敗');

    onlyContextOf(harness).reportUnexpected(failure);

    expect(harness.reported).toEqual([failure]);
  });
});
