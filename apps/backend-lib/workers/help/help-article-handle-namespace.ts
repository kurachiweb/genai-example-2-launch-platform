import { helpArticlePreviousHandles } from '../../../db/schema/help/help-article-previous-handles.ts';
import {
  helpArticles,
  publishedHelpArticle,
} from '../../../db/schema/help/help-articles.ts';
import { HELP_ARTICLE_HANDLE_RULE } from '../../../common-lib/help/help-input-rules.ts';
import {
  defineHandleNamespace,
  type HandleNamespace,
} from '../handles/handle-namespace.ts';

// 旧ハンドルは記事の削除と他の記事への解放で物理削除し、論理削除しないため、deletedAtの列は常に空のままになる
export const HELP_ARTICLE_HANDLE_NAMESPACE: HandleNamespace =
  defineHandleNamespace({
    name: 'help-article',
    rule: HELP_ARTICLE_HANDLE_RULE,
    current: {
      table: helpArticles,
      ownerId: helpArticles.id,
      handle: helpArticles.handle,
      activeCondition: publishedHelpArticle,
    },
    previous: {
      table: helpArticlePreviousHandles,
      ownerId: helpArticlePreviousHandles.ownerId,
      handle: helpArticlePreviousHandles.handle,
      deletedAt: helpArticlePreviousHandles.deletedAt,
    },
  });
