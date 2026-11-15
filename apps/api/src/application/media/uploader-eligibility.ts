import type { UploaderDenialCode } from '../../../common-lib/media/media-error-codes.ts';
import type { UploadPurpose } from '../../../lib/core/media/upload-purpose.ts';
import type {
  AuthenticatedPrincipal,
  SessionView,
} from '../../../lib/core/session/session-view.ts';

export type UploaderEligibilityDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly code: UploaderDenialCode };

export interface UploaderEligibilityInput {
  readonly session: SessionView;
  readonly principal: AuthenticatedPrincipal;
  readonly purpose: UploadPurpose;
}

export interface UploaderEligibility {
  check(input: UploaderEligibilityInput): Promise<UploaderEligibilityDecision>;
}

const UploaderEligibility: unique symbol = Symbol.for(
  'media.UploaderEligibility',
);

export const UPLOAD_ACCESS_TYPES = Object.freeze({
  UploaderEligibility,
});
