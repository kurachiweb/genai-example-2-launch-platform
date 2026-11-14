import { HELP_TYPES } from '../../../../application/help/help-types.ts';
import type {
  HelpArticleSummaryView,
  PublicHelpArticleView,
  PublicHelpReader,
} from '../../../../application/help/public-help-reader.ts';
import type {
  HelpArticleSummary,
  ResolversTypes,
  Resolvers,
} from '../../generated/resolvers-types.ts';
import type { GraphQLContext } from '../../graphql-context.ts';
import { withValidatedArgs } from '../../validated-args.ts';
import { HELP_ARTICLE_SEARCH_ARGS } from './inputs.ts';
import { clientOnly } from './resolver-support.ts';

type HelpArticleModel = ResolversTypes['HelpArticle'];

const readerOf = (context: GraphQLContext): PublicHelpReader =>
  context.resolve<PublicHelpReader>(HELP_TYPES.PublicHelpReader);

const toHelpArticleSummary = ({
  handle,
  title,
  subtitle,
  pinned,
}: HelpArticleSummaryView): HelpArticleSummary => ({
  handle,
  title,
  subtitle,
  pinned,
});

const toHelpArticle = (view: PublicHelpArticleView): HelpArticleModel => ({
  handle: view.handle,
  title: view.title,
  subtitle: view.subtitle,
  body: view.bodyMarkdown,
  categoryName: view.categoryName,
  author: view.author,
  updatedAt: view.updatedAt,
  relatedArticles: view.relatedArticles.map(toHelpArticleSummary),
});

// ログインを求めない。存在しない・下書き・形式違反のハンドルは理由を区別せずnullにし、公開の記事の旧ハンドルだけ転送先を返す
export const publicResolvers = {
  Query: {
    helpCenter: clientOnly(
      async (_parent: unknown, _args: unknown, context: GraphQLContext) =>
        (await readerOf(context).helpCenter()).map(({ name, articles }) => ({
          name,
          articles: articles.map(toHelpArticleSummary),
        })),
    ),
    helpArticle: clientOnly(
      async (_parent: unknown, args: { handle: string }, context) => {
        const result = await readerOf(context).findArticle(args.handle);
        switch (result.kind) {
          case 'article':
            return toHelpArticle(result.article);
          case 'redirect':
            return { handle: result.handle };
          case 'not-found':
            return null;
        }
      },
    ),
    helpArticleSearch: clientOnly(
      withValidatedArgs(
        HELP_ARTICLE_SEARCH_ARGS,
        async (_parent: unknown, { query }, context) => {
          if (query === undefined) {
            return [];
          }
          const hits = await readerOf(context).search(query);
          return hits.map(({ handle, title, subtitle, categoryName }) => ({
            handle,
            title,
            subtitle,
            categoryName,
          }));
        },
      ),
    ),
    pinnedHelpArticles: clientOnly(
      async (_parent: unknown, _args: unknown, context: GraphQLContext) =>
        (await readerOf(context).pinned()).map(({ handle, title }) => ({
          handle,
          title,
        })),
    ),
  },
  HelpArticleResult: {
    __resolveType: (result: object) =>
      'body' in result ? 'HelpArticle' : 'HelpArticleRedirect',
  },
} satisfies Resolvers;
