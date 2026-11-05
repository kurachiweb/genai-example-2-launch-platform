import { describe, expect, test } from 'bun:test';
import { Container } from 'inversify';

import type {
  HashPurpose,
  KeyedHasher,
} from '../../../lib/core/crypto/keyed-hasher.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import type { Principal } from '../../../lib/core/session/session-view.ts';
import { ADMIN_SESSION_POLICY } from '../../domain/admin/admin-session-policy.ts';
import { AUTH_TYPES } from '../auth/auth-types.ts';
import type { SecretGenerator } from '../auth/ports.ts';
import {
  HashingSecretIssuer,
  type SecretIssuer,
} from '../auth/secret-issuer.ts';
import { SESSION_TOKEN_PATTERN } from '../session/session-verifier.ts';
import {
  ADMIN_SESSION_USER_AGENT_MAX_LENGTH,
  type AdminSessionIssuer,
  prepareAdminSession,
  StoreAdminSessionIssuer,
} from './admin-session-issuer.ts';
import { ADMIN_TYPES } from './admin-types.ts';
import type {
  AdminRequestMeta,
  AdminSessionStore,
  NewAdminSessionRecord,
} from './ports.ts';

const ADMIN_ID = '01JADMIN000000000000000000';
const OTHER_ADMIN_ID = '01JADMIN000000000000000001';
const NOW = new Date('2026-11-02T03:04:05.678Z');
const MS_PER_SECOND = 1000;

function randomToken(): string {
  return crypto
    .getRandomValues(new Uint8Array(32))
    .toBase64({ alphabet: 'base64url', omitPadding: true });
}

interface Recorded {
  readonly inserted: NewAdminSessionRecord[];
}

function createStore(recorded: Recorded): AdminSessionStore {
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
    deleteOne: unused,
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
    generate: () => `01JASESSION${String(sequence++).padStart(15, '0')}`,
  };
}

function setup() {
  const recorded: Recorded = { inserted: [] };
  const tokens: string[] = [];
  const issuer: AdminSessionIssuer = new StoreAdminSessionIssuer(
    createSecretIssuer(tokens),
    createIds(),
    createStore(recorded),
  );
  return { issuer, recorded, tokens };
}

function metaWith(userAgent: string | undefined): AdminRequestMeta {
  return { clientIp: '192.0.2.1', userAgent, now: NOW };
}

const principalOf = (
  subjectKind: 'user' | 'admin',
  subjectId: string,
): Principal => ({
  kind: 'authenticated',
  subjectKind,
  subjectId,
  sessionId: '01JASESSIONOPERATOR0000000',
});

describe('StoreAdminSessionIssuer.issue', () => {
  test('32バイトの乱数のトークンを返し、保存するのは用途admin-sessionのハッシュだけにする', async () => {
    const { issuer, recorded, tokens } = setup();

    const issued = await issuer.issue(ADMIN_ID, metaWith('Mozilla/5.0'));

    expect(SESSION_TOKEN_PATTERN.test(issued.token)).toBe(true);
    expect(tokens).toEqual([issued.token]);
    expect(recorded.inserted).toHaveLength(1);
    const [stored] = recorded.inserted;
    expect(stored?.tokenHash).toBe(`hashed(admin-session):${issued.token}`);
    expect(Object.values(stored ?? {})).not.toContain(issued.token);
  });

  test('管理者・発行日時・最終利用日時・発行から12時間の絶対期限と識別子を保存し、同じ識別子を返す', async () => {
    const { issuer, recorded } = setup();

    const issued = await issuer.issue(ADMIN_ID, metaWith('Mozilla/5.0'));

    expect(recorded.inserted[0]).toEqual({
      id: issued.sessionId,
      adminId: ADMIN_ID,
      tokenHash: `hashed(admin-session):${issued.token}`,
      userAgent: 'Mozilla/5.0',
      createdAt: NOW,
      lastUsedAt: NOW,
      absoluteExpiresAt: new Date(NOW.getTime() + 12 * 60 * 60 * MS_PER_SECOND),
    });
  });

  test('Cookieの有効期間はアイドル期限の1時間にする', async () => {
    const { issuer } = setup();

    const issued = await issuer.issue(ADMIN_ID, metaWith(undefined));

    expect(issued.maxAgeSeconds).toBe(ADMIN_SESSION_POLICY.idleSeconds);
    expect(issued.maxAgeSeconds).toBe(60 * 60);
  });

  test('発行のたびに別のトークンと識別子になる', async () => {
    const { issuer } = setup();

    const first = await issuer.issue(ADMIN_ID, metaWith(undefined));
    const second = await issuer.issue(ADMIN_ID, metaWith(undefined));

    expect(first.token).not.toBe(second.token);
    expect(first.sessionId).not.toBe(second.sessionId);
  });

  test('User-Agentは512文字までに切って保存する', async () => {
    const { issuer, recorded } = setup();

    await issuer.issue(ADMIN_ID, metaWith('a'.repeat(513)));

    expect(ADMIN_SESSION_USER_AGENT_MAX_LENGTH).toBe(512);
    expect(recorded.inserted[0]?.userAgent).toBe('a'.repeat(512));
  });

  test('ちょうど512文字のUser-Agentはそのまま保存する', async () => {
    const { issuer, recorded } = setup();
    const userAgent = 'b'.repeat(512);

    await issuer.issue(ADMIN_ID, metaWith(userAgent));

    expect(recorded.inserted[0]?.userAgent).toBe(userAgent);
  });

  test.each([
    ['無い', undefined],
    ['空', ''],
  ])('User-Agentが%s場合は値無しで保存する', async (_label, userAgent) => {
    const { issuer, recorded } = setup();

    await issuer.issue(ADMIN_ID, metaWith(userAgent));

    expect(recorded.inserted[0]?.userAgent).toBeNull();
  });

  test('送信元IPアドレスを保存しない', async () => {
    const { issuer, recorded } = setup();

    await issuer.issue(ADMIN_ID, metaWith('Mozilla/5.0'));

    expect(JSON.stringify(recorded.inserted[0])).not.toContain('192.0.2.1');
  });
});

