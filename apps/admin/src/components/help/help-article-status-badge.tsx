import {
  HELP_ARTICLE_STATUS_LABELS,
  type HelpArticleStatus,
} from '../../../common-lib/help/help-article-status.ts';
import { Badge } from '../../../lib/components/ui/badge/badge.tsx';
import type { BadgeVariant } from '../../../lib/components/ui/badge/badge-variants.ts';

export interface HelpArticleStatusBadgeProps {
  readonly status: HelpArticleStatus;
}

// 利用者に見えている公開の記事を目立たせる。色だけに頼らず表示名の文言で状態を示す
const STATUS_VARIANTS: Readonly<Record<HelpArticleStatus, BadgeVariant>> =
  Object.freeze({
    published: 'default',
    draft: 'outline',
  });

export function HelpArticleStatusBadge({
  status,
}: HelpArticleStatusBadgeProps) {
  return (
    <Badge variant={STATUS_VARIANTS[status]}>
      {HELP_ARTICLE_STATUS_LABELS[status]}
    </Badge>
  );
}
