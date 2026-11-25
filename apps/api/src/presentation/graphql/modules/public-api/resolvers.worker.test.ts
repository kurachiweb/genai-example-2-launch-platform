import { describe, expect, test } from 'vitest';

import { T0 } from '../../../../../lib/workers/identity/testing/identity-store-fixtures.ts';
import {
  apiKeyIdOf,
  insertApiKey,
} from '../../../../../lib/workers/public-api/testing/api-key-fixtures.ts';
import {
  type ApiKeyInputVariables,
  type ApiKeyScopesFields,
  codesOf,
  deleteApiKey,
  detailsOf,
  fetchMyApiKeys,
  fetchMyApiKeysDefaultPage,
  freshApiKeyUser,
  installPublicApiGraphQLTest,
  issueApiKey,
  issueUserSession,
  reactivateUser,
  readApiKeyRowsOf,
  reissueApiKey,
  updateApiKey,
} from '../../../../../test/support/public-api-graphql-operations.ts';
import type { GatewayCallOptions } from '../../../../../test/support/graphql-gateway.ts';

const recording = installPublicApiGraphQLTest();

const PLAIN_KEY_PATTERN = /^lsk_[A-Za-z0-9_-]{43}$/;

const VALIDATION_MESSAGE = '入力内容を確認してください。';

const NOT_FOUND_MESSAGE = 'APIキーが見つかりません。';

const FIXTURE_SCOPES: ApiKeyScopesFields = Object.freeze({
  products: 'READ',
  launches: 'READ',
  upvotes: 'READ',
  comments: 'READ',
  ratings: 'READ',
  profile: 'NONE',
  productDescriptions: 'NONE',
});

const WRITE_SCOPES: ApiKeyScopesFields = Object.freeze({
  products: 'READ',
  launches: 'NONE',
  upvotes: 'READ',
  comments: 'NONE',
  ratings: 'READ',
  profile: 'READ_WRITE',
  productDescriptions: 'READ',
});

const ISSUE_INPUT: ApiKeyInputVariables = Object.freeze({
  name: '  集計ツール  ',
  scopes: WRITE_SCOPES,
});

const SUSPENDED_COLUMNS = {
  emailVerifiedAt: T0,
  status: 'suspended',
  suspendedAt: T0,
} as const;

async function sessionOf(userIndex: number) {
  return { sessionToken: await issueUserSession(userIndex) };
}

const keyAt = (minutes: number) => ({
  createdAt: new Date(T0.getTime() + minutes * 60_000),
});

function loggedText(): string {
  return JSON.stringify(recording.logs());
}

// 発行の回数の消費を確かめるため、停止中の拒否の後に停止を解除して上限まで発行する
async function expectFullIssueAllowance(
  userIndex: number,
  session: { readonly sessionToken: string },
): Promise<void> {
  await reactivateUser(userIndex);
  const responses = [];
  for (let count = 0; count < 3; count += 1) {
    responses.push(await issueApiKey(ISSUE_INPUT, session));
  }
  expect(responses.map((response) => codesOf(response))).toEqual([[], [], []]);
}

describe('呼び出し元の制限', () => {
  const OPERATIONS = [
    {
      operation: 'myApiKeys',
      call: (session: GatewayCallOptions) =>
        fetchMyApiKeys({ first: 10 }, session),
    },
    {
      operation: 'issueApiKey',
      call: (session: GatewayCallOptions) => issueApiKey(ISSUE_INPUT, session),
    },
    {
      operation: 'updateApiKey',
      call: (session: GatewayCallOptions) =>
        updateApiKey({ id: apiKeyIdOf(1), input: ISSUE_INPUT }, session),
    },
    {
      operation: 'reissueApiKey',
      call: (session: GatewayCallOptions) =>
        reissueApiKey(apiKeyIdOf(1), session),
    },
    {
      operation: 'deleteApiKey',
      call: (session: GatewayCallOptions) =>
        deleteApiKey(apiKeyIdOf(1), session),
    },
  ];

  test.each(OPERATIONS)(
    '$operationは呼び出し元が利用者側でなければforbiddenで拒否し、キーを変えない',
    async ({ call }) => {
      const owner = await freshApiKeyUser();
      await insertApiKey(1, owner);
      const [before] = await readApiKeyRowsOf(owner);

      const response = await call({
        ...(await sessionOf(owner)),
        caller: 'admin',
      });

      expect(codesOf(response)).toEqual(['forbidden']);
      expect(response.data).toBeNull();
      expect(await readApiKeyRowsOf(owner)).toEqual([before]);
    },
  );
});

