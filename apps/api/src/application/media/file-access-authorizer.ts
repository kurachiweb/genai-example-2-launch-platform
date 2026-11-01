import type { ServiceIdentifier } from 'inversify';

import type { MediaFileView } from '../../../lib/core/media/media-file.ts';
import type { AuthenticatedPrincipal } from '../session/session-verifier.ts';
import type {
  AdminMediaReviewPolicy,
  FileReadPolicy,
  FileReadPolicyRegistration,
} from './file-access-policies.ts';

// application層はpresentation層の呼び出し元の型を読み込めないため、同じ値の型を置く
export type FileAccessCaller = 'client' | 'admin';

export interface FileAccessInput {
  readonly caller: FileAccessCaller;
  readonly principal: AuthenticatedPrincipal;
  readonly file: MediaFileView;
}

export interface FileAccessAuthorizer {
  canAccess(input: FileAccessInput): Promise<boolean>;
}

export interface PolicyFileAccessAuthorizerDependencies {
  readonly registrations: readonly FileReadPolicyRegistration[];
  readonly resolveReadPolicy: (
    identifier: ServiceIdentifier<FileReadPolicy>,
  ) => FileReadPolicy;
  readonly defaultReadPolicy: FileReadPolicy;
  readonly adminReviewPolicy: AdminMediaReviewPolicy;
}

export class FileAccessRegistrationError extends Error {
  override readonly name = 'FileAccessRegistrationError';
}

function indexRegistrations(
  registrations: readonly FileReadPolicyRegistration[],
): ReadonlyMap<string, ServiceIdentifier<FileReadPolicy>> {
  const byPurpose = new Map<string, ServiceIdentifier<FileReadPolicy>>();
  for (const registration of registrations) {
    if (byPurpose.has(registration.purpose)) {
      throw new FileAccessRegistrationError(
        `閲覧の可否の方針が同じ用途${JSON.stringify(registration.purpose)}に重複して登録されています`,
      );
    }
    byPurpose.set(registration.purpose, registration.policy);
  }
  return byPurpose;
}

// 画像は画像配信の経路で見せるため、この判定では管理者側の管理者による確認だけを通す
export class PolicyFileAccessAuthorizer implements FileAccessAuthorizer {
  private readonly policiesByPurpose: ReadonlyMap<
    string,
    ServiceIdentifier<FileReadPolicy>
  >;

  constructor(
    private readonly dependencies: PolicyFileAccessAuthorizerDependencies,
  ) {
    this.policiesByPurpose = indexRegistrations(dependencies.registrations);
  }

  canAccess({ caller, principal, file }: FileAccessInput): Promise<boolean> {
    if (file.storage === 'files') {
      return this.readPolicyFor(file.purpose).canRead({ principal, file });
    }
    if (caller !== 'admin' || principal.subjectKind !== 'admin') {
      return Promise.resolve(false);
    }
    return this.dependencies.adminReviewPolicy.canReview({ principal, file });
  }

  private readPolicyFor(purpose: string): FileReadPolicy {
    const identifier = this.policiesByPurpose.get(purpose);
    return identifier === undefined
      ? this.dependencies.defaultReadPolicy
      : this.dependencies.resolveReadPolicy(identifier);
  }
}
