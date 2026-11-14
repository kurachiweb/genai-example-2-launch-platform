import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';

import {
  HELP_CATEGORY_OTHER_ID,
  HELP_CATEGORY_OTHER_NAME,
} from '../../../common-lib/help/help-category-constants.ts';
import type { Database } from '../../../db/client.ts';
import { helpArticles } from '../../../db/schema/help/help-articles.ts';
import { helpCategories } from '../../../db/schema/help/help-categories.ts';

export type HelpOrderTarget =
  | { readonly kind: 'categories'; readonly orderedIds: readonly string[] }
  | {
      readonly kind: 'articles';
      readonly categoryId: string;
      readonly orderedIds: readonly string[];
    };

const GUARD_ROW_TIMESTAMP = new Date(0);

// 確認の文だけが起こす違反。D1は`D1_ERROR: NOT NULL constraint failed: help_articles.handle: SQLITE_CONSTRAINT (...)`を投げ、causeにSQLiteのエラーを持つ。他の文はこの2つの列へ値を必ず入れるため、違反は確認の文の不成立に限られる
const ARTICLE_GUARD_VIOLATION =
  /NOT NULL constraint failed: help_articles\.handle(?::|$)/u;

const ORDER_GUARD_VIOLATION =
  /NOT NULL constraint failed: help_categories\.name(?::|$)/u;

function violationMatches(error: unknown, pattern: RegExp): boolean {
  for (let current = error; current instanceof Error; current = current.cause) {
    if (pattern.test(current.message)) {
      return true;
    }
  }
  return false;
}

export function isHelpArticleGuardRejection(error: unknown): boolean {
  return violationMatches(error, ARTICLE_GUARD_VIOLATION);
}

export function isHelpOrderGuardRejection(error: unknown): boolean {
  return violationMatches(error, ORDER_GUARD_VIOLATION);
}

// UPDATE・DELETEは対象が0行でも成功し、同じ一括の書き込みの監査ログを止められないため、記事のテーブル自身への挿入を先頭に置いて確かめる。
// 記事が無い・版が違えば副問い合わせのhandleがNULLになり、NOT NULL制約の違反で一括の書き込み全体が取り消される。
// 記事があれば主キーとhandleの一意の衝突をON CONFLICT DO NOTHINGが無視し、何も書かない。SQLiteはNOT NULLとCHECKを一意性より先に確かめるため、他の列はCHECKと外部キーを満たす固定値にする
export function helpArticleExistsGuard(
  db: Database,
  input: { readonly id: string; readonly expectedRevision?: number },
): BatchItem<'sqlite'> {
  const currentHandle = sql`(SELECT ${helpArticles.handle} FROM ${helpArticles} WHERE ${and(
    eq(helpArticles.id, input.id),
    input.expectedRevision === undefined
      ? undefined
      : eq(helpArticles.revision, input.expectedRevision),
  )})`;
  return db
    .insert(helpArticles)
    .values({
      id: input.id,
      handle: currentHandle,
      title: '',
      subtitle: '',
      bodyMarkdown: '',
      categoryId: HELP_CATEGORY_OTHER_ID,
      pinned: false,
      status: 'draft',
      sortOrder: 1,
      createdByAdminId: '',
      revision: 1,
      createdAt: GUARD_ROW_TIMESTAMP,
      updatedAt: GUARD_ROW_TIMESTAMP,
    })
    .onConflictDoNothing();
}

function targetIdsOf(target: HelpOrderTarget): SQL {
  return target.kind === 'categories'
    ? sql`SELECT ${helpCategories.id} AS id FROM ${helpCategories}`
    : sql`SELECT ${helpArticles.id} AS id FROM ${helpArticles} WHERE ${eq(helpArticles.categoryId, target.categoryId)}`;
}

// 渡したIDの件数が対象と同じで、対象のIDがすべて渡したIDに含まれれば、2つの集合は一致する(重複を含む配列は件数の一致で除かれる)。IDの一覧はJSONの文字列にし、件数によらずバインド変数の数を一定にする
function sameIdSet(target: HelpOrderTarget): SQL {
  const ids = JSON.stringify(target.orderedIds);
  const current = targetIdsOf(target);
  return sql`(json_array_length(${ids}) = (SELECT count(*) FROM (${current}))
    AND NOT EXISTS (SELECT 1 FROM (${current}) AS target WHERE target.id NOT IN (SELECT value FROM json_each(${ids}))))`;
}

// 並べ替えの画面を開いた後の追加・削除・カテゴリの移動で対象の集合が変わっていれば、標準カテゴリの行の名前がNULLになり、NOT NULL制約の違反で一括の書き込み全体が取り消される。
// 一致すれば標準カテゴリの行との主キーと名前の一意の衝突をON CONFLICT DO NOTHINGが無視し、何も書かない。対象はカテゴリの全件、またはそのカテゴリの下書きを含む全記事
export function helpOrderGuard(
  db: Database,
  target: HelpOrderTarget,
): BatchItem<'sqlite'> {
  return db
    .insert(helpCategories)
    .values({
      id: HELP_CATEGORY_OTHER_ID,
      name: sql`CASE WHEN ${sameIdSet(target)} THEN ${HELP_CATEGORY_OTHER_NAME} ELSE NULL END`,
      systemDefault: true,
      sortOrder: 1,
      createdAt: GUARD_ROW_TIMESTAMP,
      updatedAt: GUARD_ROW_TIMESTAMP,
    })
    .onConflictDoNothing();
}
