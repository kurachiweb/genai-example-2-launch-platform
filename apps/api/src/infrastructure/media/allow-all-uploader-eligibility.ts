import { injectable } from 'inversify';

import type {
  UploaderEligibility,
  UploaderEligibilityDecision,
} from '../../application/media/uploader-eligibility.ts';

const ALLOWED: UploaderEligibilityDecision = Object.freeze({ allowed: true });

@injectable()
export class AllowAllUploaderEligibility implements UploaderEligibility {
  check(): Promise<UploaderEligibilityDecision> {
    return Promise.resolve(ALLOWED);
  }
}
