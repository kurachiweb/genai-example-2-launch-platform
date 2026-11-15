import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import {
  evaluateSession,
  USER_SESSION_POLICY,
} from '../../domain/auth/session-policy.ts';
import { AUTH_TYPES } from '../auth/auth-types.ts';
import type { SecretIssuer } from '../auth/secret-issuer.ts';
import type { SubjectSessionVerifierPort } from '../auth/subject-session-verifier.ts';
import type { SessionVerification } from '../session/session-verifier.ts';
import { IDENTITY_TYPES } from './identity-types.ts';
import type { UserSessionStore } from './ports.ts';
import { USER_SESSION_HASH_PURPOSE } from './session-issuer.ts';

const INVALID: SessionVerification = Object.freeze({ status: 'invalid' });

@injectable()
export class UserSessionVerifier implements SubjectSessionVerifierPort {
  constructor(
    @inject(AUTH_TYPES.SecretIssuer)
    private readonly secrets: SecretIssuer,
    @inject(IDENTITY_TYPES.UserSessionStore)
    private readonly sessions: UserSessionStore,
    @inject(PLATFORM_TYPES.Clock)
    private readonly clock: Clock,
  ) {}

  async verify(token: string): Promise<SessionVerification> {
    const tokenHash = await this.secrets.hashOf(
      USER_SESSION_HASH_PURPOSE,
      token,
    );
    const session = await this.sessions.findByTokenHash(tokenHash);
    if (session === undefined) {
      return INVALID;
    }
    const now = this.clock.now();
    // 停止中の利用者のセッションは閲覧・ログアウト・退会のために残し、状態による拒否はAccountGuardが行う
    const evaluation =
      session.user.deletedAt === null
        ? evaluateSession(session, now, USER_SESSION_POLICY)
        : undefined;
    if (evaluation === undefined || evaluation.status === 'expired') {
      await this.sessions.deleteOne(session.userId, session.id);
      return INVALID;
    }
    const principal = {
      kind: 'authenticated',
      subjectKind: 'user',
      subjectId: session.userId,
      sessionId: session.id,
    } as const;
    if (!evaluation.touch) {
      return { status: 'valid', principal };
    }
    await this.sessions.touch(session.id, now);
    return {
      status: 'valid',
      principal,
      renewal: { token, maxAgeSeconds: evaluation.maxAgeSeconds },
    };
  }
}
