import { describe, expect, test } from 'bun:test';

import type { AuthenticatedPrincipal } from '../session/session-verifier.ts';
import type {
  DeviceDescriber,
  StoredSession,
  UserSessionStore,
} from './ports.ts';
import {
  type SessionManagement,
  StoreSessionManagement,
} from './session-management.ts';
import { caught, errorShape } from './testing/login-fakes.ts';

const NOW = new Date('2026-11-02T03:04:05.678Z');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const USER_ID = '01JUSER000000000000000000A';

const OTHER_USER_ID = '01JUSER000000000000000000B';

const CURRENT_SESSION_ID = '01JSESSION0000000000000001';

const CHROME_ON_WINDOWS = 'chrome-on-windows';

const SAFARI_ON_IOS = 'safari-on-ios';

const daysAgo = (days: number): Date =>
  new Date(NOW.getTime() - days * MS_PER_DAY);

const session = (
  id: string,
  overrides: Partial<StoredSession> = {},
): StoredSession => ({
  id,
  userId: USER_ID,
  tokenHash: `hash-of-${id}`,
  userAgent: CHROME_ON_WINDOWS,
  createdAt: daysAgo(30),
  lastUsedAt: daysAgo(1),
  absoluteExpiresAt: new Date(daysAgo(30).getTime() + 90 * MS_PER_DAY),
  ...overrides,
});

const userPrincipal = (
  overrides: Partial<AuthenticatedPrincipal> = {},
): AuthenticatedPrincipal => ({
  kind: 'authenticated',
  subjectKind: 'user',
  subjectId: USER_ID,
  sessionId: CURRENT_SESSION_ID,
  ...overrides,
});

// 使わないメソッドを呼んだら失敗させ、ユースケースが想定外のポートに触れたことを検出する
function partialFake<T extends object>(implemented: Partial<T>): T {
  return new Proxy(implemented, {
    get(target, property, receiver) {
      if (Reflect.has(target, property)) {
        return Reflect.get(target, property, receiver) as unknown;
      }
      return () => {
        throw new Error(`セッションの管理では使わない: ${String(property)}`);
      };
    },
  }) as T;
}

function setup(initial: readonly StoredSession[]) {
  let sessions = [...initial];
  const calls: string[] = [];
  const store = partialFake<UserSessionStore>({
    listByUser(userId) {
      calls.push(`listByUser(${userId})`);
      return Promise.resolve(sessions.filter((row) => row.userId === userId));
    },
    deleteOne(userId, sessionId) {
      calls.push(`deleteOne(${userId}, ${sessionId})`);
      const before = sessions.length;
      sessions = sessions.filter(
        (row) => !(row.userId === userId && row.id === sessionId),
      );
      return Promise.resolve(sessions.length < before);
    },
    deleteOthers(userId, keepSessionId) {
      calls.push(`deleteOthers(${userId}, ${keepSessionId})`);
      const before = sessions.length;
      sessions = sessions.filter(
        (row) => row.userId !== userId || row.id === keepSessionId,
      );
      return Promise.resolve(before - sessions.length);
    },
  });
  const describer: DeviceDescriber = {
    describe(userAgent) {
      if (userAgent === CHROME_ON_WINDOWS) {
        return { browserName: 'Chrome', osName: 'Windows' };
      }
      if (userAgent === SAFARI_ON_IOS) {
        return { browserName: 'Safari', osName: 'iOS' };
      }
      return { browserName: null, osName: null };
    },
  };
  const management: SessionManagement = new StoreSessionManagement(
    store,
    describer,
  );
  return {
    management,
    calls,
    remainingIds: (): string[] => sessions.map((row) => row.id),
  };
}

