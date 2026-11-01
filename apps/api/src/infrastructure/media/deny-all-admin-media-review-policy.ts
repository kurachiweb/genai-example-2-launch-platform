import { injectable } from 'inversify';

import type { AdminMediaReviewPolicy } from '../../application/media/file-access-policies.ts';

// 管理者の権限の判定を持つ機能が束縛を差し替えるまでは、管理者側からも画像を配信しない
@injectable()
export class DenyAllAdminMediaReviewPolicy implements AdminMediaReviewPolicy {
  canReview(): Promise<boolean> {
    return Promise.resolve(false);
  }
}
