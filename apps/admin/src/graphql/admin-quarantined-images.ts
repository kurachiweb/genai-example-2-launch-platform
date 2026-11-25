import {
  type InfiniteData,
  infiniteQueryOptions,
  type QueryClient,
} from '@tanstack/react-query';

import type { ModerationAction } from '../../common-lib/moderation/moderation-actions.ts';
import type { QuarantineReason } from '../../common-lib/moderation/moderation-labels.ts';
import type { RouterContext } from '../../lib/start/router-context.ts';
import { executeGraphQL } from '../../lib/start/graphql/execute-graphql.ts';
import { requireData } from '../../lib/utilities/graphql/graphql-result.ts';
import {
  documentIdOf,
  graphqlQueryKey,
} from '../../lib/utilities/graphql/persisted-document.ts';
import {
  type AdminMediaFileView,
  GRAPHQL_QUARANTINE_REASON_OF,
  type ModerationActionInput,
  type ModerationActionOptions,
  moderationActionOptions,
  toAdminMediaFile,
} from './admin-moderation-shared.ts';
import {
  AdminApproveQuarantinedImageDocument,
  AdminDeleteQuarantinedImageDocument,
  AdminQuarantinedImagesDocument,
  type AdminQuarantinedImagesQuery,
  type AdminQuarantinedImagesQueryVariables,
  AdminQuarantineImageDocument,
  AdminReleaseQuarantinedImageDocument,
} from './generated/graphql.ts';

export interface AdminImageOwnerView {
  // userかadmin
  readonly kind: string;
  readonly id: string;
  // nullは表示名を引けない保有者
  readonly nickname: string | null;
  readonly handle: string | null;
}

export interface AdminQuarantinedImageView {
  readonly file: AdminMediaFileView;
  // 生の用途名。表示名はmediaPurposeLabelで引く
  readonly purpose: string;
  // nullはシステムが保有する画像
  readonly owner: AdminImageOwnerView | null;
  readonly quarantinedAt: string;
  // 自動判定の検出内容
  readonly findings: readonly string[];
}

export interface AdminQuarantinedImageListArgs {
  readonly reason: QuarantineReason;
}

export type AdminQuarantinedImagesData = InfiniteData<
  AdminQuarantinedImagesQuery,
  string | null
>;

export type ImageModerationAction = Extract<
  ModerationAction,
  `image.${string}`
>;

const firstPageOf = (
  reason: QuarantineReason,
): AdminQuarantinedImagesQueryVariables => ({
  reason: GRAPHQL_QUARANTINE_REASON_OF[reason],
});

// 隔離画像の一覧は続きを後ろに加えるため、続きのページは前のページが返した続きのカーソルから読む
export const adminQuarantinedImagesQueryOptions = (reason: QuarantineReason) =>
  infiniteQueryOptions({
    queryKey: graphqlQueryKey(
      AdminQuarantinedImagesDocument,
      firstPageOf(reason),
    ),
    queryFn: async ({ pageParam, signal }) =>
      requireData(
        await executeGraphQL(
          AdminQuarantinedImagesDocument,
          pageParam === null
            ? firstPageOf(reason)
            : { ...firstPageOf(reason), after: pageParam },
          { signal },
        ),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: ({
      adminQuarantinedImages: { nextCursor },
    }: AdminQuarantinedImagesQuery): string | undefined =>
      nextCursor ?? undefined,
  });

export const toAdminQuarantinedImages = ({
  pages,
}: AdminQuarantinedImagesData): readonly AdminQuarantinedImageView[] =>
  pages.flatMap(({ adminQuarantinedImages }) =>
    adminQuarantinedImages.items.map(
      ({ file, purpose, owner, quarantinedAt, findings }) => ({
        file: toAdminMediaFile(file),
        purpose,
        owner:
          owner === null
            ? null
            : {
                kind: owner.kind,
                id: owner.id,
                nickname: owner.nickname,
                handle: owner.handle,
              },
        quarantinedAt,
        findings: [...findings],
      }),
    ),
  );

const byFileAndReason = ({ targetId, reason }: ModerationActionInput) => ({
  fileId: targetId,
  reason,
});

const IMAGE_ACTION_OPTIONS: Readonly<
  Record<ImageModerationAction, ModerationActionOptions>
> = Object.freeze({
  'image.approve': moderationActionOptions({
    document: AdminApproveQuarantinedImageDocument,
    variablesOf: byFileAndReason,
    outcomeOf: ({ approveQuarantinedImage }) => approveQuarantinedImage,
  }),
  'image.quarantine': moderationActionOptions({
    document: AdminQuarantineImageDocument,
    variablesOf: byFileAndReason,
    outcomeOf: ({ quarantineImage }) => quarantineImage,
  }),
  'image.release': moderationActionOptions({
    document: AdminReleaseQuarantinedImageDocument,
    variablesOf: byFileAndReason,
    outcomeOf: ({ releaseQuarantinedImage }) => releaseQuarantinedImage,
  }),
  'image.delete': moderationActionOptions({
    document: AdminDeleteQuarantinedImageDocument,
    variablesOf: byFileAndReason,
    outcomeOf: ({ deleteQuarantinedImage }) => deleteQuarantinedImage,
  }),
});

export const imageModerationActionOptions = (
  action: ImageModerationAction,
): ModerationActionOptions => IMAGE_ACTION_OPTIONS[action];

export async function invalidateAdminQuarantinedImageQueries(
  queryClient: QueryClient,
): Promise<void> {
  await queryClient.invalidateQueries({
    queryKey: [documentIdOf(AdminQuarantinedImagesDocument)],
  });
}

// 一覧の取得の失敗は一覧の中で再試行できるよう、例外にせずキャッシュに残す。続きのページはここで読み足さず、画面の「さらに読み込む」で読む。同じ画面の中のタブの切り替えは、直前の一覧を残して読み込み中を示せるよう待たない
export async function loadAdminQuarantinedImagesPage({
  context,
  deps,
  cause,
}: {
  readonly context: Pick<RouterContext, 'queryClient'>;
  readonly deps: AdminQuarantinedImageListArgs;
  readonly cause: 'preload' | 'enter' | 'stay';
}): Promise<void> {
  const loading = context.queryClient
    .infiniteQuery(adminQuarantinedImagesQueryOptions(deps.reason))
    .catch(() => undefined);
  if (cause !== 'stay') {
    await loading;
  }
}
