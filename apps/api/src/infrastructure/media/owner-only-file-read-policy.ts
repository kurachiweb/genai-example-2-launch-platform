import { injectable } from 'inversify';

import type {
  FileReadPolicy,
  FileReadPolicyInput,
} from '../../application/media/file-access-policies.ts';

@injectable()
export class OwnerOnlyFileReadPolicy implements FileReadPolicy {
  canRead({ principal, file }: FileReadPolicyInput): Promise<boolean> {
    const { owner } = file;
    return Promise.resolve(
      owner.kind !== 'system' &&
        owner.kind === principal.subjectKind &&
        owner.id === principal.subjectId,
    );
  }
}
