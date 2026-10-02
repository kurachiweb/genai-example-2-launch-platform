import { AvatarArt } from '#/components/client/art/avatar-art';
import { InitialPlaceholder } from '#/components/client/art/initial-placeholder';
import type { User } from '#/lib/mock-data';

type Props = {
  user: Pick<User, 'id' | 'nickname' | 'art'>;
  size: number;
  // 読み込み失敗または隔離中(FR-FILEU-011・FR-ADMUG-026〜027)
  broken?: boolean;
  className?: string;
};

export function UserAvatar({ user, size, broken, className }: Props) {
  if (broken || !user.art) {
    return (
      <InitialPlaceholder
        seed={user.id}
        name={user.nickname}
        size={size}
        shape="circle"
        label={`${user.nickname}のプロフィール画像`}
        className={className}
      />
    );
  }
  return (
    <AvatarArt
      palette={user.art.palette}
      size={size}
      title={user.nickname}
      className={className}
    />
  );
}
