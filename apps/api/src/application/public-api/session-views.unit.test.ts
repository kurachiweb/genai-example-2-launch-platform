import { describe, expect, test } from 'bun:test';

import { ANONYMOUS_SESSION_VIEW, apiKeySessionView } from './session-views.ts';

const SAMPLE_USER_ID = '01JC0000000000000000000001';
const SAMPLE_KEY_ID = '01JC0000000000000000000002';

describe('ANONYMOUS_SESSION_VIEW', () => {
  test('主体は常に未ログインである', async () => {
    expect(await ANONYMOUS_SESSION_VIEW.principal()).toEqual({
      kind: 'anonymous',
    });
    expect(await ANONYMOUS_SESSION_VIEW.principal()).toEqual({
      kind: 'anonymous',
    });
  });

  test('実行時に書き換えられない', async () => {
    expect(Object.isFrozen(ANONYMOUS_SESSION_VIEW)).toBe(true);
    expect(Object.isFrozen(await ANONYMOUS_SESSION_VIEW.principal())).toBe(
      true,
    );
  });
});

describe('apiKeySessionView', () => {
  test('主体はキーの持ち主の利用者で、セッションIDはキーのIDを入れた疑似の値である', async () => {
    const session = apiKeySessionView({
      userId: SAMPLE_USER_ID,
      keyId: SAMPLE_KEY_ID,
    });

    expect(await session.principal()).toEqual({
      kind: 'authenticated',
      subjectKind: 'user',
      subjectId: SAMPLE_USER_ID,
      sessionId: `api-key:${SAMPLE_KEY_ID}`,
    });
  });

  test('キーごとに別のセッションIDを返す', async () => {
    const first = await apiKeySessionView({
      userId: SAMPLE_USER_ID,
      keyId: SAMPLE_KEY_ID,
    }).principal();
    const second = await apiKeySessionView({
      userId: SAMPLE_USER_ID,
      keyId: '01JC0000000000000000000003',
    }).principal();

    expect(first).not.toEqual(second);
  });

  test('返す主体は実行時に書き換えられない', async () => {
    const principal = await apiKeySessionView({
      userId: SAMPLE_USER_ID,
      keyId: SAMPLE_KEY_ID,
    }).principal();

    expect(Object.isFrozen(principal)).toBe(true);
  });
});
