import { asc, sql } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';

import { helpArticlePreviousHandles } from '../../../db/schema/help/help-article-previous-handles.ts';
import { HELP_ARTICLE_HANDLE_RULE } from '../../../common-lib/help/help-input-rules.ts';
import {
  handleOccupiedCondition,
  isHandleOccupied,
  resolveHandle,
} from '../handles/handle-queries.ts';
import {
  previousHandleDelete,
  previousHandleRelease,
} from '../handles/previous-handle-statements.ts';
import { HELP_ARTICLE_HANDLE_NAMESPACE } from './help-article-handle-namespace.ts';
import {
  clearHelpTables,
  db,
  helpArticleIdOf,
  insertHelpArticle,
  insertHelpArticlePreviousHandle,
} from './testing/help-fixtures.ts';

async function occupiedInStatement(
  handle: string,
  exceptOwnerId?: string,
): Promise<boolean> {
  const [row] = await db
    .select({
      occupied: sql<number>`${handleOccupiedCondition(HELP_ARTICLE_HANDLE_NAMESPACE, handle, { exceptOwnerId })}`,
    })
    .from(sql`(SELECT 1)`);
  return row?.occupied === 1;
}

async function occupiedBoth(
  handle: string,
  exceptOwnerId: string,
): Promise<readonly [boolean, boolean]> {
  return [
    await isHandleOccupied(db, HELP_ARTICLE_HANDLE_NAMESPACE, handle, {
      exceptOwnerId,
    }),
    await occupiedInStatement(handle, exceptOwnerId),
  ];
}

async function readPreviousHandles() {
  return db
    .select({
      ownerId: helpArticlePreviousHandles.ownerId,
      handle: helpArticlePreviousHandles.handle,
    })
    .from(helpArticlePreviousHandles)
    .orderBy(asc(helpArticlePreviousHandles.ownerId));
}

beforeEach(async () => {
  await clearHelpTables();
});