describe('myApiKeys', () => {
  test('ログインしていなければunauthenticatedで拒否する', async () => {
    const response = await fetchMyApiKeys({ first: 10 });

    expect(codesOf(response)).toEqual(['unauthenticated']);
  });

  test('自分のキーだけを発行の新しい順に、名前・権限スコープ・発行日時とともに続きのカーソルで返す', async () => {
    const owner = await freshApiKeyUser();
    const other = await freshApiKeyUser();
    await insertApiKey(1, owner, keyAt(1));
    await insertApiKey(2, owner, {
      ...keyAt(3),
      scopeProfile: 'read_write',
    });
    await insertApiKey(3, other, keyAt(2));
    await insertApiKey(4, owner, keyAt(2));
    const session = await sessionOf(owner);

    const first = await fetchMyApiKeys({ first: 2 }, session);
    const rest = await fetchMyApiKeys(
      { first: 2, after: first.data?.myApiKeys?.pageInfo.endCursor ?? null },
      session,
    );

    expect(first.errors).toBeUndefined();
    expect(first.data?.myApiKeys?.nodes).toEqual([
      {
        id: apiKeyIdOf(2),
        name: 'キー2',
        scopes: { ...FIXTURE_SCOPES, profile: 'READ_WRITE' },
        createdAt: keyAt(3).createdAt.toISOString(),
      },
      {
        id: apiKeyIdOf(4),
        name: 'キー4',
        scopes: FIXTURE_SCOPES,
        createdAt: keyAt(2).createdAt.toISOString(),
      },
    ]);
    expect(first.data?.myApiKeys?.pageInfo.hasNextPage).toBe(true);
    expect(rest.data?.myApiKeys?.nodes.map(({ id }) => id)).toEqual([
      apiKeyIdOf(1),
    ]);
    expect(rest.data?.myApiKeys?.pageInfo).toEqual({
      hasNextPage: false,
      endCursor: expect.any(String) as string,
    });
  });

  test('件数を省略すると50件ずつ返す', async () => {
    const owner = await freshApiKeyUser();
    for (let index = 1; index <= 51; index += 1) {
      await insertApiKey(index, owner, keyAt(index));
    }

    const response = await fetchMyApiKeysDefaultPage(await sessionOf(owner));

    expect(response.data?.myApiKeys?.nodes).toHaveLength(50);
    expect(response.data?.myApiKeys?.pageInfo.hasNextPage).toBe(true);
  });

  test('停止中の利用者にも自分のキーの一覧を返す', async () => {
    const owner = await freshApiKeyUser(SUSPENDED_COLUMNS);
    await insertApiKey(1, owner);

    const response = await fetchMyApiKeys(
      { first: 10 },
      await sessionOf(owner),
    );

    expect(response.errors).toBeUndefined();
    expect(response.data?.myApiKeys?.nodes.map(({ id }) => id)).toEqual([
      apiKeyIdOf(1),
    ]);
  });

  test.each([0, 51])(
    '件数が1〜50の外(%i)ならfirstの欄のvalidation_errorで拒否する',
    async (first) => {
      const owner = await freshApiKeyUser();

      const response = await fetchMyApiKeys({ first }, await sessionOf(owner));

      expect(codesOf(response)).toEqual(['validation_error']);
      expect(response.errors?.[0]?.message).toBe(VALIDATION_MESSAGE);
      expect(detailsOf(response)).toEqual([
        {
          field: 'first',
          code: expect.any(String) as string,
          message: '表示する件数は1〜50件の整数で指定してください。',
        },
      ]);
    },
  );

  test('形式に合わないカーソルはinvalid_cursorで拒否する', async () => {
    const owner = await freshApiKeyUser();

    const response = await fetchMyApiKeys(
      { first: 10, after: 'not-a-cursor' },
      await sessionOf(owner),
    );

    expect(codesOf(response)).toEqual(['invalid_cursor']);
  });
});

