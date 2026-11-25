import { Database } from 'bun:sqlite';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { countGraphemes } from '../../../../common-lib/text/graphemes.ts';
import { HELP_BODY_MAX } from '../../../../common-lib/help/help-input-rules.ts';
import { createMigratedDatabase } from '../migrated-database.ts';
import { SMOKE_PROFILE, YEAR_ONE_PROFILE } from '../scale-profile.ts';
import type { DatasetContext, SqlStatement } from '../sql-writer.ts';
import { MAX_STATEMENT_BYTES } from '../sql-writer.ts';
import {
  helpArticlesDataset,
  largeHelpArticleBodyOf,
} from './help-articles.ts';

const context: DatasetContext = { seed: 1, baseDate: '2026-11-24' };

const statementsOf = (profile: typeof SMOKE_PROFILE): SqlStatement[] => [
  ...helpArticlesDataset.generate(profile, context),
];

let db: Database;

beforeAll(() => {
  db = createMigratedDatabase();
  for (const statement of statementsOf(SMOKE_PROFILE)) {
    db.run(statement.text);
  }
});

afterAll(() => {
  db.close();
});

const scalar = (sql: string): unknown =>
  Object.values(db.query<Record<string, unknown>, []>(sql).get() ?? {})[0];

describe('largeHelpArticleBodyOf', () => {
  test('日本語の見出し・段落・リストを含み、書記素でちょうど上限の文字数になる', () => {
    const body = largeHelpArticleBodyOf(HELP_BODY_MAX);

    expect(countGraphemes(body)).toBe(HELP_BODY_MAX);
    expect(body).toContain('## ');
    expect(body).toContain('\n- ');
    expect(body).toContain('。');
  });

  test('末尾が空白にならず、禁止された制御文字を含まない', () => {
    const body = largeHelpArticleBodyOf(HELP_BODY_MAX);

    expect(body).toBe(body.trimEnd());
    for (const forbidden of ['\u000B', '\u000C', '\u0085', '\r']) {
      expect(body.includes(forbidden)).toBe(false);
    }
  });

  test.each([1, 2, 37, 999])(
    '任意の文字数%dでもちょうどその文字数になる',
    (n) => {
      expect(countGraphemes(largeHelpArticleBodyOf(n))).toBe(n);
    },
  );

  test('同じ引数なら同じ本文になる', () => {
    expect(largeHelpArticleBodyOf(5_000)).toBe(largeHelpArticleBodyOf(5_000));
  });
});

describe('helpArticlesDataset', () => {
  test('名前はhelp-articlesで、作成者の管理者を作るmoderationの後に並ぶ', () => {
    expect(helpArticlesDataset.name).toBe('help-articles');
    expect(helpArticlesDataset.dependsOn).toEqual(['moderation']);
  });

  test('検証用の規模でも想定規模でも、カテゴリ1件と記事1件と索引文書1件だけを作る', () => {
    for (const profile of [SMOKE_PROFILE, YEAR_ONE_PROFILE]) {
      const counts: Record<string, number> = {};
      for (const statement of helpArticlesDataset.generate(profile, context)) {
        counts[statement.table] =
          (counts[statement.table] ?? 0) + statement.insertedRows;
      }

      expect(counts).toEqual({
        help_categories: 1,
        help_articles: 1,
        help_article_search_documents: 1,
      });
    }
  });

  test('全ての文が90,000バイト以下で改行を含まず、本文は連結のUPDATEで組み立てる', () => {
    const statements = statementsOf(SMOKE_PROFILE);

    for (const { text } of statements) {
      expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(
        MAX_STATEMENT_BYTES,
      );
      expect(text.includes('\n')).toBe(false);
    }
    const updates = statements.filter(({ text }) =>
      text.startsWith(
        'UPDATE help_articles SET body_markdown = body_markdown ||',
      ),
    );
    expect(updates.length).toBeGreaterThanOrEqual(2);
  });

  test('組み立てた本文が書記素でちょうど上限の文字数になり、公開の状態で入る', () => {
    const row = db
      .query<{ body: string; status: string; handle: string }, []>(
        'SELECT body_markdown AS body, status, handle FROM help_articles',
      )
      .get();

    expect(row?.status).toBe('published');
    expect(countGraphemes(row?.body ?? '')).toBe(HELP_BODY_MAX);
    expect(row?.body).toBe(largeHelpArticleBodyOf(HELP_BODY_MAX));
  });

  test('索引文書は記事の行から更新待ちの形で作られ、全文検索の索引へ入る', () => {
    const row = db
      .query<
        {
          sourceId: string;
          articleId: string;
          version: number;
          status: string;
          title: string;
          body: string;
        },
        []
      >(
        'SELECT d.source_id AS sourceId, a.id AS articleId, d.source_version AS version, d.keyword_status AS status, d.title AS title, d.keywords AS body FROM help_article_search_documents d JOIN help_articles a ON a.id = d.source_id',
      )
      .get();

    expect(row?.sourceId).toBe(row?.articleId);
    expect(row?.version).toBe(0);
    expect(row?.status).toBe('pending');
    expect(row?.title).toBe('');
    expect(row?.body).toBe('');
    expect(
      scalar('SELECT count(*) FROM help_article_search_documents_fts_docsize'),
    ).toBe(1);
  });

  test('更新待ちの索引文書は4:21のキーワードの再抽出の対象(1時間以上前)になる', () => {
    const changedAt = scalar(
      'SELECT status_changed_at FROM help_article_search_documents',
    ) as number;
    const baseAt = Date.parse('2026-11-24T08:00:00.000Z');

    expect(baseAt - changedAt).toBeGreaterThanOrEqual(3_600_000);
  });

  test('カテゴリは記事が参照し、システム既定ではない', () => {
    expect(
      scalar(
        'SELECT count(*) FROM help_articles a JOIN help_categories c ON c.id = a.category_id WHERE c.system_default = 0',
      ),
    ).toBe(1);
  });

  test('見本のハンドルが記事のハンドルと一致する', () => {
    const samples = helpArticlesDataset.samples?.(SMOKE_PROFILE, context);
    const handle = scalar('SELECT handle FROM help_articles');

    expect(samples).toEqual({ largeHelpArticleHandle: [handle as string] });
  });

  test('同じ種と基準日なら同じ文を出す', () => {
    expect(statementsOf(SMOKE_PROFILE)).toEqual(statementsOf(SMOKE_PROFILE));
  });
});