describe('StoreSessionManagement.list', () => {
  test('有効なものだけを最終利用の新しい順に、端末情報と操作している端末の印を付けて返す', async () => {
    const fakes = setup([
      session('01JSESSION00000000000000A1', {
        userAgent: SAFARI_ON_IOS,
        createdAt: daysAgo(5),
        lastUsedAt: daysAgo(3),
      }),
      session(CURRENT_SESSION_ID, {
        createdAt: daysAgo(2),
        lastUsedAt: daysAgo(0),
      }),
      session('01JSESSION00000000000000A2', {
        userAgent: null,
        createdAt: daysAgo(10),
        lastUsedAt: daysAgo(7),
      }),
      session('01JSESSION00000000000000X1', { lastUsedAt: daysAgo(14) }),
      session('01JSESSION00000000000000X2', {
        absoluteExpiresAt: NOW,
        lastUsedAt: daysAgo(0),
      }),
    ]);

    const views = await fakes.management.list(userPrincipal(), NOW);

    expect(views).toEqual([
      {
        id: CURRENT_SESSION_ID,
        browserName: 'Chrome',
        osName: 'Windows',
        createdAt: daysAgo(2),
        lastUsedAt: daysAgo(0),
        current: true,
      },
      {
        id: '01JSESSION00000000000000A1',
        browserName: 'Safari',
        osName: 'iOS',
        createdAt: daysAgo(5),
        lastUsedAt: daysAgo(3),
        current: false,
      },
      {
        id: '01JSESSION00000000000000A2',
        browserName: null,
        osName: null,
        createdAt: daysAgo(10),
        lastUsedAt: daysAgo(7),
        current: false,
      },
    ]);
    expect(fakes.calls).toEqual([`listByUser(${USER_ID})`]);
  });

  test('最終利用が同じなら発行の新しい順に並べる', async () => {
    const fakes = setup([
      session('01JSESSION00000000000000B1', { createdAt: daysAgo(20) }),
      session('01JSESSION00000000000000B2', { createdAt: daysAgo(4) }),
    ]);

    const views = await fakes.management.list(userPrincipal(), NOW);

    expect(views.map((view) => view.id)).toEqual([
      '01JSESSION00000000000000B2',
      '01JSESSION00000000000000B1',
    ]);
  });

  test('他の利用者のセッションを含めない', async () => {
    const fakes = setup([
      session('01JSESSION00000000000000C1'),
      session('01JSESSION00000000000000C2', { userId: OTHER_USER_ID }),
    ]);

    const views = await fakes.management.list(userPrincipal(), NOW);

    expect(views.map((view) => view.id)).toEqual([
      '01JSESSION00000000000000C1',
    ]);
  });

  test('利用者以外の主体には空の一覧を返し、保存先を読まない', async () => {
    const fakes = setup([session(CURRENT_SESSION_ID)]);

    const views = await fakes.management.list(
      userPrincipal({ subjectKind: 'admin' }),
      NOW,
    );

    expect(views).toEqual([]);
    expect(fakes.calls).toEqual([]);
  });
});

describe('StoreSessionManagement.revoke', () => {
  test('自分の別の端末のセッションを削除し、操作している端末ではないと返す', async () => {
    const fakes = setup([
      session(CURRENT_SESSION_ID),
      session('01JSESSION00000000000000D1'),
    ]);

    const result = await fakes.management.revoke(
      userPrincipal(),
      '01JSESSION00000000000000D1',
    );

    expect(result).toEqual({ revokedCurrent: false });
    expect(fakes.remainingIds()).toEqual([CURRENT_SESSION_ID]);
  });

  test('操作している端末のセッションを削除したら、そのことを返す', async () => {
    const fakes = setup([
      session(CURRENT_SESSION_ID),
      session('01JSESSION00000000000000D1'),
    ]);

    const result = await fakes.management.revoke(
      userPrincipal(),
      CURRENT_SESSION_ID,
    );

    expect(result).toEqual({ revokedCurrent: true });
    expect(fakes.remainingIds()).toEqual(['01JSESSION00000000000000D1']);
  });

  test.each([
    ['他の利用者のセッション', '01JSESSION00000000000000E1'],
    ['存在しないセッション', '01JSESSION00000000000000E9'],
  ])('%sはnot_foundで拒否し、削除しない', async (_label, sessionId) => {
    const fakes = setup([
      session(CURRENT_SESSION_ID),
      session('01JSESSION00000000000000E1', { userId: OTHER_USER_ID }),
    ]);

    const error = await caught(
      fakes.management.revoke(userPrincipal(), sessionId),
    );

    expect(errorShape(error)).toEqual({
      kind: 'not_found',
      code: 'not_found',
      message: '対象が見つかりません。',
      status: 404,
      retryAfterSeconds: undefined,
    });
    expect(fakes.remainingIds()).toEqual([
      CURRENT_SESSION_ID,
      '01JSESSION00000000000000E1',
    ]);
    expect(fakes.calls).toEqual([`deleteOne(${USER_ID}, ${sessionId})`]);
  });

  test('利用者以外の主体はnot_foundで拒否し、削除しない', async () => {
    const fakes = setup([session(CURRENT_SESSION_ID)]);

    const error = await caught(
      fakes.management.revoke(
        userPrincipal({ subjectKind: 'admin' }),
        CURRENT_SESSION_ID,
      ),
    );

    expect(error.code).toBe('not_found');
    expect(fakes.calls).toEqual([]);
  });
});

describe('StoreSessionManagement.revokeOthers', () => {
  test('操作している端末以外の自分のセッションをすべて削除し、件数を返す', async () => {
    const fakes = setup([
      session('01JSESSION00000000000000F1'),
      session(CURRENT_SESSION_ID),
      session('01JSESSION00000000000000F2'),
      session('01JSESSION00000000000000F3', { userId: OTHER_USER_ID }),
    ]);

    const count = await fakes.management.revokeOthers(userPrincipal());

    expect(count).toBe(2);
    expect(fakes.remainingIds()).toEqual([
      CURRENT_SESSION_ID,
      '01JSESSION00000000000000F3',
    ]);
    expect(fakes.calls).toEqual([
      `deleteOthers(${USER_ID}, ${CURRENT_SESSION_ID})`,
    ]);
  });

  test('利用者以外の主体には何も削除せず0を返す', async () => {
    const fakes = setup([session(CURRENT_SESSION_ID)]);

    const count = await fakes.management.revokeOthers(
      userPrincipal({ subjectKind: 'admin' }),
    );

    expect(count).toBe(0);
    expect(fakes.calls).toEqual([]);
  });
});
