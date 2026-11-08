import { type QueryClient, queryOptions } from '@tanstack/react-query';
import { notFound, redirect } from '@tanstack/react-router';

import { executeGraphQL } from '../../lib/start/graphql/execute-graphql.ts';
import { requireData } from '../../lib/utilities/graphql/graphql-result.ts';
import {
  documentIdOf,
  graphqlQueryKey,
} from '../../lib/utilities/graphql/persisted-document.ts';
import { checkHandleFormat } from '../../common-lib/handles/handle-rules.ts';
import { USER_HANDLE_RULE } from '../../common-lib/profile/profile-input-rules.ts';
import type { FollowState } from '../components/profile/follow-button-types.ts';
import type { PublicProfileView } from '../components/profile/public-profile-view.ts';
import {
  ClientPublicProfileDocument,
  type ClientPublicProfileQuery,
} from './generated/graphql.ts';
import type { ClientViewer } from './viewer.ts';

export interface PublicProfileLoaderData {
  readonly handle: string;
  readonly nickname: string;
}

interface PublicProfileLoaderArgs {
  readonly context: {
    readonly queryClient: QueryClient;
    readonly viewer: ClientViewer | null;
  };
  readonly params: { readonly handle: string };
  readonly location: { readonly search: Record<string, unknown> };
}

const GUEST_SCOPE = 'guest';

// 閲覧者との関係(本人・フォロー中)と、停止中の本人にだけ見えることを含む応答のため、同じタブでログイン・ログアウトした後に前の閲覧者の応答を使わないよう、共通の取得の補助のキーの後に閲覧者のIDを加える
export const publicProfileQueryOptions = (
  viewer: ClientViewer | null,
  handle: string,
) =>
  queryOptions({
    queryKey: [
      ...graphqlQueryKey(ClientPublicProfileDocument, { handle }),
      viewer === null ? GUEST_SCOPE : viewer.id,
    ],
    queryFn: async ({ signal }) =>
      requireData(
        await executeGraphQL(
          ClientPublicProfileDocument,
          { handle },
          { signal },
        ),
      ),
  });

export const toPublicProfileView = ({
  publicProfile,
}: ClientPublicProfileQuery): PublicProfileView | undefined =>
  publicProfile?.__typename === 'PublicProfile' ? publicProfile : undefined;

// フォロー・解除の結果で、取得し直さずにフォロワー数とフォローの関係を合わせる。人物情報の無いキャッシュは変えない
export function withFollowState(
  data: ClientPublicProfileQuery,
  state: FollowState,
): ClientPublicProfileQuery;
export function withFollowState(
  data: ClientPublicProfileQuery | undefined,
  state: FollowState,
): ClientPublicProfileQuery | undefined;
export function withFollowState(
  data: ClientPublicProfileQuery | undefined,
  { following, followerCount }: FollowState,
): ClientPublicProfileQuery | undefined {
  const profile = data?.publicProfile;
  if (data === undefined || profile?.__typename !== 'PublicProfile') {
    return data;
  }
  return {
    ...data,
    publicProfile: {
      ...profile,
      followerCount,
      viewerRelation: following ? 'FOLLOWING' : 'NOT_FOLLOWING',
    },
  };
}

// 形式に合わないハンドルは存在し得ないため照会しない。存在しない・閲覧できない場合は同じ404にし、旧ハンドルは現在のハンドルへ302で転送する。取得の失敗はエラーの画面にするため、そのまま投げる
export async function loadPublicProfile({
  context,
  params,
  location,
}: PublicProfileLoaderArgs): Promise<PublicProfileLoaderData> {
  if (checkHandleFormat(params.handle, USER_HANDLE_RULE) !== 'ok') {
    throw notFound();
  }
  const data = await context.queryClient.query({
    ...publicProfileQueryOptions(context.viewer, params.handle),
    staleTime: 'static',
  });
  const { publicProfile } = data;
  if (publicProfile === null) {
    throw notFound();
  }
  if (publicProfile.__typename === 'PublicProfileRedirect') {
    throw redirect({
      to: '/@{$handle}',
      params: { handle: publicProfile.handle },
      search: location.search,
      statusCode: 302,
    });
  }
  return { handle: publicProfile.handle, nickname: publicProfile.nickname };
}

// 閲覧者とハンドルを問わず、取得済みの公開プロフィールのすべてに当たるキーの接頭辞
export const PUBLIC_PROFILE_QUERY_PREFIX = Object.freeze([
  documentIdOf(ClientPublicProfileDocument),
] as const);
