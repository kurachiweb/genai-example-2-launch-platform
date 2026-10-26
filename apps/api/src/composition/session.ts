import { ContainerModule } from 'inversify';

import { AnonymousSessionVerifier } from '../application/session/anonymous-session-verifier.ts';
import {
  SESSION_TYPES,
  type SessionVerifier,
} from '../application/session/session-verifier.ts';

export const SESSION_BINDINGS = new ContainerModule(({ bind }) => {
  bind<SessionVerifier>(SESSION_TYPES.SessionVerifier).to(
    AnonymousSessionVerifier,
  );
});
