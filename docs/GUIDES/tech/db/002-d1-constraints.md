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

FTS5の仮想テーブルは、元のテーブルへの書き込みに自動では追随しない。そのため、FTS5の`external content`テーブルの構成(索引だけを持ち、本文は元のテーブルから読む構成)を採り、SQLiteのトリガー(`CREATE TRIGGER`)で元のテーブルへの追加・更新・削除のたびに索引を同期させる。

```sql
CREATE VIRTUAL TABLE articles_fts USING fts5(title, body, content='articles');

CREATE TRIGGER articles_fts_after_insert AFTER INSERT ON articles BEGIN
  INSERT INTO articles_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;

CREATE TRIGGER articles_fts_after_delete AFTER DELETE ON articles BEGIN
  INSERT INTO articles_fts(articles_fts, rowid, title, body) VALUES ('delete', old.rowid, old.title, old.body);
END;

CREATE TRIGGER articles_fts_after_update AFTER UPDATE ON articles BEGIN
  INSERT INTO articles_fts(articles_fts, rowid, title, body) VALUES ('delete', old.rowid, old.title, old.body);
  INSERT INTO articles_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;
```

- `content_rowid`を省略すると、元のテーブルの`rowid`で索引と行を対応させる。`INTEGER PRIMARY KEY`を明示しないテーブルの`rowid`は`VACUUM`で変わり得る(SQLiteの「[VACUUM](https://sqlite.org/lang_vacuum.html)」)ため、元のテーブルに`INTEGER PRIMARY KEY`のカラムがあれば、`content_rowid`にそのカラムを指定する。
- 参照: SQLiteの「[External Content Tables](https://sqlite.org/fts5.html#external_content_tables)」

#### 仮想テーブルとトリガーの記述場所

仮想テーブルとトリガーはDrizzleのスキーマ定義で表現できないため、カスタムマイグレーション(生のSQL)で記述する。作成方法は「[マイグレーションの生成と適用](001-drizzle-migrations-on-d1.md#マイグレーションの生成と適用)」に従う。
