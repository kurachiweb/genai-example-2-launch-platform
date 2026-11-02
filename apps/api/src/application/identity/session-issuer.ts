import { inject, injectable } from 'inversify';

import { hashPurpose } from '../../../lib/core/crypto/keyed-hasher.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { IdGenerator } from '../../../lib/core/ids/id-generator.ts';
import {
  cookieMaxAgeSeconds,
  newSessionTimes,
  USER_SESSION_POLICY,
} from '../../domain/auth/session-policy.ts';
import { AUTH_TYPES } from '../auth/auth-types.ts';
import type { SecretIssuer } from '../auth/secret-issuer.ts';
import type { Principal } from '../session/session-verifier.ts';
import { IDENTITY_TYPES } from './identity-types.ts';
import type { UserSessionStore } from './ports.ts';
import type { RequestMeta } from './request-meta.ts';

// 保存を始めた用途の名前を変えると保存済みのハッシュ値と一致しなくなるため、名前は変えない
export const USER_SESSION_HASH_PURPOSE = hashPurpose('user-session');

export const SESSION_USER_AGENT_MAX_LENGTH = 512;

export interface IssuedSession {
  readonly sessionId: string;
  // SESSION_TOKEN_PATTERNに合う平文で、応答のセッションの指示にだけ使う
  readonly token: string;
  readonly maxAgeSeconds: number;
}

export interface SessionIssuer {
  issue(userId: string, meta: RequestMeta): Promise<IssuedSession>;
  // 利用者の全セッションを消した後に呼び、操作した端末が同じ利用者としてログイン中だったときだけ発行する
  reissueForOperator(
    userId: string,
    operator: Principal,
    meta: RequestMeta,
  ): Promise<IssuedSession | undefined>;
}

const storedUserAgent = (userAgent: string | undefined): string | null =>
  userAgent === undefined || userAgent === ''
    ? null
    : userAgent.slice(0, SESSION_USER_AGENT_MAX_LENGTH);

@injectable()
export class StoreSessionIssuer implements SessionIssuer {
  constructor(
    @inject(AUTH_TYPES.SecretIssuer)
    private readonly secrets: SecretIssuer,
    @inject(PLATFORM_TYPES.IdGenerator)
    private readonly ids: IdGenerator,
    @inject(IDENTITY_TYPES.UserSessionStore)
    private readonly sessions: UserSessionStore,
  ) {}

  async issue(userId: string, meta: RequestMeta): Promise<IssuedSession> {
    const secret = await this.secrets.issue(USER_SESSION_HASH_PURPOSE);
    const times = newSessionTimes(meta.now, USER_SESSION_POLICY);
    const sessionId = this.ids.generate();
    await this.sessions.insert({
      id: sessionId,
      userId,
      tokenHash: secret.hash,
      userAgent: storedUserAgent(meta.userAgent),
      ...times,
    });
    return {
      sessionId,
      token: secret.plain,
      maxAgeSeconds: cookieMaxAgeSeconds(times, meta.now, USER_SESSION_POLICY),
    };
  }

  async reissueForOperator(
    userId: string,
    operator: Principal,
    meta: RequestMeta,
  ): Promise<IssuedSession | undefined> {
    if (
      operator.kind !== 'authenticated' ||
      operator.subjectKind !== 'user' ||
      operator.subjectId !== userId
    ) {
      return undefined;
    }
    return this.issue(userId, meta);
  }
}