describe('issueApiKey', () => {
  test('ログインしていなければunauthenticatedで拒否する', async () => {
    const response = await issueApiKey(ISSUE_INPUT);

    expect(codesOf(response)).toEqual(['unauthenticated']);
  });

  test('停止中の利用者はユースケースへ渡さずにaccount_unavailableで拒否し、保存せず発行の回数も消費しない', async () => {
    const owner = await freshApiKeyUser(SUSPENDED_COLUMNS);
    const session = await sessionOf(owner);

    const response = await issueApiKey(ISSUE_INPUT, session);

    expect(codesOf(response)).toEqual(['account_unavailable']);
    expect(await readApiKeyRowsOf(owner)).toEqual([]);
    await expectFullIssueAllowance(owner, session);
  });

  test('メールアドレスが未確認の利用者にも、前後の空白を除いた名前と権限スコープのキーを発行し、平文を応答でだけ返す', async () => {
    const owner = await freshApiKeyUser({});

    const response = await issueApiKey(ISSUE_INPUT, await sessionOf(owner));

    expect(response.errors).toBeUndefined();
    const issued = response.data?.issueApiKey;
    expect(issued?.plainKey).toMatch(PLAIN_KEY_PATTERN);
    expect(issued?.apiKey).toEqual({
      id: expect.any(String) as string,
      name: '集計ツール',
      scopes: WRITE_SCOPES,
      createdAt: expect.any(String) as string,
    });
    const rows = await readApiKeyRowsOf(owner);
    expect(rows.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: issued?.apiKey.id, name: '集計ツール' },
    ]);
    expect(JSON.stringify(rows)).not.toContain(issued?.plainKey);
    expect(loggedText()).not.toContain(issued?.plainKey);
  });

  test.each([
    { name: '  　 ', code: 'required', message: '名前を入力してください。' },
    {
      name: '🔑'.repeat(51),
      code: 'too_long',
      message: '名前は50文字以内で入力してください。',
    },
  ])(
    '名前が$codeの誤りならinput.nameの欄のvalidation_errorで拒否し、発行の回数に数えない',
    async ({ name, code, message }) => {
      const owner = await freshApiKeyUser();
      const session = await sessionOf(owner);

      const rejected = await issueApiKey({ ...ISSUE_INPUT, name }, session);
      const issued = [];
      for (let count = 0; count < 3; count += 1) {
        issued.push(await issueApiKey(ISSUE_INPUT, session));
      }

      expect(codesOf(rejected)).toEqual(['validation_error']);
      expect(rejected.errors?.[0]?.message).toBe(VALIDATION_MESSAGE);
      expect(detailsOf(rejected)).toEqual([
        { field: 'input.name', code, message },
      ]);
      expect(issued.map((response) => response.errors)).toEqual([
        undefined,
        undefined,
        undefined,
      ]);
    },
  );

  test('読み取りだけの機能に読み書きを指定すると、変数の型の誤りで拒否し保存しない', async () => {
    const owner = await freshApiKeyUser();

    const response = await issueApiKey(
      {
        ...ISSUE_INPUT,
        scopes: {
          ...WRITE_SCOPES,
          products: 'READ_WRITE' as ApiKeyScopesFields['products'],
        },
      },
      await sessionOf(owner),
    );

    expect(response.status).toBe(400);
    expect(codesOf(response)).toEqual(['graphql_request_invalid']);
    expect(await readApiKeyRowsOf(owner)).toEqual([]);
  });

  test('同じ利用者の3回目まで発行し、4回目は429のrate_limit_exceededと再試行までの秒数で拒否して保存しない', async () => {
    const owner = await freshApiKeyUser();
    const session = await sessionOf(owner);

    const accepted = [];
    for (let count = 0; count < 3; count += 1) {
      accepted.push(await issueApiKey(ISSUE_INPUT, session));
    }
    const rejected = await issueApiKey(ISSUE_INPUT, session);

    expect(accepted.map((response) => codesOf(response))).toEqual([[], [], []]);
    expect(rejected.status).toBe(429);
    expect(codesOf(rejected)).toEqual(['rate_limit_exceeded']);
    expect(Number(rejected.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await readApiKeyRowsOf(owner)).toHaveLength(3);
  });
});