describe('prepareAdminSession', () => {
  test('保存せずに、保存する行と応答に使う発行の内容を同じ識別子とトークンで組み立てる', async () => {
    const tokens: string[] = [];

    const prepared = await prepareAdminSession(
      createSecretIssuer(tokens),
      createIds(),
      ADMIN_ID,
      metaWith('Mozilla/5.0'),
    );

    expect(prepared.record.id).toBe(prepared.issued.sessionId);
    expect(tokens).toEqual([prepared.issued.token]);
    expect(prepared.record.tokenHash).toBe(
      `hashed(admin-session):${prepared.issued.token}`,
    );
    expect(prepared.record.adminId).toBe(ADMIN_ID);
    expect(prepared.issued.maxAgeSeconds).toBe(60 * 60);
  });
});

describe('StoreAdminSessionIssuer.reissueForOperator', () => {
  test('操作した端末が同じ管理者としてログイン中なら、その端末のUser-Agentで新しいセッションを発行する', async () => {
    const { issuer, recorded } = setup();

    const issued = await issuer.reissueForOperator(
      ADMIN_ID,
      principalOf('admin', ADMIN_ID),
      metaWith('Operator/1.0'),
    );

    expect(issued).toBeDefined();
    expect(SESSION_TOKEN_PATTERN.test(issued?.token ?? '')).toBe(true);
    expect(recorded.inserted).toMatchObject([
      { id: issued?.sessionId, adminId: ADMIN_ID, userAgent: 'Operator/1.0' },
    ]);
  });

  test('操作した端末が未ログインなら発行しない', async () => {
    const { issuer, recorded } = setup();

    const issued = await issuer.reissueForOperator(
      ADMIN_ID,
      { kind: 'anonymous' },
      metaWith(undefined),
    );

    expect(issued).toBeUndefined();
    expect(recorded.inserted).toEqual([]);
  });

  test('操作した端末が別の管理者としてログイン中なら発行しない', async () => {
    const { issuer, recorded } = setup();

    const issued = await issuer.reissueForOperator(
      ADMIN_ID,
      principalOf('admin', OTHER_ADMIN_ID),
      metaWith(undefined),
    );

    expect(issued).toBeUndefined();
    expect(recorded.inserted).toEqual([]);
  });

  test('操作した端末が同じIDの利用者の主体なら発行しない', async () => {
    const { issuer, recorded } = setup();

    const issued = await issuer.reissueForOperator(
      ADMIN_ID,
      principalOf('user', ADMIN_ID),
      metaWith(undefined),
    );

    expect(issued).toBeUndefined();
    expect(recorded.inserted).toEqual([]);
  });
});

describe('StoreAdminSessionIssuer の束縛', () => {
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
      .bind<AdminSessionStore>(ADMIN_TYPES.AdminSessionStore)
      .toConstantValue(createStore(recorded));
    container
      .bind<AdminSessionIssuer>(ADMIN_TYPES.AdminSessionIssuer)
      .to(StoreAdminSessionIssuer);

    const issuer = container.get<AdminSessionIssuer>(
      ADMIN_TYPES.AdminSessionIssuer,
    );
    await issuer.issue(ADMIN_ID, metaWith(undefined));

    expect(recorded.inserted).toHaveLength(1);
  });
});
