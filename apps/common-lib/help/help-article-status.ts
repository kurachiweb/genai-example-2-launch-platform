export type HelpArticleStatus = 'draft' | 'published';

export const HELP_ARTICLE_STATUSES: readonly HelpArticleStatus[] =
  Object.freeze(['draft', 'published']);

export const HELP_ARTICLE_STATUS_LABELS: Readonly<
  Record<HelpArticleStatus, string>
> = Object.freeze({
  draft: '下書き',
  published: '公開',
});