describe('updateApiKey', () => {
  test('ログインしていなければunauthenticatedで拒否する', async () => {
    const response = await updateApiKey({
      id: apiKeyIdOf(1),
      input: ISSUE_INPUT,
    });

    expect(codesOf(response)).toEqual(['unauthenticated']);
  });

  test('停止中の利用者はaccount_unavailableで拒否し、キーを変えない', async () => {
    const owner = await freshApiKeyUser(SUSPENDED_COLUMNS);
    await insertApiKey(1, owner);

    const response = await updateApiKey(
      { id: apiKeyIdOf(1), input: ISSUE_INPUT },
      await sessionOf(owner),
    );

    expect(codesOf(response)).toEqual(['account_unavailable']);
    const [row] = await readApiKeyRowsOf(owner);
    expect(row?.name).toBe('キー1');
  });

  test('自分のキーの名前と権限スコープを変え、発行日時を保ち、平文を返さない', async () => {
    const owner = await freshApiKeyUser();
    await insertApiKey(1, owner);
    const [before] = await readApiKeyRowsOf(owner);

    const response = await updateApiKey(
      { id: apiKeyIdOf(1), input: ISSUE_INPUT },
      await sessionOf(owner),
    );

    expect(response.errors).toBeUndefined();
    expect(response.data?.updateApiKey).toEqual({
      id: apiKeyIdOf(1),
      name: '集計ツール',
      scopes: WRITE_SCOPES,
      createdAt: T0.toISOString(),
    });
    const [after] = await readApiKeyRowsOf(owner);
    expect(after?.name).toBe('集計ツール');
    expect(after?.scopeProfile).toBe('read_write');
    expect(after?.keyHash).toBe(before?.keyHash);
  });

  test('名前の誤りはinput.nameの欄のvalidation_errorで拒否する', async () => {
    const owner = await freshApiKeyUser();
    await insertApiKey(1, owner);

    const response = await updateApiKey(
      { id: apiKeyIdOf(1), input: { ...ISSUE_INPUT, name: '' } },
      await sessionOf(owner),
    );

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      {
        field: 'input.name',
        code: 'required',
        message: '名前を入力してください。',
      },
    ]);
  });

  test.each([
    { label: '他の利用者のキー', index: 2 },
    { label: '存在しないキー', index: 99 },
  ])('$labelは区別せずにapi_key_not_foundで拒否する', async ({ index }) => {
    const owner = await freshApiKeyUser();
    const other = await freshApiKeyUser();
    await insertApiKey(1, owner);
    await insertApiKey(2, other);

    const response = await updateApiKey(
      { id: apiKeyIdOf(index), input: ISSUE_INPUT },
      await sessionOf(owner),
    );

    expect(codesOf(response)).toEqual(['api_key_not_found']);
    expect(response.errors?.[0]?.message).toBe(NOT_FOUND_MESSAGE);
    const [row] = await readApiKeyRowsOf(other);
    expect(row?.name).toBe('キー2');
  });

  test('形式に合わないIDは見つからない旨の文言のidの欄のvalidation_errorで拒否する', async () => {
    const owner = await freshApiKeyUser();

    const response = await updateApiKey(
      { id: 'not-an-id', input: ISSUE_INPUT },
      await sessionOf(owner),
    );

    expect(codesOf(response)).toEqual(['validation_error']);
    expect(detailsOf(response)).toEqual([
      {
        field: 'id',
        code: expect.any(String) as string,
        message: NOT_FOUND_MESSAGE,
      },
    ]);
  });
});

