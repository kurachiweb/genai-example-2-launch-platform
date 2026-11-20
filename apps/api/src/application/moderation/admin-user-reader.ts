import { inject, injectable } from 'inversify';

import { USER_EMAIL_SEARCH_ACTION } from '../../../common-lib/admin/audit-actions/admin-foundation.ts';
import type { DisposableEmailJudgement } from '../../../common-lib/moderation/moderation-labels.ts';
import type { AuditLogRecorder } from '../../../lib/core/admin/audit-log.ts';
import { ADMIN_PLATFORM_TYPES } from '../../../lib/core/admin/identifiers.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../lib/core/identity/identifiers.ts';
import type {
  AdminUserDirectory,
  AdminUserRecord,
  AdminUserSearchFilter,
  AdminUserStatus,
} from '../../../lib/core/identity/ports.ts';
import { MEDIA_TYPES } from '../../../lib/core/media/identifiers.ts';
import type {
  MediaFileView,
  QuarantineReason,
} from '../../../lib/core/media/media-file.ts';
import type { MediaFiles } from '../../../lib/core/media/ports.ts';
import { MODERATION_PLATFORM_TYPES } from '../../../lib/core/moderation/identifiers.ts';
import type {
  LatestModeration,
  ModerationRecordStore,
} from '../../../lib/core/moderation/ports.ts';
import { PROFILE_PLATFORM_TYPES } from '../../../lib/core/profile/identifiers.ts';
import type {
  UserProfileDirectory,
  UserSummaryRecord,
} from '../../../lib/core/profile/ports.ts';
import type { ModerationOperator } from './ports.ts';

export interface AdminUserAvatar {
  readonly fileId: string;
  readonly quarantined: boolean;
  readonly quarantineReasons: readonly QuarantineReason[];
}

export interface AdminUserSuspensionNote {
  readonly reason: string | null;
  readonly occurredAt: Date;
}

// メールアドレスと仮名化IDは画面へ返さない
export interface AdminUserView {
  readonly userId: string;
  readonly handle: string;
  readonly nickname: string;
  // プロフィール画像が無い・照会で返らない(物理削除済みの)ファイルはnull
  readonly avatar: AdminUserAvatar | null;
  readonly registeredAt: Date;
  readonly disposableEmail: DisposableEmailJudgement;
  readonly status: AdminUserStatus;
  readonly suspendedAt: Date | null;
  // 停止中で、停止の措置の記録が残っている利用者だけが持つ
  readonly latestSuspension: AdminUserSuspensionNote | null;
}

export interface AdminUserPage {
  readonly users: readonly AdminUserView[];
  readonly nextCursor: string | null;
}

export interface AdminUserListInput {
  readonly filter: AdminUserSearchFilter;
  readonly first: number;
  readonly after?: string;
  readonly operator: ModerationOperator;
  readonly at: Date;
}

// 権限の確認と件数(1〜50)の検証は呼び出し側のリゾルバが行う
export interface AdminUserReader {
  // 不正な位置は上流のAppError(bad_request, invalid_cursor)をそのまま投げる。メールアドレスの絞り込みの記録に失敗したら結果を返さずに投げる
  list(input: AdminUserListInput): Promise<AdminUserPage>;
}

interface PageDetails {
  readonly summaries: ReadonlyMap<string, UserSummaryRecord>;
  readonly files: ReadonlyMap<string, MediaFileView>;
  readonly suspensions: ReadonlyMap<string, LatestModeration>;
}

const EMPTY_SUMMARIES: ReadonlyMap<string, UserSummaryRecord> = new Map();
const EMPTY_FILES: ReadonlyMap<string, MediaFileView> = new Map();
const EMPTY_SUSPENSIONS: ReadonlyMap<string, LatestModeration> = new Map();

const disposableEmailOf = (user: AdminUserRecord): DisposableEmailJudgement => {
  if (!user.emailVerified) {
    return 'unverified';
  }
  return user.disposableEmailStatus ?? 'undetermined';
};

