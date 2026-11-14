import { injectable } from 'inversify';

import type {
  SessionVerification,
  SessionVerifier,
} from './session-verifier.ts';

@injectable()
export class AnonymousSessionVerifier implements SessionVerifier {
  verify(): Promise<SessionVerification> {
    return Promise.resolve({ status: 'invalid' });
  }
}
