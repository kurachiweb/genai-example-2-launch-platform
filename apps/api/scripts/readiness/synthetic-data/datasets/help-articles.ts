import { HELP_BODY_MAX } from '../../../../common-lib/help/help-input-rules.ts';
import { sqlStringLiteral } from '../../../admin/sql-string-literal.ts';
import { helpArticles } from '../../../../db/schema/help/help-articles.ts';
import { helpCategories } from '../../../../db/schema/help/help-categories.ts';
import { adminAt, baseInstantOf } from '../entities.ts';
import { markdownBodyOf } from '../document-text.ts';
import { deterministicUlid } from '../random.ts';
import {
  insertStatements,
  type DatasetContext,
  type DatasetSamples,
  type SqlStatement,
  type SyntheticDataset,
} from '../sql-writer.ts';
import type { ScaleProfile } from '../scale-profile.ts';

export const LARGE_HELP_ARTICLE_HANDLE = 'synthetic-help-max-length';

const DAY_MS = 86_400_000;

const HOUR_MS = 3_600_000;

const CATEGORY_AGE_DAYS = 60;

const ARTICLE_AGE_DAYS = 30;

// 4:21のキーワードの再抽出が選ぶ「更新待ちのまま1時間以上」を満たす経過時間
const PENDING_AGE_MS = 2 * HOUR_MS;

export const largeHelpArticleBodyOf = markdownBodyOf;

function* generate(
  _profile: ScaleProfile,
  context: DatasetContext,
): Generator<SqlStatement> {
  const { seed, baseDate } = context;
  const base = baseInstantOf(baseDate).getTime();
  const categoryAt = new Date(base - CATEGORY_AGE_DAYS * DAY_MS);
  const articleAt = new Date(base - ARTICLE_AGE_DAYS * DAY_MS);
  const categoryId = deterministicUlid(
    categoryAt,
    `${String(seed)}:help-category`,
  );
  const articleId = deterministicUlid(
    articleAt,
    `${String(seed)}:help-article`,
  );
  yield* insertStatements(helpCategories, [
    {
      id: categoryId,
      name: '合成ヘルプカテゴリ',
      systemDefault: false,
      sortOrder: 2,
      createdAt: categoryAt,
      updatedAt: categoryAt,
    },
  ]);
  yield* insertStatements(helpArticles, [
    {
      id: articleId,
      handle: LARGE_HELP_ARTICLE_HANDLE,
      title: '合成の長い本文のヘルプ記事',
      subtitle: '本文が上限の文字数の記事の表示を測るための合成データです',
      bodyMarkdown: largeHelpArticleBodyOf(HELP_BODY_MAX),
      categoryId,
      pinned: false,
      status: 'published',
      sortOrder: 1,
      createdByAdminId: adminAt(context, 0).id,
      revision: 1,
      createdAt: articleAt,
      updatedAt: articleAt,
    },
  ]);
  const changedAt = base - PENDING_AGE_MS;
  yield {
    text: `INSERT INTO help_article_search_documents (source_id, source_version, keyword_status, status_changed_at) SELECT id, 0, 'pending', ${String(changedAt)} FROM help_articles WHERE id = ${sqlStringLiteral(articleId)};`,
    table: 'help_article_search_documents',
    insertedRows: 1,
  };
}

function samples(): DatasetSamples {
  return { largeHelpArticleHandle: [LARGE_HELP_ARTICLE_HANDLE] };
}

export const helpArticlesDataset: SyntheticDataset = {
  name: 'help-articles',
  dependsOn: ['moderation'],
  generate,
  samples,
};
