import { useQuery, useQueryClient } from '@tanstack/react-query';

import {
  ownerFollowingOf,
  ownerFollowStatusQueryOptions,
  withOwnerFollowing,
} from '../../graphql/product-page.ts';
import { PUBLIC_PROFILE_QUERY_PREFIX } from '../../graphql/public-profile.ts';
import { useViewer } from '../auth/use-viewer.ts';
import { FollowButton } from '../profile/follow-button.tsx';
import type { FollowState } from '../profile/follow-button-types.ts';

export interface OwnerFollowProps {
  readonly ownerHandle: string;
  readonly viewerIsOwner: boolean;
  readonly className?: string;
}

// 未ログインの閲覧者には照会せず、フォローボタンが示すログインの案内をそのまま使う。照会の結果が届くまでと照会の失敗では、誤った関係を示さないようボタンを描かない
export function OwnerFollow({
  ownerHandle,
  viewerIsOwner,
  className,
}: OwnerFollowProps) {
  const viewer = useViewer();
  const queryClient = useQueryClient();
  const options = ownerFollowStatusQueryOptions(viewer, ownerHandle);
  const { data } = useQuery({
    ...options,
    enabled: viewer !== null && !viewerIsOwner,
  });

  if (viewerIsOwner) {
    return null;
  }
  if (viewer === null) {
    return (
      <FollowButton
        target={{ handle: ownerHandle }}
        initialFollowing={false}
        className={className}
      />
    );
  }
  const following = data === undefined ? undefined : ownerFollowingOf(data);
  if (following === undefined) {
    return null;
  }

  // 公開プロフィールのloaderは鮮度を問わずキャッシュを使うため、相手の公開プロフィールを次に開いた時に取り直させるよう捨てる
  const handleChange = ({ following: next }: FollowState) => {
    queryClient.setQueryData(options.queryKey, (current) =>
      withOwnerFollowing(current, next),
    );
    queryClient.removeQueries({ queryKey: PUBLIC_PROFILE_QUERY_PREFIX });
  };

  return (
    <FollowButton
      target={{ handle: ownerHandle }}
      initialFollowing={following}
      onChange={handleChange}
      className={className}
    />
  );
}
