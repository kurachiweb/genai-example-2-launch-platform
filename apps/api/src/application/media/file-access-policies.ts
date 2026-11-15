import type { ServiceIdentifier } from 'inversify';

import type { MediaFileView } from '../../../lib/core/media/media-file.ts';
import type { AuthenticatedPrincipal } from '../../../lib/core/session/session-view.ts';

export interface FileReadPolicyInput {
  readonly principal: AuthenticatedPrincipal;
  readonly file: MediaFileView;
}

export interface FileReadPolicy {
  canRead(input: FileReadPolicyInput): Promise<boolean>;
}

export interface AdminMediaReviewInput {
  readonly principal: AuthenticatedPrincipal;
  readonly file: MediaFileView;
}

export interface AdminMediaReviewPolicy {
  canReview(input: AdminMediaReviewInput): Promise<boolean>;
}

export interface FileReadPolicyRegistration {
  readonly purpose: string;
  readonly policy: ServiceIdentifier<FileReadPolicy>;
}

const AdminMediaReviewPolicy: unique symbol = Symbol.for(
  'media.AdminMediaReviewPolicy',
);
const DefaultFileReadPolicy: unique symbol = Symbol.for(
  'media.DefaultFileReadPolicy',
);
const FileAccessAuthorizer: unique symbol = Symbol.for(
  'media.FileAccessAuthorizer',
);

export const FILE_ACCESS_TYPES = Object.freeze({
  AdminMediaReviewPolicy,
  DefaultFileReadPolicy,
  FileAccessAuthorizer,
});
