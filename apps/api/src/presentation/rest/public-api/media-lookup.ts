import { inject, injectable } from 'inversify';

import { MEDIA_TYPES } from '../../../../lib/core/media/identifiers.ts';
import type { MediaFileView } from '../../../../lib/core/media/media-file.ts';
import type { MediaFiles } from '../../../../lib/core/media/ports.ts';
import { PROFILE_PLATFORM_TYPES } from '../../../../lib/core/profile/identifiers.ts';
import type {
  UserProfileDirectory,
  UserSummaryRecord,
} from '../../../../lib/core/profile/ports.ts';

export interface MediaLookupRequest {
  readonly fileIds: readonly string[];
  readonly userIds: readonly string[];
}

export interface LoadedMedia {
  // 指定の画像に、読んだ利用者のプロフィール画像を加えたもの
  readonly files: ReadonlyMap<string, MediaFileView>;
  // 可視の利用者だけ
  readonly users: ReadonlyMap<string, UserSummaryRecord>;
}

export interface MediaLookup {
  load(request: MediaLookupRequest): Promise<LoadedMedia>;
}

const EMPTY_FILES: ReadonlyMap<string, MediaFileView> = new Map();

const EMPTY_USERS: ReadonlyMap<string, UserSummaryRecord> = new Map();

// 1回の要求の照会が項目の数に比例しないよう、写像の前に利用者と画像をそれぞれ1回の照会でまとめて読む。利用者のプロフィール画像は利用者を読むまで分からないため、利用者を先に読む
@injectable()
export class PlatformMediaLookup implements MediaLookup {
  constructor(
    @inject(MEDIA_TYPES.MediaFiles)
    private readonly files: MediaFiles,
    @inject(PROFILE_PLATFORM_TYPES.UserProfileDirectory)
    private readonly users: UserProfileDirectory,
  ) {}

  async load(request: MediaLookupRequest): Promise<LoadedMedia> {
    const userIds = [...new Set(request.userIds)];
    const users =
      userIds.length === 0
        ? EMPTY_USERS
        : await this.users.findSummaries(userIds, 'visible');
    const avatarFileIds = [...users.values()].flatMap(({ avatarFileId }) =>
      avatarFileId === null ? [] : [avatarFileId],
    );
    const fileIds = [...new Set([...request.fileIds, ...avatarFileIds])];
    const files =
      fileIds.length === 0 ? EMPTY_FILES : await this.files.findMany(fileIds);
    return { files, users };
  }
}
