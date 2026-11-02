# Cloudflare D1の制約と対処

Cloudflare D1に固有の制約(トランザクション、バインド変数の数、エクスポート)と、DrizzleとWranglerを使う場合の対処を定める。

## 前提と用語

ORMにDrizzle(`drizzle-orm`)、データベースにCloudflare D1を使う構成を前提とする。マイグレーションの生成と適用は「[DrizzleとCloudflare D1のマイグレーションと命名規則](001-drizzle-migrations-on-d1.md)」に従う。

| 用語         | 意味                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------- |
| バインド変数 | SQLの`?`の位置に、SQL文とは別に渡す値。Drizzleはクエリに渡した値をバインド変数として送る |
| 仮想テーブル | SQLiteの`CREATE VIRTUAL TABLE`で作るテーブル。全文検索のFTS5テーブルなど                 |
| Time Travel  | D1のバックアップと復旧の機能。保持期間内の任意の時点へデータベースを復元する             |

## D1の制約と対処

| 制約                                                 | 対処                                                                                                                                |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `BEGIN`によるトランザクションが使えない              | `db.transaction()`を使わない。絞り込みと更新は1回のSQLにし、複数テーブルへの書き込みは`db.batch()`にまとめ、競合時の挙動を指定する  |
| 1クエリあたりのバインド変数は100個まで               | `IN`句の値と複数行のINSERTを分割し、整合性が必要なら同一の`db.batch()`にまとめる                                                    |
| 仮想テーブルを含むデータベースをエクスポートできない | バックアップと復旧は`wrangler d1 export`ではなくTime Travelで行う。FTS5の索引はトリガーで同期し、カスタムマイグレーションで記述する |

### トランザクション

D1では`BEGIN`によるトランザクションが使えないため、Drizzleの`db.transaction()`は使用しない。代わりに次のように書く。

#### 絞り込みと更新を1回のSQLにする

レコードを絞り込み、絞り込んだレコードを更新する処理は、1回のSQLで完結させる。`SELECT`で確かめてから`UPDATE`する2回のSQLに分けると、その間に他のリクエストが同じレコードを更新し得る。

```typescript
const published = await db
  .update(articles)
  .set({ status: 'published' })
  .where(and(eq(articles.id, articleId), eq(articles.status, 'draft')))
  .returning({ id: articles.id });

if (published.length === 0) {
  // 対象が無い、または他のリクエストが先に更新した
}
```

#### 複数テーブルへの書き込みをまとめる

複数のテーブルに書き込む場合は、整合性を保つためにDrizzleの`db.batch()`を使用する。`db.batch()`はD1の`D1Database.batch()`として実行され、途中の文が失敗すると全体がロールバックされる。

```typescript
await db.batch([
  db.insert(articles).values(article),
  db.insert(articleRevisions).values(revision),
]);
```

- `db.batch()`の中の文は順に実行されるが、前の文の結果を見て後の文を変えることはできない。前の結果に依存する処理は、上の「絞り込みと更新を1回のSQLにする」と同じく、SQLの条件で表す。

#### ユニーク制約のあるテーブルへの追加

ユニーク制約のあるテーブルにレコードを追加する場合は、同一データの同時作成による制約違反のエラーを防ぐため、`INSERT ... ON CONFLICT DO NOTHING`を付ける。Drizzleでは`onConflictDoNothing()`を使い、既存の行を更新する場合は`onConflictDoUpdate()`を使う。

```typescript
await db
  .insert(users)
  .values({ id: userId, handle })
  .onConflictDoNothing({ target: users.handle });

await db
  .insert(articleViews)
  .values({ articleId, viewedOn, count: 1 })
  .onConflictDoUpdate({
    target: [articleViews.articleId, articleViews.viewedOn],
    set: { count: sql`${articleViews.count} + 1` },
  });
```

