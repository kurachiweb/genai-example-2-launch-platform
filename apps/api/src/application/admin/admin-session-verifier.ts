import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { ADMIN_HASH_PURPOSES } from '../../domain/admin/admin-auth-token-purpose.ts';
import { ADMIN_SESSION_POLICY } from '../../domain/admin/admin-session-policy.ts';
import { evaluateSession } from '../../domain/auth/session-policy.ts';
import { AUTH_TYPES } from '../auth/auth-types.ts';
import type { SecretIssuer } from '../auth/secret-issuer.ts';
import type { SubjectSessionVerifierPort } from '../auth/subject-session-verifier.ts';
import type { SessionVerification } from '../session/session-verifier.ts';
import { ADMIN_TYPES } from './admin-types.ts';
import type { AdminSessionStore } from './ports.ts';

const INVALID: SessionVerification = Object.freeze({ status: 'invalid' });

@injectable()
export class AdminSessionVerifier implements SubjectSessionVerifierPort {
  constructor(
    @inject(AUTH_TYPES.SecretIssuer)
    private readonly secrets: SecretIssuer,
    @inject(ADMIN_TYPES.AdminSessionStore)
    private readonly sessions: AdminSessionStore,
    @inject(PLATFORM_TYPES.Clock)
    private readonly clock: Clock,
  ) {}

  async verify(token: string): Promise<SessionVerification> {
    const tokenHash = await this.secrets.hashOf(
      ADMIN_HASH_PURPOSES.session,
      token,
    );
    // 削除した管理者のセッションは管理者の行と同じ一括の書き込みで消えるため、見つからない
    const session = await this.sessions.findByTokenHash(tokenHash);
    if (session === undefined) {
      return INVALID;
    }
    const now = this.clock.now();
    const evaluation =
      session.admin.status === 'active'
        ? evaluateSession(session, now, ADMIN_SESSION_POLICY)
        : undefined;
    if (evaluation === undefined || evaluation.status === 'expired') {
      await this.sessions.deleteOne(session.adminId, session.id);
      return INVALID;
    }
    const principal = {
      kind: 'authenticated',
      subjectKind: 'admin',
      subjectId: session.adminId,
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