describe('reissueApiKey', () => {
  test('ログインしていなければunauthenticatedで拒否する', async () => {
    const response = await reissueApiKey(apiKeyIdOf(1));

    expect(codesOf(response)).toEqual(['unauthenticated']);
  });

  test('停止中の利用者はユースケースへ渡さずにaccount_unavailableで拒否し、キーを加えず発行の回数も消費しない', async () => {
    const owner = await freshApiKeyUser(SUSPENDED_COLUMNS);
    await insertApiKey(1, owner);
    const session = await sessionOf(owner);

    const response = await reissueApiKey(apiKeyIdOf(1), session);

    expect(codesOf(response)).toEqual(['account_unavailable']);
    expect(await readApiKeyRowsOf(owner)).toHaveLength(1);
    await expectFullIssueAllowance(owner, session);
  });

  test.each([
    { label: '他の利用者のキー', index: 2 },
    { label: '存在しないキー', index: 99 },
  ])(
    '$labelは区別せずにapi_key_not_foundで拒否し、キーを加えない',
    async ({ index }) => {
      const owner = await freshApiKeyUser();
      const other = await freshApiKeyUser();
      await insertApiKey(2, other);

      const response = await reissueApiKey(
        apiKeyIdOf(index),
        await sessionOf(owner),
      );

      expect(codesOf(response)).toEqual(['api_key_not_found']);
      expect(response.errors?.[0]?.message).toBe(NOT_FOUND_MESSAGE);
      expect(await readApiKeyRowsOf(owner)).toEqual([]);
      expect(await readApiKeyRowsOf(other)).toHaveLength(1);
    },
  );

  test('元のキーと同じ名前と権限スコープの新しいキーを加えて平文を返し、元のキーを残す', async () => {
    const owner = await freshApiKeyUser();
    await insertApiKey(1, owner, { scopeProductDescriptions: 'read_write' });
    const session = await sessionOf(owner);

    const response = await reissueApiKey(apiKeyIdOf(1), session);
    const list = await fetchMyApiKeys({ first: 10 }, session);

    expect(response.errors).toBeUndefined();
    const issued = response.data?.reissueApiKey;
    expect(issued?.plainKey).toMatch(PLAIN_KEY_PATTERN);
    expect(issued?.apiKey).toEqual({
      id: expect.any(String) as string,
      name: 'キー1',
      scopes: { ...FIXTURE_SCOPES, productDescriptions: 'READ_WRITE' },
      createdAt: expect.any(String) as string,
    });
    expect(issued?.apiKey.id).not.toBe(apiKeyIdOf(1));
    expect(list.data?.myApiKeys?.nodes.map(({ id }) => id)).toEqual([
      issued?.apiKey.id,
      apiKeyIdOf(1),
    ]);
    expect(JSON.stringify(list.data)).not.toContain(issued?.plainKey);
    expect(loggedText()).not.toContain(issued?.plainKey);
  });

  test('再発行も発行の回数に数え、発行2回と再発行1回の後の再発行は429のrate_limit_exceededで拒否する', async () => {
    const owner = await freshApiKeyUser();
    await insertApiKey(1, owner);
    const session = await sessionOf(owner);
    await issueApiKey(ISSUE_INPUT, session);
    await issueApiKey(ISSUE_INPUT, session);
    const third = await reissueApiKey(apiKeyIdOf(1), session);

    const fourth = await reissueApiKey(apiKeyIdOf(1), session);

    expect(third.errors).toBeUndefined();
    expect(fourth.status).toBe(429);
    expect(codesOf(fourth)).toEqual(['rate_limit_exceeded']);
    expect(Number(fourth.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await readApiKeyRowsOf(owner)).toHaveLength(4);
  });
});

describe('deleteApiKey', () => {
  test('ログインしていなければunauthenticatedで拒否する', async () => {
    const response = await deleteApiKey(apiKeyIdOf(1));

    expect(codesOf(response)).toEqual(['unauthenticated']);
  });

  test('停止中の利用者にも自分のキーの削除を許し、削除したキーのIDを返す', async () => {
    const owner = await freshApiKeyUser(SUSPENDED_COLUMNS);
    await insertApiKey(1, owner);
    await insertApiKey(2, owner);

    const response = await deleteApiKey(apiKeyIdOf(1), await sessionOf(owner));

    expect(response.errors).toBeUndefined();
    expect(response.data?.deleteApiKey).toBe(apiKeyIdOf(1));
    expect((await readApiKeyRowsOf(owner)).map(({ id }) => id)).toEqual([
      apiKeyIdOf(2),
    ]);
  });

  test.each([
    { label: '他の利用者のキー', index: 2 },
    { label: '存在しないキー', index: 99 },
  ])('$labelは区別せずにapi_key_not_foundで拒否する', async ({ index }) => {
    const owner = await freshApiKeyUser();
    const other = await freshApiKeyUser();
    await insertApiKey(2, other);

    const response = await deleteApiKey(
      apiKeyIdOf(index),
      await sessionOf(owner),
    );

    expect(codesOf(response)).toEqual(['api_key_not_found']);
    expect(await readApiKeyRowsOf(other)).toHaveLength(1);
  });
});
