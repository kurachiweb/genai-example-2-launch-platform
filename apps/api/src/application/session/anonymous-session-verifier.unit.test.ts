import { describe, expect, test } from 'bun:test';
import { Container } from 'inversify';

import { AnonymousSessionVerifier } from './anonymous-session-verifier.ts';
import {
  SESSION_TYPES,
  type SessionSubjectKind,
  type SessionVerifier,
} from './session-verifier.ts';

const WELL_FORMED_TOKEN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopq';

describe('AnonymousSessionVerifier', () => {
  test.each(['user', 'admin'] as const satisfies readonly SessionSubjectKind[])(
    '%sのセッションとして形式に合う識別子を渡しても無効を返す',
    async (subjectKind) => {
      const verifier: SessionVerifier = new AnonymousSessionVerifier();

      const result = await verifier.verify({
        subjectKind,
        token: WELL_FORMED_TOKEN,
      });

      expect(result).toEqual({ status: 'invalid' });
    },
  );

  test('検証のポートの識別子に束縛すると、コンテナから解決した実装も無効を返す', async () => {
    const container = new Container();
    container
      .bind<SessionVerifier>(SESSION_TYPES.SessionVerifier)
      .to(AnonymousSessionVerifier);

    const verifier = container.get<SessionVerifier>(
      SESSION_TYPES.SessionVerifier,
    );
    const result = await verifier.verify({
      subjectKind: 'user',
      token: WELL_FORMED_TOKEN,
    });

    expect(result).toEqual({ status: 'invalid' });
  });
});
