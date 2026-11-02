import { describe, expect, test } from 'bun:test';
import { Container } from 'inversify';

import {
  SESSION_TYPES,
  type SessionSubjectKind,
  type SessionVerification,
  type SessionVerifier,
} from '../session/session-verifier.ts';
import { AUTH_TYPES } from './auth-types.ts';
import {
  InvalidSubjectSessionVerifier,
  SubjectSessionVerifier,
  type SubjectSessionVerifierPort,
} from './subject-session-verifier.ts';

const TOKEN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq';

interface FakePort extends SubjectSessionVerifierPort {
  readonly tokens: readonly string[];
}

function validFor(
  subjectKind: SessionSubjectKind,
): Extract<SessionVerification, { status: 'valid' }> {
  return {
    status: 'valid',
    principal: {
      kind: 'authenticated',
      subjectKind,
      subjectId: `01J${subjectKind.toUpperCase()}`,
      sessionId: `01JSESSION${subjectKind.toUpperCase()}`,
    },
  };
}

function createPort(result: SessionVerification): FakePort {
  const tokens: string[] = [];
  return {
    tokens,
    verify(token) {
      tokens.push(token);
      return Promise.resolve(result);
    },
  };
}

describe('SubjectSessionVerifier', () => {
  test('利用者のセッションは利用者の検証だけに渡し、その結果を返す', async () => {
    const user = createPort(validFor('user'));
    const admin = createPort(validFor('admin'));
    const verifier = new SubjectSessionVerifier(user, admin);

    const result = await verifier.verify({ subjectKind: 'user', token: TOKEN });

    expect(result).toEqual(validFor('user'));
    expect(user.tokens).toEqual([TOKEN]);
    expect(admin.tokens).toEqual([]);
  });

  test('管理者のセッションは管理者の検証だけに渡し、その結果を返す', async () => {
    const user = createPort(validFor('user'));
    const admin = createPort(validFor('admin'));
    const verifier = new SubjectSessionVerifier(user, admin);

    const result = await verifier.verify({
      subjectKind: 'admin',
      token: TOKEN,
    });

    expect(result).toEqual(validFor('admin'));
    expect(admin.tokens).toEqual([TOKEN]);
    expect(user.tokens).toEqual([]);
  });

  test('延長の指示を含む結果もそのまま返す', async () => {
    const renewed: SessionVerification = {
      ...validFor('user'),
      renewal: { token: TOKEN, maxAgeSeconds: 1_209_600 },
    };
    const verifier = new SubjectSessionVerifier(
      createPort(renewed),
      createPort({ status: 'invalid' }),
    );

    expect(await verifier.verify({ subjectKind: 'user', token: TOKEN })).toBe(
      renewed,
    );
  });

  test.each([
    ['user', 'admin'],
    ['admin', 'user'],
  ] as const)(
    '%sのセッションの検証が%sの主体を返したときは、主体を取り違えないよう無効にする',
    async (requested, returned) => {
      const port = createPort(validFor(returned));
      const verifier = new SubjectSessionVerifier(port, port);

      const result = await verifier.verify({
        subjectKind: requested,
        token: TOKEN,
      });

      expect(result).toEqual({ status: 'invalid' });
    },
  );

  test('管理者の既定の検証と組み合わせると、管理者のセッションは常に無効になる', async () => {
    const user = createPort(validFor('user'));
    const verifier = new SubjectSessionVerifier(
      user,
      new InvalidSubjectSessionVerifier(),
    );

    const result = await verifier.verify({
      subjectKind: 'admin',
      token: TOKEN,
    });

    expect(result).toEqual({ status: 'invalid' });
    expect(user.tokens).toEqual([]);
  });

  test('主体別の識別子に束縛した検証をコンテナから注入して振り分ける', async () => {
    const user = createPort(validFor('user'));
    const container = new Container();
    container
      .bind<SubjectSessionVerifierPort>(AUTH_TYPES.UserSessionVerifier)
      .toConstantValue(user);
    container
      .bind<SubjectSessionVerifierPort>(AUTH_TYPES.AdminSessionVerifier)
      .to(InvalidSubjectSessionVerifier);
    container
      .bind<SessionVerifier>(SESSION_TYPES.SessionVerifier)
      .to(SubjectSessionVerifier);

    const verifier = container.get<SessionVerifier>(
      SESSION_TYPES.SessionVerifier,
    );

    expect(
      await verifier.verify({ subjectKind: 'user', token: TOKEN }),
    ).toEqual(validFor('user'));
    expect(
      await verifier.verify({ subjectKind: 'admin', token: TOKEN }),
    ).toEqual({ status: 'invalid' });
  });
});

describe('InvalidSubjectSessionVerifier', () => {
  test('形式に合う識別子を渡しても常に無効を返す', async () => {
    const verifier: SubjectSessionVerifierPort =
      new InvalidSubjectSessionVerifier();

    expect(await verifier.verify(TOKEN)).toEqual({ status: 'invalid' });
  });
});
