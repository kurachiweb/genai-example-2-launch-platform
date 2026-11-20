import { inject, injectable } from 'inversify';

import { ADMIN_LIST_PAGE_SIZE } from '../../../common-lib/moderation/moderation-actions.ts';
import { ADMIN_PLATFORM_TYPES } from '../../../lib/core/admin/identifiers.ts';
import type {
  AdminDirectory,
  AdminProfileView,
} from '../../../lib/core/admin/ports.ts';
import { MEDIA_TYPES } from '../../../lib/core/media/identifiers.ts';
import type {
  MediaOwner,
  ModerationFinding,
  QuarantineReason,
} from '../../../lib/core/media/media-file.ts';
import type {
  MediaQuarantine,
  QuarantinedImage,
} from '../../../lib/core/media/ports.ts';
import { PROFILE_PLATFORM_TYPES } from '../../../lib/core/profile/identifiers.ts';
import type {
  UserProfileDirectory,
  UserSummaryRecord,
} from '../../../lib/core/profile/ports.ts';

export interface QuarantinedImageListQuery {
  readonly reason: QuarantineReason;
  readonly cursor: string | undefined;
}

export interface QuarantinedImageFile {
  readonly id: string;
  readonly quarantined: boolean;
  readonly quarantineReasons: readonly QuarantineReason[];
}

// 物理削除済みの利用者・削除済みの管理者は表示名を引けないため、nicknameとhandleがnullになる
export interface QuarantinedImageOwner {
  readonly kind: 'user' | 'admin';
  readonly id: string;
  readonly nickname: string | null;
  readonly handle: string | null;
}

export interface QuarantinedImageItem {
  readonly file: QuarantinedImageFile;
  readonly purpose: string;
  // 保有者がsystem(識別子なし)の画像はnull
  readonly owner: QuarantinedImageOwner | null;
  readonly quarantinedAt: Date;
  readonly findings: readonly string[];
}

export interface QuarantinedImagePage {
  readonly items: readonly QuarantinedImageItem[];
  readonly nextCursor: string | undefined;
}

// 権限の確認は呼び出し側のリゾルバが行う。カーソルは上流の値をそのまま中継し、不正なカーソルは上流のエラーをそのまま投げる
export interface QuarantinedImageReader {
  list(query: QuarantinedImageListQuery): Promise<QuarantinedImagePage>;
}

interface OwnerNames {
  readonly users: ReadonlyMap<string, UserSummaryRecord>;
  readonly admins: ReadonlyMap<string, AdminProfileView>;
}

const UNPROCESSABLE_FINDING_TEXTS: Readonly<
  Record<
    Extract<ModerationFinding, { source: 'unprocessable' }>['reason'],
    string
  >
> = Object.freeze({
  undecodable: '画像を読み込めないため判定できませんでした',
  'rejected-by-service': '判定サービスが画像を受け付けませんでした',
});

// 信頼度は判定の閾値と比べる値のため、四捨五入で閾値に届いたように見せないよう切り捨てる
function describeModerationFinding(finding: ModerationFinding): string {
  switch (finding.source) {
    case 'labels':
      return `${finding.category}: ${finding.label}(信頼度${String(Math.floor(finding.confidence))}%)`;
    case 'svg':
      return `SVG: ${finding.violation}(${finding.target})`;
    case 'unprocessable':
      return UNPROCESSABLE_FINDING_TEXTS[finding.reason];
  }
}

const uniqueOwnerIds = (
  images: readonly QuarantinedImage[],
  kind: 'user' | 'admin',
): readonly string[] => [
  ...new Set(
    images.flatMap(({ file: { owner } }) =>
      owner.kind === kind ? [owner.id] : [],
    ),
  ),
];

const ownerOf = (
  owner: MediaOwner,
  names: OwnerNames,
): QuarantinedImageOwner | null => {
  switch (owner.kind) {
    case 'system':
      return null;
    case 'user': {
      const summary = names.users.get(owner.id);
      return {
        kind: 'user',
        id: owner.id,
        nickname: summary?.nickname ?? null,
        handle: summary?.handle ?? null,
      };
    }
    case 'admin':
      return {
        kind: 'admin',
        id: owner.id,
        nickname: names.admins.get(owner.id)?.nickname ?? null,
        handle: null,
      };
  }
};

const toItem = (
  image: QuarantinedImage,
  names: OwnerNames,
): QuarantinedImageItem => ({
  file: {
    id: image.file.id,
    quarantined: image.file.quarantined,
    quarantineReasons: image.file.quarantineReasons,
  },
  purpose: image.file.purpose,
  owner: ownerOf(image.file.owner, names),
  quarantinedAt: image.quarantinedAt,
  findings: image.findings.map(describeModerationFinding),
});

@injectable()
export class DefaultQuarantinedImageReader implements QuarantinedImageReader {
  constructor(
    @inject(MEDIA_TYPES.MediaQuarantine)
    private readonly quarantine: MediaQuarantine,
    @inject(PROFILE_PLATFORM_TYPES.UserProfileDirectory)
    private readonly users: UserProfileDirectory,
    @inject(ADMIN_PLATFORM_TYPES.AdminDirectory)
    private readonly admins: AdminDirectory,
  ) {}

  async list(query: QuarantinedImageListQuery): Promise<QuarantinedImagePage> {
    const list = await this.quarantine.listByReason({
      reason: query.reason,
      cursor: query.cursor,
      limit: ADMIN_LIST_PAGE_SIZE,
    });
    const names = await this.ownerNames(list.items);
    return {
      items: list.items.map((image) => toItem(image, names)),
      nextCursor: list.nextCursor,
    };
  }

  // 停止・退会した利用者の画像も隔離されたまま残るため、物理削除前の利用者は全て表示名を引く
  private async ownerNames(
    images: readonly QuarantinedImage[],
  ): Promise<OwnerNames> {
    const userIds = uniqueOwnerIds(images, 'user');
    const adminIds = uniqueOwnerIds(images, 'admin');
    const [users, admins] = await Promise.all([
      userIds.length === 0
        ? new Map<string, UserSummaryRecord>()
        : this.users.findSummaries(userIds, 'including-withdrawn'),
      adminIds.length === 0
        ? new Map<string, AdminProfileView>()
        : this.admins.findProfiles(adminIds),
    ]);
    return { users, admins };
  }
}
