import { useId } from 'react';

import { EmptyState } from '../../../lib/components/state/empty-state.tsx';
import { Button } from '../../../lib/components/ui/button/button.tsx';
import { CONTACT_LABEL } from '../../../lib/utilities/messages/state-messages.ts';
import { CLIENT_PROFILE } from '../../composition/app-profile.ts';
import type { ClientHelpCenterQuery } from '../../graphql/generated/graphql.ts';
import { CONTACT_HREF } from '../layout/site-links.ts';
import { HelpArticleLinkItem } from './help-article-link-item.tsx';
import { HELP_TOP_EMPTY_TITLE } from './help-messages.ts';

type HelpCategory = ClientHelpCenterQuery['helpCenter'][number];

export interface HelpCategoryListProps {
  // APIが管理者の指定した並び順で返したカテゴリ(公開の記事が無いカテゴリを含まない)
  readonly categories: readonly HelpCategory[];
}

function HelpCategorySection({
  category,
}: {
  readonly category: HelpCategory;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="text-lg font-extrabold tracking-tight">
        {category.name}
      </h2>
      <ul className="grid gap-2 md:grid-cols-2">
        {category.articles.map((article) => (
          <HelpArticleLinkItem key={article.handle} article={article} />
        ))}
      </ul>
    </section>
  );
}

// 並び順はAPIが決めるため、受け取った順のまま描く
export function HelpCategoryList({ categories }: HelpCategoryListProps) {
  if (categories.length === 0) {
    return (
      <EmptyState
        title={HELP_TOP_EMPTY_TITLE}
        action={
          CLIENT_PROFILE.contactAvailable ? (
            <Button variant="outline" asChild>
              <a href={CONTACT_HREF}>{CONTACT_LABEL}</a>
            </Button>
          ) : undefined
        }
      />
    );
  }
  return (
    <div className="flex flex-col gap-8">
      {categories.map((category) => (
        <HelpCategorySection key={category.name} category={category} />
      ))}
    </div>
  );
}