describe('HELP_ARTICLE_HANDLE_NAMESPACE', () => {
  test('名前はhelp-articleで、共用部品のヘルプ記事のハンドルの規則と旧ハンドルのテーブルを使う', () => {
    expect(HELP_ARTICLE_HANDLE_NAMESPACE.name).toBe('help-article');
    expect(HELP_ARTICLE_HANDLE_NAMESPACE.rule).toBe(HELP_ARTICLE_HANDLE_RULE);
    expect(HELP_ARTICLE_HANDLE_NAMESPACE.previous?.table).toBe(
      helpArticlePreviousHandles,
    );
  });

  test('公開の記事の現在のハンドルは大文字小文字を区別せずに解決し、保存されている綴りを返す', async () => {
    await insertHelpArticle(1, { handle: 'Getting-Started' });

    expect(
      await resolveHandle(db, HELP_ARTICLE_HANDLE_NAMESPACE, 'getting-STARTED'),
    ).toEqual({
      kind: 'current',
      ownerId: helpArticleIdOf(1),
      handle: 'Getting-Started',
    });
  });

  test('下書きの記事の現在のハンドルは解決しない', async () => {
    await insertHelpArticle(1, { handle: 'draft-article', status: 'draft' });

    expect(
      await resolveHandle(db, HELP_ARTICLE_HANDLE_NAMESPACE, 'Draft-Article'),
    ).toEqual({ kind: 'none' });
  });

  test('旧ハンドルは保持者が公開でも下書きでも、大文字小文字を区別せずに保持者へ解決する', async () => {
    await insertHelpArticle(1, { handle: 'published-now' });
    await insertHelpArticle(2, { handle: 'draft-now', status: 'draft' });
    await insertHelpArticlePreviousHandle(1, 'Old-Published');
    await insertHelpArticlePreviousHandle(2, 'old-draft');

    expect(
      await resolveHandle(db, HELP_ARTICLE_HANDLE_NAMESPACE, 'old-published'),
    ).toEqual({ kind: 'previous', ownerId: helpArticleIdOf(1) });
    expect(
      await resolveHandle(db, HELP_ARTICLE_HANDLE_NAMESPACE, 'OLD-DRAFT'),
    ).toEqual({ kind: 'previous', ownerId: helpArticleIdOf(2) });
    expect(
      await resolveHandle(db, HELP_ARTICLE_HANDLE_NAMESPACE, 'unknown'),
    ).toEqual({ kind: 'none' });
  });

  test('使用中の判定は、下書きを含む他の記事の現在のハンドルを大文字小文字を区別せずに数え、記事自身は除く', async () => {
    await insertHelpArticle(1, { handle: 'published-one' });
    await insertHelpArticle(2, { handle: 'Draft-Two', status: 'draft' });
    await insertHelpArticle(3, { handle: 'setter' });

    expect(await occupiedBoth('PUBLISHED-ONE', helpArticleIdOf(3))).toEqual([
      true,
      true,
    ]);
    expect(await occupiedBoth('draft-two', helpArticleIdOf(3))).toEqual([
      true,
      true,
    ]);
    expect(await occupiedBoth('DRAFT-TWO', helpArticleIdOf(2))).toEqual([
      false,
      false,
    ]);
    expect(await occupiedInStatement('draft-two')).toBe(true);
  });

  test('他の記事の旧ハンドルは、保持者の状態によらず使用中に数えない', async () => {
    await insertHelpArticle(1, { handle: 'published-now' });
    await insertHelpArticle(2, { handle: 'draft-now', status: 'draft' });
    await insertHelpArticle(3, { handle: 'setter' });
    await insertHelpArticlePreviousHandle(1, 'old-published');
    await insertHelpArticlePreviousHandle(2, 'old-draft');

    for (const handle of ['OLD-PUBLISHED', 'old-draft']) {
      expect(await occupiedBoth(handle, helpArticleIdOf(3))).toEqual([
        false,
        false,
      ]);
      expect(await occupiedInStatement(handle)).toBe(false);
    }
  });

  test('旧ハンドルの解放の文は、他の記事が保持する同じ旧ハンドルの行だけを大文字小文字を区別せずに消す', async () => {
    await insertHelpArticle(1, { handle: 'holder' });
    await insertHelpArticle(2, { handle: 'bystander' });
    await insertHelpArticle(3, { handle: 'setter' });
    await insertHelpArticlePreviousHandle(1, 'Shared-Old');
    await insertHelpArticlePreviousHandle(2, 'other-old');

    await db.batch([
      previousHandleRelease(db, HELP_ARTICLE_HANDLE_NAMESPACE, {
        handle: 'shared-old',
        exceptOwnerId: helpArticleIdOf(3),
      }),
    ]);

    expect(await readPreviousHandles()).toEqual([
      { ownerId: helpArticleIdOf(2), handle: 'other-old' },
    ]);
  });

  test('旧ハンドルの解放の文は、記事自身が保持する旧ハンドルの行を消さない', async () => {
    await insertHelpArticle(1, { handle: 'current' });
    await insertHelpArticlePreviousHandle(1, 'own-old');

    await db.batch([
      previousHandleRelease(db, HELP_ARTICLE_HANDLE_NAMESPACE, {
        handle: 'OWN-OLD',
        exceptOwnerId: helpArticleIdOf(1),
      }),
    ]);

    expect(await readPreviousHandles()).toEqual([
      { ownerId: helpArticleIdOf(1), handle: 'own-old' },
    ]);
  });

  test('旧ハンドルの削除の文は、記事の旧ハンドルの行を消し、他の記事の行を残す', async () => {
    await insertHelpArticle(1, { handle: 'first' });
    await insertHelpArticle(2, { handle: 'second' });
    await insertHelpArticlePreviousHandle(1, 'first-old');
    await insertHelpArticlePreviousHandle(2, 'second-old');

    await db.batch([
      previousHandleDelete(
        db,
        HELP_ARTICLE_HANDLE_NAMESPACE,
        helpArticleIdOf(1),
      ),
    ]);

    expect(await readPreviousHandles()).toEqual([
      { ownerId: helpArticleIdOf(2), handle: 'second-old' },
    ]);
  });
});