- 制約違反を無視せず、どの一意制約に当たったかで結果を変える場合(同じ`db.batch()`で追加した行を参照する子の行も追加する場合や、一意の列を`UPDATE`で書き換える場合)は、`ON CONFLICT`を付けずに`db.batch()`の失敗を捕まえ、エラーの文言の`UNIQUE constraint failed: <テーブル>.<列>`で違反した列を判別する。`db.batch()`は全体がロールバックされるため、どの文も反映されない。
  - `db.batch()`の実行の失敗はD1のエラーがそのまま投げられ、`cause`にSQLiteのエラーを持つ。単文の失敗と、`db.batch()`の中の文の組み立ての失敗は、Drizzleが`DrizzleQueryError`で包み、D1のエラーを`cause`に持つ。どちらも文言は`cause`をたどって調べる。
  - 文言は`UNIQUE constraint failed: users.email: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)`のように列名の後に`: SQLITE_CONSTRAINT ...`が続くため、列名は`:`の手前までを取る。
  - 部分一意索引(`CREATE UNIQUE INDEX ... WHERE`)の違反も、索引の名前ではなく同じ`<テーブル>.<列>`の形で報告される。
  - 判別したい列以外の違反とその他の失敗は、そのまま投げ直す。

```typescript
const UNIQUE_VIOLATION_PATTERN = /UNIQUE constraint failed: ([^:]+)/;

function uniqueViolationColumns(error: unknown): ReadonlySet<string> {
  for (let current = error; current instanceof Error; current = current.cause) {
    const columns = UNIQUE_VIOLATION_PATTERN.exec(current.message)?.[1];
    if (columns !== undefined) {
      return new Set(columns.split(',').map((column) => column.trim()));
    }
  }
  return new Set();
}

try {
  await db.batch([
    db.insert(users).values(user),
    db.insert(userSessions).values(session),
  ]);
} catch (error) {
  if (uniqueViolationColumns(error).has('users.handle')) {
    return 'handle-in-use';
  }
  throw error;
}
```

#### 版と元データの存在を条件にした追加か更新

非同期処理が元データから作る派生の行(全文検索の索引文書など)は、古い版の処理が新しい版の後に届いたり、処理の途中で元データが削除されたりする。版の比較と元データの存在の確認を、追加か更新の1文の条件にする。

```sql
INSERT INTO article_search_documents (source_id, source_version, title)
SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM articles WHERE id = ? AND deleted_at IS NULL)
ON CONFLICT(source_id) DO UPDATE SET source_version = excluded.source_version, title = excluded.title
WHERE excluded.source_version >= article_search_documents.source_version;
```

