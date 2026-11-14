import { useId } from 'react';

import { DateTime } from '../../../lib/components/datetime/date-time.tsx';
import { MarkdownContent } from '../../../lib/components/markdown/markdown-content.tsx';
import { useMarkdownOptions } from '../../../lib/components/markdown/use-markdown-options.ts';
import { useRenderedMarkdown } from '../../../lib/components/markdown/use-rendered-markdown.ts';
import { cn } from '../../../lib/utilities/class-names.ts';
import { HELP_ARTICLE_EXTERNAL_LINK_REL } from '../../../common-lib/help/help-input-rules.ts';
import type { HelpArticleView } from '../../graphql/help-center.ts';
import { HelpArticleAuthor } from './help-article-author.tsx';
import { HelpArticleToolbar } from './help-article-toolbar.tsx';
import {
  HELP_ARTICLE_AUTHOR_LABEL,
  HELP_ARTICLE_UPDATED_AT_LABEL,
} from './help-messages.ts';
import { HelpTableOfContents } from './help-table-of-contents.tsx';
import { RelatedHelpArticles } from './related-help-articles.tsx';

export interface HelpArticlePageProps {
  readonly article: HelpArticleView;
}

// 目次と本文の中のリンクで移った先(見出し・脚注)が、固定の共通ヘッダーの下に隠れない位置で止まるようにする
const BODY_CLASS_NAME = 'min-w-0 [&_[id]]:scroll-mt-20';

export function HelpArticlePage({ article }: HelpArticlePageProps) {
  const titleId = useId();
  const options = useMarkdownOptions({
    externalLinkRel: HELP_ARTICLE_EXTERNAL_LINK_REL,
    idScope: 'article',
  });
  const rendered = useRenderedMarkdown(article.body, options);
  const hasHeadings = rendered.headings.length > 0;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 pt-6 pb-12 sm:pt-8">
      <HelpArticleToolbar />
      <article aria-labelledby={titleId} className="flex flex-col gap-8">
        <header className="flex flex-col gap-2 border-b border-border pb-6">
          <p className="text-sm font-bold text-primary">
            {article.categoryName}
          </p>
          <h1
            id={titleId}
            className="text-2xl font-extrabold tracking-tight wrap-anywhere sm:text-3xl"
          >
            {article.title}
          </h1>
          <p className="wrap-anywhere text-muted-foreground sm:text-lg">
            {article.subtitle}
          </p>
          <dl className="mt-3 flex flex-wrap items-center gap-x-8 gap-y-3 text-sm">
            <div className="flex min-w-0 items-center gap-3">
              <dt className="text-muted-foreground">
                {HELP_ARTICLE_AUTHOR_LABEL}
              </dt>
              <dd className="min-w-0">
                <HelpArticleAuthor author={article.author} />
              </dd>
            </div>
            <div className="flex items-center gap-3">
              <dt className="text-muted-foreground">
                {HELP_ARTICLE_UPDATED_AT_LABEL}
              </dt>
              <dd>
                <DateTime value={article.updatedAt} format="longDateTime" />
              </dd>
            </div>
          </dl>
        </header>
        {/* 目次は本文より前に置き、1024px未満では本文の冒頭に、1024px以上では右の列に並べる。
            右の列は本文と同じ高さまで伸び、その中で目次が共通ヘッダーの直下に留まる */}
        {hasHeadings ? (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-10">
            <div className="min-w-0 lg:col-start-2 lg:row-start-1">
              <HelpTableOfContents headings={rendered.headings} />
            </div>
            <MarkdownContent
              rendered={rendered}
              className={cn(BODY_CLASS_NAME, 'lg:col-start-1 lg:row-start-1')}
            />
          </div>
        ) : (
          <MarkdownContent rendered={rendered} className={BODY_CLASS_NAME} />
        )}
      </article>
      <RelatedHelpArticles
        categoryName={article.categoryName}
        articles={article.relatedArticles}
      />
    </div>
  );
}
