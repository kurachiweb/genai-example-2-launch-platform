import { Link } from '@tanstack/react-router';
import { useId } from 'react';

import type { HelpArticleView } from '../../graphql/help-center.ts';
import { relatedHelpArticlesHeading } from './help-messages.ts';

export interface RelatedHelpArticlesProps {
  readonly categoryName: string;
  // APIがヘルプトップと同じ並び順で返した、同じカテゴリの他の公開の記事
  readonly articles: HelpArticleView['relatedArticles'];
}

export function RelatedHelpArticles({
  categoryName,
  articles,
}: RelatedHelpArticlesProps) {
  const headingId = useId();
  if (articles.length === 0) {
    return null;
  }
  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 border-t border-border pt-8"
    >
      <h2 id={headingId} className="text-lg font-extrabold tracking-tight">
        {relatedHelpArticlesHeading(categoryName)}
      </h2>
      <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {articles.map(({ handle, title }) => (
          <li key={handle}>
            <Link
              to="/help/$handle"
              params={{ handle }}
              className="block rounded-md px-2 py-1.5 leading-snug font-semibold wrap-anywhere text-primary underline-offset-2 hover:bg-accent hover:underline"
            >
              {title}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
