import type { Mock } from 'vitest';

import type { DisplayPreferences } from '../lib/utilities/datetime/display-preferences.ts';
import type { AdminMediaFileView } from '../src/graphql/admin-moderation-shared.ts';
import type { AdminModerationRatingView } from '../src/graphql/admin-moderation-engagement.ts';
import {
  AdminUsersDocument,
  type AdminRole,
  type AdminUsersQuery,
  AdminViewerDocument,
} from '../src/graphql/generated/graphql.ts';
import { success } from './admin-accounts-fixtures.ts';
import { adminViewerResult, adminWithRole } from './admin-viewer-fixtures.ts';

export const MODERATION_DISPLAY: DisplayPreferences = Object.freeze({
  timeZone: 'Asia/Tokyo',
  locale: 'ja-JP',
});

export const MODERATION_ROLES: readonly AdminRole[] = Object.freeze([
  'MODERATOR',
  'SUPER_ADMIN',
]);

export const USER_ID = '01KA0VSER00000000000000001';

export const PRODUCT_ID = '01KA0PR0DVCT00000000000001';

export const RATING_ID = '01KA0RAT1NG000000000000001';

export const LOGO_FILE_ID = '01KA0MED1A0000000000000001';

export const AVATAR_FILE_ID = '01KA0MED1A0000000000000002';

export const MODERATION_REASON = '利用規約の禁止事項に当たる投稿が続いたため';

// 管理者側の中継の経路(/_bff/files/<ID>)は、ブラウザテストの開発サーバーでは見つからない応答になる
export const relayPathOf = (fileId: string): string => `/_bff/files/${fileId}`;

// 変換配信のオブジェクトキー。ブラウザテストの画像配信のオリジンは既定で読み込めない
export const LOGO_OBJECT_KEY = 'fedcba9876543210'.repeat(2);

// APIサーバーの照会が返す変換配信の画像。隔離中の画像はオブジェクトキーがnull
export const graphQLImageOf = (
  fileId: string,
  objectKey: string | null,
): {
  readonly id: string;
  readonly objectKey: string | null;
  readonly fallbackFormat: 'PNG';
  readonly width: number;
  readonly height: number;
} => ({
  id: fileId,
  objectKey,
  fallbackFormat: 'PNG',
  width: 512,
  height: 512,
});

// オブジェクトキーをファイルのIDから作り、テストのファイルの間で重ならないようにする
export const objectKeyOf = (fileId: string): string =>
  fileId.toLowerCase().padStart(32, '0').slice(-32);

export const PUBLIC_LOGO_FILE: AdminMediaFileView = Object.freeze({
  id: LOGO_FILE_ID,
  path: relayPathOf(LOGO_FILE_ID),
  image: Object.freeze({
    objectKey: LOGO_OBJECT_KEY,
    fallbackFormat: 'PNG',
    width: 512,
    height: 512,
  }),
  quarantined: false,
  quarantineReasons: Object.freeze([]),
});

export const QUARANTINED_AVATAR_FILE: AdminMediaFileView = Object.freeze({
  id: AVATAR_FILE_ID,
  path: relayPathOf(AVATAR_FILE_ID),
  image: Object.freeze({
    objectKey: null,
    fallbackFormat: 'PNG',
    width: 256,
    height: 256,
  }),
  quarantined: true,
  quarantineReasons: Object.freeze(['auto', 'user_suspended'] as const),
});

export const VALID_RATING: AdminModerationRatingView = Object.freeze({
  id: RATING_ID,
  rater: Object.freeze({
    id: USER_ID,
    handle: 'fan_1',
    nickname: 'サンプル花子',
    suspended: false,
  }),
  productName: 'Pitch Notes',
  productId: PRODUCT_ID,
  score: 1,
  createdAt: '2026-11-10T01:00:00.000Z',
  updatedAt: '2026-11-11T02:30:00.000Z',
  state: 'valid',
  latestInvalidation: null,
});

export const INVALIDATED_RATING: AdminModerationRatingView = Object.freeze({
  ...VALID_RATING,
  state: 'invalidated',
  latestInvalidation: Object.freeze({
    reason: MODERATION_REASON,
    occurredAt: '2026-11-12T03:00:00.000Z',
  }),
});

type UserNode = AdminUsersQuery['adminUsers']['nodes'][number];

export const ACTIVE_USER_NODE: UserNode = Object.freeze({
  id: USER_ID,
  handle: 'maker_ai',
  nickname: 'サンプル太郎',
  avatar: null,
  registeredAt: '2026-10-01T00:00:00.000Z',
  disposableEmail: 'REGULAR',
  status: 'ACTIVE',
  suspendedAt: null,
  latestSuspension: null,
});

export const adminUsersQueryOf = (
  nodes: readonly UserNode[],
): AdminUsersQuery => ({
  adminUsers: {
    nodes: [...nodes],
    pageInfo: { hasNextPage: false, endCursor: null },
  },
});

export const changedResult = (field: string, changed: boolean) =>
  success({ [field]: { changed } });

export type ModerationGraphQLHandler = (variables: unknown) => Promise<unknown>;

// ログイン中の管理者と一覧の照会に既定の応答を返し、措置の操作はテストが渡した応答にする
export function respondModerationGraphQL(
  executeGraphQL: Mock,
  {
    role,
    handlers = new Map(),
  }: {
    readonly role: AdminRole;
    readonly handlers?: ReadonlyMap<unknown, ModerationGraphQLHandler>;
  },
): void {
  executeGraphQL.mockImplementation((document: unknown, variables: unknown) => {
    const handler = handlers.get(document);
    if (handler !== undefined) {
      return handler(variables);
    }
    if (document === AdminViewerDocument) {
      return Promise.resolve(adminViewerResult(adminWithRole(role)));
    }
    if (document === AdminUsersDocument) {
      return success(adminUsersQueryOf([ACTIVE_USER_NODE]));
    }
    throw new Error('想定していない操作が実行されました。');
  });
}

export const variablesOf = (executeGraphQL: Mock, document: unknown) =>
  executeGraphQL.mock.calls
    .filter(([called]) => called === document)
    .map(([, variables]) => variables as unknown);
