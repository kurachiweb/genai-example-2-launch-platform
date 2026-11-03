import { describe, expect, test } from 'bun:test';
import { Container } from 'inversify';

import type {
  HashPurpose,
  KeyedHasher,
} from '../../../lib/core/crypto/keyed-hasher.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import { USER_SESSION_POLICY } from '../../domain/auth/session-policy.ts';
import { AUTH_TYPES } from '../auth/auth-types.ts';
import type { SecretGenerator } from '../auth/ports.ts';
import {
  HashingSecretIssuer,
  type SecretIssuer,
} from '../auth/secret-issuer.ts';
import {
  MAX_SESSION_MAX_AGE_SECONDS,
  type Principal,
  SESSION_TOKEN_PATTERN,
} from '../session/session-verifier.ts';
import { IDENTITY_TYPES } from './identity-types.ts';
import type {
  NewSessionRecord,
  StoredSession,
  UserSessionStore,
} from './ports.ts';
import type { RequestMeta } from './request-meta.ts';
import {
  SESSION_USER_AGENT_MAX_LENGTH,
  type SessionIssuer,
  StoreSessionIssuer,
  USER_SESSION_HASH_PURPOSE,
} from './session-issuer.ts';

const USER_ID = '01JUSER0000000000000000000';
const OTHER_USER_ID = '01JUSER0000000000000000001';
const NOW = new Date('2026-11-02T03:04:05.678Z');
const SECONDS_PER_DAY = 24 * 60 * 60;

function randomToken(): string {
  return crypto
    .getRandomValues(new Uint8Array(32))
    .toBase64({ alphabet: 'base64url', omitPadding: true });
}

interface Recorded {
  readonly inserted: NewSessionRecord[];
}

function createStore(recorded: Recorded): UserSessionStore {
  const unused = (): never => {
    throw new Error('発行では使わない');
  };
  return {
    insert(session) {
      recorded.inserted.push(session);
      return Promise.resolve();
    },
    findByTokenHash: unused,
    touch: unused,
    listByUser: (): Promise<readonly StoredSession[]> => unused(),
    deleteOne: unused,
    deleteOthers: unused,
    deleteExpired: unused,
  };
}

const fakeHasher: KeyedHasher = {
  hash: (purpose: HashPurpose, value: string) =>
    Promise.resolve(`hashed(${purpose}):${value}`),
  verify: () => Promise.resolve(false),
};

function createSecretIssuer(tokens: string[]): SecretIssuer {
  const generator: SecretGenerator = {
    token() {
      const token = randomToken();
      tokens.push(token);
      return token;
    },
    randomString: () => '',
    uuid: () => '',
  };
  return new HashingSecretIssuer(generator, fakeHasher);
}

function createIds(): IdGenerator {
  let sequence = 0;
  return {
    generate: () => `01JSESSION${String(sequence++).padStart(16, '0')}`,
  };
}

function setup() {
  const recorded: Recorded = { inserted: [] };
  const tokens: string[] = [];
  const issuer: SessionIssuer = new StoreSessionIssuer(
    createSecretIssuer(tokens),
    createIds(),
    createStore(recorded),
  );
  return { issuer, recorded, tokens };
}

function metaWith(userAgent: string | undefined): RequestMeta {
  return { clientIp: '192.0.2.1', userAgent, now: NOW };
}

const userPrincipal = (subjectId: string): Principal => ({
  kind: 'authenticated',
  subjectKind: 'user',
  subjectId,
  sessionId: '01JSESSIONOPERATOR00000000',
});

