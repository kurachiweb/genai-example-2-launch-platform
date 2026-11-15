import { inject, injectable } from 'inversify';

import type { SessionSubjectKind } from '../../../lib/core/session/session-view.ts';
import type {
  SessionVerification,
  SessionVerifier,
} from '../session/session-verifier.ts';
import { AUTH_TYPES } from './auth-types.ts';

export interface SubjectSessionVerifierPort {
  verify(token: string): Promise<SessionVerification>;
}

const INVALID: SessionVerification = Object.freeze({ status: 'invalid' });

@injectable()
export class SubjectSessionVerifier implements SessionVerifier {
  constructor(
    @inject(AUTH_TYPES.UserSessionVerifier)
    private readonly user: SubjectSessionVerifierPort,
    @inject(AUTH_TYPES.AdminSessionVerifier)
    private readonly admin: SubjectSessionVerifierPort,
  ) {}

  async verify(input: {
    readonly subjectKind: SessionSubjectKind;
    readonly token: string;
  }): Promise<SessionVerification> {
    const port = input.subjectKind === 'user' ? this.user : this.admin;
    const result = await port.verify(input.token);
    // 差し替えた実装が別の主体を返しても、利用者と管理者の権限を取り違えないよう無効にする
    if (
      result.status === 'valid' &&
      result.principal.subjectKind !== input.subjectKind
    ) {
      return INVALID;
    }
    return result;
  }
}

@injectable()
export class InvalidSubjectSessionVerifier implements SubjectSessionVerifierPort {
  verify(): Promise<SessionVerification> {
    return Promise.resolve(INVALID);
  }
}
