import { inject, injectable } from 'inversify';

import { ADMIN_PLATFORM_TYPES } from '../../../lib/core/admin/identifiers.ts';
import type { AdminDirectory } from '../../../lib/core/admin/ports.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';

export interface HelpAuthorView {
  readonly nickname: string;
  readonly title: string | null;
  readonly avatarFileId: string | null;
}

export interface HelpAuthorLookup {
  // 結果に含まれないIDは削除済みの管理者とする。照会の例外は空の結果とwarnのログにする
  find(
    adminIds: readonly string[],
  ): Promise<ReadonlyMap<string, HelpAuthorView>>;
}

const logger = getAppLogger(['api', 'application', 'help']);

@injectable()
export class DirectoryHelpAuthorLookup implements HelpAuthorLookup {
  constructor(
    @inject(ADMIN_PLATFORM_TYPES.AdminDirectory)
    private readonly directory: AdminDirectory,
  ) {}

  async find(
    adminIds: readonly string[],
  ): Promise<ReadonlyMap<string, HelpAuthorView>> {
    const uniqueIds = [...new Set(adminIds)];
    if (uniqueIds.length === 0) {
      return new Map();
    }
    try {
      const profiles = await this.directory.findProfiles(uniqueIds);
      return new Map(
        [...profiles].map(([id, { nickname, title, avatarFileId }]) => [
          id,
          { nickname, title, avatarFileId },
        ]),
      );
    } catch (error: unknown) {
      // 作成者は記事の付加的な表示のため、照会できなくても記事の表示を止めない
      logger.warn(
        '作成者の管理者を照会できないため、削除済みとして表示します',
        { error, count: uniqueIds.length },
      );
      return new Map();
    }
  }
}
