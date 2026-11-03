import { ContainerModule } from 'inversify';

import { ADMIN_TYPES } from '../application/admin/admin-types.ts';
import { AUTH_TYPES } from '../application/auth/auth-types.ts';
import {
  SubjectSessionVerifier,
  type SubjectSessionVerifierPort,
} from '../application/auth/subject-session-verifier.ts';
import { UserSessionVerifier } from '../application/identity/user-session-verifier.ts';
import {
  SESSION_TYPES,
  type SessionVerifier,
} from '../application/session/session-verifier.ts';

export const SESSION_BINDINGS = new ContainerModule(({ bind }) => {
  bind<SessionVerifier>(SESSION_TYPES.SessionVerifier).to(
    SubjectSessionVerifier,
  );
  bind<SubjectSessionVerifierPort>(AUTH_TYPES.UserSessionVerifier).to(
    UserSessionVerifier,
  );
  bind<SubjectSessionVerifierPort>(AUTH_TYPES.AdminSessionVerifier).toService(
    ADMIN_TYPES.AdminSessionVerifier,
  );
});
