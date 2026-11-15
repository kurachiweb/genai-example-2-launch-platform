import { inject, injectable } from 'inversify';

import { getAppLogger } from '../../../../lib/core/logging/app-logger.ts';
import { MEDIA_TYPES } from '../../../../lib/core/media/identifiers.ts';
import type { MediaFiles } from '../../../../lib/core/media/ports.ts';
import type {
  ScheduledJobDefinition,
  ScheduledJobHandler,
} from '../../../../lib/core/scheduling/cron-registry.ts';
import type { ProfileStore } from '../ports.ts';
import { PROFILE_TYPES } from '../profile-types.ts';

// 次のeraseOwnedByを呼ぶかどうかの境界であり、1回の呼び出しで最大1,000件消えるため、1回の実行の合計はこれを超えうる
export const ORPHANED_FILE_SWEEP_LIMIT = 1000;

// 存在の照会のバインド変数を100個以内に収める
export const ORPHANED_FILE_SWEEP_PAGE = 90;

export const ORPHANED_FILE_SWEEP_JOB_DEFINITION: ScheduledJobDefinition =
  Object.freeze({
    name: 'user-profile-social.orphaned-file-sweep',
    at: Object.freeze({ hour: 4, minute: 21 }),
    order: 600,
    handler: PROFILE_TYPES.OrphanedFileSweepJob,
  });

export interface OrphanedFileSweepResult {
  readonly ownersScanned: number;
  readonly orphanOwners: number;
  readonly failedOwners: number;
  readonly filesErased: number;
  readonly truncated: boolean;
}

const logger = getAppLogger(['api', 'application', 'profile']);

@injectable()
export class OrphanedFileSweepJob implements ScheduledJobHandler {
  constructor(
    @inject(MEDIA_TYPES.MediaFiles)
    private readonly media: MediaFiles,
    @inject(PROFILE_TYPES.ProfileStore)
    private readonly profiles: ProfileStore,
  ) {}

  async run(): Promise<void> {
    const result = await this.sweep();
    logger.info('保有者の居ないファイルを物理削除しました', { ...result });
  }

  // 利用者の行は物理削除の波及処理の後に消えるため、行の無い保有者のファイルは取り残しである。退会済みで物理削除前の利用者は行があるので対象にならない
  async sweep(): Promise<OrphanedFileSweepResult> {
    let ownersScanned = 0;
    let orphanOwners = 0;
    let failedOwners = 0;
    let filesErased = 0;
    let truncated = false;
    let after: string | undefined;
    do {
      const page = await this.media.listOwnerIds({
        kind: 'user',
        after,
        limit: ORPHANED_FILE_SWEEP_PAGE,
      });
      ownersScanned += page.ownerIds.length;
      const existing =
        page.ownerIds.length === 0
          ? new Set<string>()
          : await this.profiles.findExistingUserIds(page.ownerIds);
      for (const ownerId of page.ownerIds) {
        if (existing.has(ownerId)) {
          continue;
        }
        orphanOwners += 1;
        const outcome = await this.eraseOwner(ownerId, filesErased);
        filesErased += outcome.erased;
        failedOwners += outcome.failed ? 1 : 0;
        if (filesErased >= ORPHANED_FILE_SWEEP_LIMIT) {
          truncated = true;
          break;
        }
      }
      after = truncated ? undefined : page.next;
    } while (after !== undefined);
    return {
      ownersScanned,
      orphanOwners,
      failedOwners,
      filesErased,
      truncated,
    };
  }

  // 失敗するまでに消した件数も合計に数え、失敗は次の保有者へ進めるよう警告に留める
  private async eraseOwner(
    ownerId: string,
    alreadyErased: number,
  ): Promise<{ readonly erased: number; readonly failed: boolean }> {
    let erased = 0;
    try {
      let hasMore: boolean;
      do {
        const batch = await this.media.eraseOwnedBy({
          kind: 'user',
          id: ownerId,
        });
        erased += batch.processed;
        hasMore = batch.hasMore && batch.processed > 0;
      } while (hasMore && alreadyErased + erased < ORPHANED_FILE_SWEEP_LIMIT);
      return { erased, failed: false };
    } catch (error: unknown) {
      logger.warn('保有者のファイルを物理削除できませんでした', {
        ownerId,
        error,
      });
      return { erased, failed: true };
    }
  }
}