const avatarOf = (
  user: AdminUserRecord,
  details: PageDetails,
): AdminUserAvatar | null => {
  const fileId = details.summaries.get(user.userId)?.avatarFileId ?? null;
  const file = fileId === null ? undefined : details.files.get(fileId);
  if (file === undefined) {
    return null;
  }
  return {
    fileId: file.id,
    quarantined: file.quarantined,
    quarantineReasons: file.quarantineReasons,
  };
};

const latestSuspensionOf = (
  user: AdminUserRecord,
  details: PageDetails,
): AdminUserSuspensionNote | null => {
  const latest =
    user.status === 'suspended'
      ? details.suspensions.get(user.userId)
      : undefined;
  return latest === undefined
    ? null
    : { reason: latest.reason, occurredAt: latest.occurredAt };
};

const viewOf = (
  user: AdminUserRecord,
  details: PageDetails,
): AdminUserView => ({
  userId: user.userId,
  handle: user.handle,
  nickname: user.nickname,
  avatar: avatarOf(user, details),
  registeredAt: user.registeredAt,
  disposableEmail: disposableEmailOf(user),
  status: user.status,
  suspendedAt: user.suspendedAt,
  latestSuspension: latestSuspensionOf(user, details),
});

@injectable()
export class DefaultAdminUserReader implements AdminUserReader {
  constructor(
    @inject(IDENTITY_PLATFORM_TYPES.AdminUserDirectory)
    private readonly users: AdminUserDirectory,
    @inject(PROFILE_PLATFORM_TYPES.UserProfileDirectory)
    private readonly profiles: UserProfileDirectory,
    @inject(MEDIA_TYPES.MediaFiles) private readonly media: MediaFiles,
    @inject(MODERATION_PLATFORM_TYPES.ModerationRecordStore)
    private readonly records: ModerationRecordStore,
    @inject(ADMIN_PLATFORM_TYPES.AuditLogRecorder)
    private readonly auditLog: AuditLogRecorder,
  ) {}

  async list({
    filter,
    first,
    after,
    operator,
    at,
  }: AdminUserListInput): Promise<AdminUserPage> {
    const page = await this.users.search(
      filter,
      after === undefined ? { limit: first } : { after, limit: first },
    );
    const details = await this.#detailsOf(page.users);
    const users = page.users.map((user) => viewOf(user, details));
    if (filter.email !== undefined) {
      // 検索文字列を残さないため、対象は結果に表示する利用者の仮名化IDだけにする。記録の失敗はそのまま投げ、結果を返さない
      await this.auditLog.record({
        operatorAdminId: operator.adminId,
        action: USER_EMAIL_SEARCH_ACTION.name,
        targetIds: page.users.map(({ pseudonymousId }) => pseudonymousId),
        occurredAt: at,
      });
    }
    return { users, nextCursor: page.nextCursor };
  }

  // 利用者の数に比例した問い合わせをしないため、ページのプロフィール・画像・停止の理由をそれぞれ1回の照会で読む
  async #detailsOf(users: readonly AdminUserRecord[]): Promise<PageDetails> {
    if (users.length === 0) {
      return {
        summaries: EMPTY_SUMMARIES,
        files: EMPTY_FILES,
        suspensions: EMPTY_SUSPENSIONS,
      };
    }
    const suspendedIds = users
      .filter(({ status }) => status === 'suspended')
      .map(({ userId }) => userId);
    const [{ summaries, files }, suspensions] = await Promise.all([
      this.#avatarsOf(users),
      suspendedIds.length === 0
        ? EMPTY_SUSPENSIONS
        : this.records.latestFor({
            targetIds: suspendedIds,
            actions: ['user.suspend'],
          }),
    ]);
    return { summaries, files, suspensions };
  }

  async #avatarsOf(
    users: readonly AdminUserRecord[],
  ): Promise<Pick<PageDetails, 'summaries' | 'files'>> {
    const summaries = await this.profiles.findSummaries(
      users.map(({ userId }) => userId),
      'not-withdrawn',
    );
    const fileIds = [
      ...new Set(
        users.flatMap(({ userId }) => {
          const avatarFileId = summaries.get(userId)?.avatarFileId ?? null;
          return avatarFileId === null ? [] : [avatarFileId];
        }),
      ),
    ];
    const files =
      fileIds.length === 0 ? EMPTY_FILES : await this.media.findMany(fileIds);
    return { summaries, files };
  }
}
