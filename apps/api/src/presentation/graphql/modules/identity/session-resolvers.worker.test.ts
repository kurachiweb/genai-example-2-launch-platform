import { describe, expect, test } from 'vitest';

import {
  botTokenFor,
  stubExternalServices,
  suspendUser,
} from '../../../../../test/support/identity-graphql-harness.ts';
import {
  ACCOUNT_OPERATIONS,
  codesOf,
  fetchViewer,
  installIdentityGraphQLTest,
  login,
  MY_SESSIONS,
  PASSWORD,
  register,
  REVOKE_OTHER_SESSIONS,
  REVOKE_SESSION,
  SECURITY_OPERATIONS,
} from '../../../../../test/support/identity-graphql-operations.ts';

const { gateway } = installIdentityGraphQLTest([
  ...ACCOUNT_OPERATIONS,
  ...SECURITY_OPERATIONS,
]);

const FIREFOX_ON_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0';

interface SessionSummaryFields {
  readonly id: string;
  readonly browserName: string | null;
  readonly osName: string | null;
  readonly createdAt: string;
  readonly lastUsedAt: string;
  readonly current: boolean;
}

async function loginAgain(email: string, userAgent?: string): Promise<string> {
  const response = await login(
    gateway,
    email,
    PASSWORD,
    userAgent === undefined ? {} : { userAgent },
  );
  if (response.issuedToken === undefined) {
    throw new Error('ログインできませんでした');
  }
  return response.issuedToken;
}

async function listSessions(
  sessionToken: string,
): Promise<readonly SessionSummaryFields[]> {
  const response = await gateway.call<{
    mySessions: readonly SessionSummaryFields[];
  }>(MY_SESSIONS, {}, { sessionToken });
  expect(response.errors).toBeUndefined();
  return response.data?.mySessions ?? [];
}

describe('mySessions', () => {
  test('有効なセッションを新しい順に、端末情報と操作している端末の印付きで返す', async () => {
    stubExternalServices();
    const user = await register(gateway);
    const other = await loginAgain(user.email, FIREFOX_ON_WINDOWS);

    const sessions = await listSessions(user.sessionToken);

    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toMatchObject({
      browserName: 'Firefox',
      osName: 'Windows',
      current: false,
    });
    expect(sessions[1]).toMatchObject({
      browserName: null,
      osName: null,
      current: true,
    });
    expect(new Date(sessions[0]?.lastUsedAt ?? '').toISOString()).toBe(
      sessions[0]?.lastUsedAt,
    );
    expect((await listSessions(other)).map(({ current }) => current)).toEqual([
      true,
      false,
    ]);
  });

  test('停止中の利用者も自分のセッションを見られる', async () => {
    stubExternalServices();
    const user = await register(gateway);
    await suspendUser(user.viewer.id);

    const sessions = await listSessions(user.sessionToken);

    expect(sessions).toEqual([expect.objectContaining({ current: true })]);
  });

  test('未ログインならログインを求める', async () => {
    const response = await gateway.call(MY_SESSIONS, {});

    expect(codesOf(response)).toEqual(['unauthenticated']);
  });
});

describe('revokeSession', () => {
  test('他の端末のセッションを失効させても、操作している端末のCookieは消さない', async () => {
    stubExternalServices();
    const user = await register(gateway);
    const other = await loginAgain(user.email);
    const target = (await listSessions(user.sessionToken)).find(
      ({ current }) => !current,
    );

    const response = await gateway.call(
      REVOKE_SESSION,
      { id: target?.id },
      { sessionToken: user.sessionToken },
    );

    expect(response.data).toEqual({ revokeSession: true });
    expect(response.cleared).toBe(false);
    expect((await fetchViewer(gateway, other)).data).toEqual({ viewer: null });
    const kept = await fetchViewer(gateway, user.sessionToken);
    expect(kept.data?.viewer?.id).toBe(user.viewer.id);
  });

  test('操作している端末のセッションを失効させたら、Cookieの失効を指示する', async () => {
    stubExternalServices();
    const user = await register(gateway);
    const [current] = await listSessions(user.sessionToken);

    const response = await gateway.call(
      REVOKE_SESSION,
      { id: current?.id },
      { sessionToken: user.sessionToken },
    );

    expect(response.data).toEqual({ revokeSession: true });
    expect(response.cleared).toBe(true);
    expect((await fetchViewer(gateway, user.sessionToken)).data).toEqual({
      viewer: null,
    });
  });

  test('他人・不明のセッションは、対象が見つからないとして拒否する', async () => {
    stubExternalServices();
    const user = await register(gateway);
    const stranger = await register(gateway);
    const [strangerSession] = await listSessions(stranger.sessionToken);

    const others = await gateway.call(
      REVOKE_SESSION,
      { id: strangerSession?.id },
      { sessionToken: user.sessionToken },
    );
    const unknown = await gateway.call(
      REVOKE_SESSION,
      { id: 'unknown-session' },
      { sessionToken: user.sessionToken },
    );

    expect(codesOf(others)).toEqual(['not_found']);
    expect(others.errors?.[0]?.message).toBe('対象が見つかりません。');
    expect(codesOf(unknown)).toEqual(['not_found']);
    const kept = await fetchViewer(gateway, stranger.sessionToken);
    expect(kept.data?.viewer?.id).toBe(stranger.viewer.id);
  });
});

describe('revokeOtherSessions', () => {
  test('操作している端末以外のセッションをすべて失効させ、件数を返す', async () => {
    stubExternalServices();
    const user = await register(gateway);
    const others = [await loginAgain(user.email), await loginAgain(user.email)];

    const response = await gateway.call(
      REVOKE_OTHER_SESSIONS,
      {},
      { sessionToken: user.sessionToken },
    );

    expect(response.data).toEqual({ revokeOtherSessions: 2 });
    expect(response.cleared).toBe(false);
    for (const token of others) {
      expect((await fetchViewer(gateway, token)).data).toEqual({
        viewer: null,
      });
    }
    expect(await listSessions(user.sessionToken)).toEqual([
      expect.objectContaining({ current: true }),
    ]);
  });

  test('管理者側の呼び出し元からの要求は、forbiddenで拒否する', async () => {
    const response = await gateway.call(
      REVOKE_OTHER_SESSIONS,
      {},
      { caller: 'admin', botToken: botTokenFor('login') },
    );

    expect(codesOf(response)).toEqual(['forbidden']);
  });
});
