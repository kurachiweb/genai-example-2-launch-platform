import { AdminAvatar } from '../../../lib/components/admin/admin-avatar.tsx';
import type { HelpArticleAuthorView } from '../../graphql/help-center.ts';
import { HELP_DELETED_AUTHOR_LABEL } from './help-messages.ts';

export interface HelpArticleAuthorProps {
  // nullは削除済みの管理者
  readonly author: HelpArticleAuthorView;
}

const AVATAR_SIZE = 32;

// 名前を隣に書くため、画像は飾りにする。削除済みの管理者は固定の名前から作る既定の画像にし、誰の記事でも同じ見た目にする
export function HelpArticleAuthor({ author }: HelpArticleAuthorProps) {
  const nickname = author?.nickname ?? HELP_DELETED_AUTHOR_LABEL;
  return (
    <span className="inline-flex min-w-0 items-center gap-2.5">
      <AdminAvatar
        image={author?.avatar ?? null}
        nickname={nickname}
        size={AVATAR_SIZE}
        className="size-8 object-cover"
      />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="font-semibold wrap-anywhere text-foreground">
          {nickname}
        </span>
        {author === null || author.title === null ? null : (
          <span className="text-xs wrap-anywhere text-muted-foreground">
            {author.title}
          </span>
        )}
      </span>
    </span>
  );
}
