import { inject, injectable } from 'inversify';

import { PROFILE_PLATFORM_TYPES } from '../../../lib/core/profile/identifiers.ts';
import type { UserProfileDirectory } from '../../../lib/core/profile/ports.ts';
import type {
  InquirerProfile,
  InquirerProfiles,
} from '../../application/inquiry/ports.ts';

// 退会済みの問い合わせの詳細にも送った利用者を表示するため、停止中と退会済み(物理削除前)の利用者も返す
@injectable()
export class ProfileInquirerProfiles implements InquirerProfiles {
  constructor(
    @inject(PROFILE_PLATFORM_TYPES.UserProfileDirectory)
    private readonly directory: UserProfileDirectory,
  ) {}

  async findMany(
    userIds: readonly string[],
  ): Promise<ReadonlyMap<string, InquirerProfile>> {
    const summaries = await this.directory.findSummaries(
      userIds,
      'including-withdrawn',
    );
    return new Map(
      [...summaries.values()].map(
        ({ userId, nickname, handle, avatarFileId }) =>
          [userId, { userId, nickname, handle, avatarFileId }] as const,
      ),
    );
  }
}
