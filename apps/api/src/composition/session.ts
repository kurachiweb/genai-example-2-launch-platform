import { ContainerModule } from 'inversify';

import { AUTH_TYPES } from '../application/auth/auth-types.ts';
import {
  InvalidSubjectSessionVerifier,
  SubjectSessionVerifier,
  type SubjectSessionVerifierPort,
} from '../application/auth/subject-session-verifier.ts';
import { UserSessionVerifier } from '../application/identity/user-session-verifier.ts';
import {
  SESSION_TYPES,
  type SessionVerifier,
} from '../application/session/session-verifier.ts';

// 管理者の認証が無い間は、管理者側の呼び出し元のセッションを常に無効と判定する
export const SESSION_BINDINGS = new ContainerModule(({ bind }) => {
  bind<SessionVerifier>(SESSION_TYPES.SessionVerifier).to(
    SubjectSessionVerifier,
  );
  bind<SubjectSessionVerifierPort>(AUTH_TYPES.UserSessionVerifier).to(
    UserSessionVerifier,
  );
  bind<SubjectSessionVerifierPort>(AUTH_TYPES.AdminSessionVerifier).to(
    InvalidSubjectSessionVerifier,
  );
});