- 元データが無い場合は`SELECT`が行を返さず、何も追加しない。既にある行の版より古い書き込みは`DO UPDATE`の`WHERE`で更新しない。同じ版は上書きし、同じ処理が重複して届いても同じ結果にする。
- `INSERT … SELECT`に`ON CONFLICT`を続けるときは、`SELECT`に`WHERE`句を必ず付ける。`WHERE`句が無いと、SQLiteが`ON`を結合の条件と解釈して構文の誤りになる(SQLiteの「[UPSERT](https://sqlite.org/lang_upsert.html)」の「Parsing Ambiguity」)。
- 書き込んだか無視したかは、`db.run()`の戻り値の`meta.changes`(0なら無視)で判定する。トリガーが書き込んだ行の数は`meta.changes`に含まれない。

#### 版の検査で一括の書き込み全体を取り消す

読み取った版を前提に複数の文を`db.batch()`で書き込むとき、版が変わっていれば後の文を含めて何も反映しないようにするには、先頭にNOT NULLの列へ「版が一致すれば値、一致しなければNULL」を入れる挿入を置く。`db.batch()`の中では前の文が更新した件数によって後の文を実行するかどうかを分けられないが、制約の違反は全体をロールバックさせるため、版の不一致を失敗に変えて残りの文を止められる。`UPDATE ... WHERE version = ?`は一致しなくても0行の更新で成功し、後の文が反映されてしまうため、この用途には使えない。

```typescript
await db.batch([
  db.insert(articleEvents).values({
    id: eventId,
    articleId: sql`CASE WHEN (SELECT ${articles.version} FROM ${articles} WHERE ${articles.id} = ${articleId}) = ${expectedVersion} THEN ${articleId} ELSE NULL END`,
    occurredAt: at,
  }),
  db
    .update(articles)
    .set({ status: 'archived', version: sql`${articles.version} + 1` })
    .where(eq(articles.id, articleId)),
  db.delete(articleDrafts).where(eq(articleDrafts.articleId, articleId)),
]);
```

- 元の行が無い場合も副問い合わせがNULLになり、版の不一致と同じく失敗する。
- 版の不一致は`D1_ERROR: NOT NULL constraint failed: article_events.article_id: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_NOTNULL)`として投げられ、`cause`にSQLiteのエラーを持つ。文の組み立ての失敗はDrizzleの`DrizzleQueryError`が包むため、「ユニーク制約のあるテーブルへの追加」と同じく`cause`をたどり、検査に使った`<テーブル>.<列>`の違反だけを競合のエラーに変換して、他の失敗はそのまま投げ直す。
- 検査に使う列は、他の文がNULLを入れ得ない列にする。他の文の違反と区別できなくなるためである。

### バインド変数の上限

D1では1クエリあたりのバインド変数が100個までである。次の値の数がこの上限に収まるよう、クエリを分割する。

- `IN`句(Drizzleの`inArray()`)に渡す値の数
- 複数行を一度に追加するINSERTの「行数×カラム数」

分割した書き込みの整合性が必要な場合は、分割した文を同一の`db.batch()`にまとめる。上限は`db.batch()`の中の各文に個別に適用される。

```typescript
const MAX_BOUND_PARAMETERS = 100;

const chunk = <T>(items: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );

const rowsPerStatement = Math.floor(MAX_BOUND_PARAMETERS / columnCount);
const [first, ...rest] = chunk(rows, rowsPerStatement).map((part) =>
  db.insert(articles).values(part),
);
if (first !== undefined) {
  await db.batch([first, ...rest]);
}
```

- 分割した文は互いの対象を参照できないため、「1件でも条件を満たさなければどれも更新しない」のように全件を1つの条件で判定する更新は分割できない。この場合は値の一覧をJSONの文字列として1つのバインド変数で渡し、`json_each`で展開して1文で判定する。

```typescript
const targets = sql`SELECT value AS id FROM json_each(${JSON.stringify(ids)})`;
const blocked = sql`SELECT 1 FROM (${targets}) AS target LEFT JOIN ${articles} AS article ON article.id = target.id WHERE article.id IS NULL OR article.deleted_at IS NOT NULL`;

await db
  .update(articles)
  .set({ status: 'published' })
  .where(
    and(
      sql`${articles.id} IN (SELECT id FROM (${targets}))`,
      sql`NOT EXISTS (${blocked})`,
    ),
  );
```

- 1文が実際に使うバインド変数の数は、Drizzleのクエリの`toSQL().params.length`で確かめられる。
- 参照: Cloudflare Docsの「[Limits](https://developers.cloudflare.com/d1/platform/limits/)」

### エクスポートとバックアップ

D1では、仮想テーブルを含むデータベースをエクスポートできない。そのため、バックアップと復旧は`wrangler d1 export`ではなくD1 Time Travelで行う。

```sh
wrangler d1 time-travel info <データベース名>
wrangler d1 time-travel restore <データベース名> --timestamp=<UNIXタイムスタンプ>
wrangler d1 time-travel restore <データベース名> --bookmark=<ブックマーク>
```

- 復元できる期間(プランにより異なる)などの仕様は、Cloudflare Docsの「[Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/)」で確かめる。
- 参照: Cloudflare Docsの「[Import and export data](https://developers.cloudflare.com/d1/best-practices/import-export-data/#known-limitations-1)」

#### 全文検索の仮想テーブルの同期

FTS5の仮想テーブルは、元のテーブルへの書き込みに自動では追随しない。そのため、FTS5のexternal contentの構成(索引だけを持ち、本文は元のテーブルから読む構成)を採り、SQLiteのトリガー(`CREATE TRIGGER`)で元のテーブルへの追加・更新・削除のたびに索引を同期させる。

- D1(Workers統合テストのローカルのD1を含む)は、FTS5の`prefix`の指定・`bm25()`の列ごとの重み・external contentとトリガーによる同期・`integrity-check`を、SQLiteと同じに扱う。
- 仮想テーブルとトリガーはDrizzleのスキーマ定義で表現できないため、カスタムマイグレーション(生のSQL)で記述する。作成方法は「[マイグレーションの生成と適用](001-drizzle-migrations-on-d1.md#マイグレーションの生成と適用)」に従う。
- 仮想テーブルとトリガーの構成、SQLの出力、元のテーブルの列を変えた後のトリガーの作り直しと再構築、元のテーブルへの書き込みで避ける構文は「[全文検索の索引](004-full-text-search.md)」に従う。
- 参照: SQLiteの「[External Content Tables](https://sqlite.org/fts5.html#external_content_tables)」・「[The CREATE TRIGGER Statement](https://sqlite.org/lang_createtrigger.html)」