describe('StoreSessionIssuer.issue', () => {
  test('32バイトの乱数のトークンを返し、保存するのは用途user-sessionのハッシュだけにする', async () => {
    const { issuer, recorded, tokens } = setup();

    const issued = await issuer.issue(USER_ID, metaWith('Mozilla/5.0'));

    expect(SESSION_TOKEN_PATTERN.test(issued.token)).toBe(true);
    expect(tokens).toEqual([issued.token]);
    expect(recorded.inserted).toHaveLength(1);
    const [stored] = recorded.inserted;
    expect(stored?.tokenHash).toBe(`hashed(user-session):${issued.token}`);
    expect(Object.values(stored ?? {})).not.toContain(issued.token);
    expect(USER_SESSION_HASH_PURPOSE).toBe('user-session' as HashPurpose);
  });

  test('利用者・発行日時・最終利用日時・絶対期限と識別子を保存し、同じ識別子を返す', async () => {
    const { issuer, recorded } = setup();

    const issued = await issuer.issue(USER_ID, metaWith('Mozilla/5.0'));

    expect(recorded.inserted[0]).toEqual({
      id: issued.sessionId,
      userId: USER_ID,
      tokenHash: `hashed(user-session):${issued.token}`,
      userAgent: 'Mozilla/5.0',
      createdAt: NOW,
      lastUsedAt: NOW,
      absoluteExpiresAt: new Date(
        NOW.getTime() + USER_SESSION_POLICY.absoluteSeconds * 1000,
      ),
    });
  });

  test('Cookieの有効期間はアイドル期限の14日で、発行できる上限を超えない', async () => {
    const { issuer } = setup();

    const issued = await issuer.issue(USER_ID, metaWith(undefined));

    expect(issued.maxAgeSeconds).toBe(14 * SECONDS_PER_DAY);
    expect(issued.maxAgeSeconds).toBeGreaterThanOrEqual(1);
    expect(issued.maxAgeSeconds).toBeLessThanOrEqual(
      MAX_SESSION_MAX_AGE_SECONDS,
    );
  });

  test('発行のたびに別のトークンと識別子になる', async () => {
    const { issuer } = setup();

    const first = await issuer.issue(USER_ID, metaWith(undefined));
    const second = await issuer.issue(USER_ID, metaWith(undefined));

    expect(first.token).not.toBe(second.token);
    expect(first.sessionId).not.toBe(second.sessionId);
  });

  test('User-Agentは512文字までに切って保存する', async () => {
    const { issuer, recorded } = setup();
    const longUserAgent = 'a'.repeat(SESSION_USER_AGENT_MAX_LENGTH + 10);

    await issuer.issue(USER_ID, metaWith(longUserAgent));

    expect(SESSION_USER_AGENT_MAX_LENGTH).toBe(512);
    expect(recorded.inserted[0]?.userAgent).toBe(
      'a'.repeat(SESSION_USER_AGENT_MAX_LENGTH),
    );
  });

  test('ちょうど512文字のUser-Agentはそのまま保存する', async () => {
    const { issuer, recorded } = setup();
    const userAgent = 'b'.repeat(SESSION_USER_AGENT_MAX_LENGTH);

    await issuer.issue(USER_ID, metaWith(userAgent));

    expect(recorded.inserted[0]?.userAgent).toBe(userAgent);
  });

  test.each([
    ['無い', undefined],
    ['空', ''],
  ])('User-Agentが%s場合は値無しで保存する', async (_label, userAgent) => {
    const { issuer, recorded } = setup();

    await issuer.issue(USER_ID, metaWith(userAgent));

    expect(recorded.inserted[0]?.userAgent).toBeNull();
  });

  test('送信元IPアドレスを保存しない', async () => {
    const { issuer, recorded } = setup();

    await issuer.issue(USER_ID, metaWith('Mozilla/5.0'));

    expect(JSON.stringify(recorded.inserted[0])).not.toContain('192.0.2.1');
  });
});

describe('StoreSessionIssuer.reissueForOperator', () => {
  test('操作した端末が同じ利用者としてログイン中なら、その端末のUser-Agentで新しいセッションを発行する', async () => {
    const { issuer, recorded } = setup();

    const issued = await issuer.reissueForOperator(
      USER_ID,
      userPrincipal(USER_ID),
      metaWith('Operator/1.0'),
    );

    expect(issued).toBeDefined();
    expect(SESSION_TOKEN_PATTERN.test(issued?.token ?? '')).toBe(true);
    expect(recorded.inserted).toMatchObject([
      {
        id: issued?.sessionId,
        userId: USER_ID,
        userAgent: 'Operator/1.0',
      },
    ]);
  });

  test('操作した端末が未ログインなら発行しない', async () => {
    const { issuer, recorded } = setup();

    const issued = await issuer.reissueForOperator(
      USER_ID,
      { kind: 'anonymous' },
      metaWith(undefined),
    );

    expect(issued).toBeUndefined();
    expect(recorded.inserted).toEqual([]);
  });

  test('操作した端末が別の利用者としてログイン中なら発行しない', async () => {
    const { issuer, recorded } = setup();

    const issued = await issuer.reissueForOperator(
      USER_ID,
      userPrincipal(OTHER_USER_ID),
      metaWith(undefined),
    );

    expect(issued).toBeUndefined();
    expect(recorded.inserted).toEqual([]);
  });

  test('操作した端末が同じIDの管理者の主体なら発行しない', async () => {
    const { issuer, recorded } = setup();

    const issued = await issuer.reissueForOperator(
      USER_ID,
      {
        kind: 'authenticated',
        subjectKind: 'admin',
        subjectId: USER_ID,
        sessionId: '01JSESSIONADMIN00000000000',
      },
      metaWith(undefined),
    );

    expect(issued).toBeUndefined();
    expect(recorded.inserted).toEqual([]);
  });
});

describe('StoreSessionIssuer の束縛', () => {
  test('コンテナから注入の識別子で解決できる', async () => {
    const recorded: Recorded = { inserted: [] };
    const container = new Container();
    container
      .bind<SecretIssuer>(AUTH_TYPES.SecretIssuer)
      .toConstantValue(createSecretIssuer([]));
    container
      .bind<IdGenerator>(PLATFORM_TYPES.IdGenerator)
      .toConstantValue(createIds());
    container
      .bind<UserSessionStore>(IDENTITY_TYPES.UserSessionStore)
      .toConstantValue(createStore(recorded));
    container
      .bind<SessionIssuer>(IDENTITY_TYPES.SessionIssuer)
      .to(StoreSessionIssuer);

    const issuer = container.get<SessionIssuer>(IDENTITY_TYPES.SessionIssuer);
    await issuer.issue(USER_ID, metaWith(undefined));

    expect(recorded.inserted).toHaveLength(1);
  });
});
