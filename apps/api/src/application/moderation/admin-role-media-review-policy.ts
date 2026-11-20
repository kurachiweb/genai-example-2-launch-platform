import { inject, injectable } from 'inversify';

import { ADMIN_PLATFORM_TYPES } from '../../../lib/core/admin/identifiers.ts';
import type { AdminDirectory } from '../../../lib/core/admin/ports.ts';
import type {
  AdminMediaReviewInput,
  AdminMediaReviewPolicy,
} from '../media/file-access-policies.ts';

// 隔離画像の確認と公開中の画像の個別の隔離はロールによらず見る必要があるため、ロールは問わず有効な管理者かだけを確かめる
@injectable()
export class AdminRoleMediaReviewPolicy implements AdminMediaReviewPolicy {
  constructor(
    @inject(ADMIN_PLATFORM_TYPES.AdminDirectory)
    private readonly directory: AdminDirectory,
  ) {}

  async canReview({
    principal,
    file,
  }: AdminMediaReviewInput): Promise<boolean> {
    if (principal.subjectKind !== 'admin' || file.storage !== 'images') {
      return false;
    }
    const profiles = await this.directory.findProfiles([principal.subjectId]);
    return profiles.has(principal.subjectId);
  }
}
