# DrizzleとCloudflare D1のマイグレーションと命名規則

DrizzleのスキーマからCloudflare D1のマイグレーションを生成してWranglerで適用する手順、大文字小文字を区別しないカラムの定義方法、テーブルとカラムの命名規則を定める。

## 前提と用語

ORMにDrizzle(`drizzle-orm`)、マイグレーションの生成に`drizzle-kit`、データベースにCloudflare D1、マイグレーションの適用にWranglerを使う構成を前提とする。`drizzle-orm`・`drizzle-kit`の版は「[依存パッケージの版管理](../coding/002-dependency-versions.md)」に従う。

| 用語                         | 意味                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| スキーマ定義                 | Drizzleの`snakeCase.table`で記述したテーブル定義                                                                                           |
| マイグレーション             | スキーマ定義の変更をデータベースへ反映するSQLファイル                                                                                      |
| カスタムマイグレーション     | スキーマ定義から生成せず、生のSQLを手で記述するマイグレーション                                                                            |
| `<マイグレーションの保存先>` | `drizzle-kit`の設定の`out`に指定する、マイグレーションを置くディレクトリ。Wrangler設定では、Wrangler設定のファイルからの相対パスで指定する |

## マイグレーション・大文字小文字を区別しないカラム

### マイグレーションの生成と適用

- マイグレーションのSQLは`drizzle-kit generate`で生成する。
- スキーマ定義で表現できない内容(仮想テーブル・トリガーなど)は、`drizzle-kit generate --custom`で空のマイグレーションを作成し、その中に生のSQLで記述する。
- マイグレーションの適用は`wrangler d1 migrations apply`で行う。ローカル環境への適用では、「[ローカル状態の永続化と共有](../infra/001-wrangler-conventions.md#ローカル状態の永続化と共有)」に従って`--local`と`--persist-to`を付ける。
- `drizzle-kit migrate`・`drizzle-kit push`は使用しない。適用済みのマイグレーションはWranglerがデータベース内の`d1_migrations`テーブルに記録する。Drizzleの適用コマンドを併用すると、適用の状態がWranglerの記録と食い違う(`drizzle-kit migrate`はDrizzle独自のテーブルに記録し、`drizzle-kit push`はマイグレーションを経ずにスキーマを直接変更する)。そのため、適用の管理をWranglerに一本化する。

```sh
bunx drizzle-kit generate --name=<マイグレーションの名前>
bunx drizzle-kit generate --custom --name=<マイグレーションの名前>
wrangler d1 migrations apply <データベース名> --local --persist-to <ローカル状態の保存先>
```

### マイグレーションの検出設定

- `drizzle-kit`のマイグレーションの出力は、`<マイグレーションの保存先>/<日時>_<名前>/migration.sql`という入れ子構造である。Wranglerは既定では`migrations_dir`の直下の`*.sql`だけを探索するため、この構造のマイグレーションを検出しない。
- そのため、Wrangler設定のD1バインディングに`migrations_dir`と、`<migrations_dirの値>/*/migration.sql`を値とする`migrations_pattern`を指定する。
  - `migrations_pattern`はWrangler設定のファイルからの相対パスのglobで、`migrations_dir`の値で始まる必要がある。
  - 適用済みのマイグレーションは、`migrations_dir`からの相対パス(`<日時>_<名前>/migration.sql`)の名前で記録される。

```jsonc
{
  "d1_databases": [
    {
      "binding": "<バインディング名>",
      "database_name": "<データベース名>",
      "database_id": "<データベースID>",
      "migrations_dir": "<マイグレーションの保存先>",
      "migrations_pattern": "<マイグレーションの保存先>/*/migration.sql",
    },
  ],
}
```

- `wrangler d1 migrations create`は`migrations_dir`の直下にしかファイルを作らず入れ子構造に対応しないため、マイグレーションの作成には使用しない。
- 参照: Cloudflare Docsの「[Nested migration layouts](https://developers.cloudflare.com/d1/reference/migrations/#nested-migration-layouts)」

### 大文字小文字を区別しないカラム

テーブルの特定のカラムに限り、アルファベットの大文字小文字を問わずに文字列を照合させたい場合は、照合順序`nocase`を指定したカラム型を使う。URLのスラッグとして使うユーザーハンドルのカラムなどで、大文字小文字だけが異なる値の重複登録を一意制約で防ぎ、検索でも同一視するのに役立つ。

- Drizzleにはカラムの照合順序を指定するAPIが無い。そのため、`customType`の`dataType()`が`'text collate nocase'`を返す共通のヘルパー`textNoCase`を定義し、テーブル定義でそのカラム型を使う。

```typescript
import { customType } from 'drizzle-orm/sqlite-core';

export const textNoCase = customType<{ data: string }>({
  dataType() {
    return 'text collate nocase';
  },
});
```

```typescript
import { snakeCase } from 'drizzle-orm/sqlite-core';

import { ulidPrimaryKey } from './_shared/columns.ts';
import { textNoCase } from './_shared/text-no-case.ts';

export const users = snakeCase.table('users', {
  id: ulidPrimaryKey(),
  handle: textNoCase().notNull().unique(),
});
```

- `textNoCase`は、共通カラムの部品と同じくスキーマ定義のディレクトリの`_shared/`に置く。配置と主キーの部品(`ulidPrimaryKey`)は「[データベースのスキーマ規約](003-schema-conventions.md)」に従う。
- `nocase`が同一視するのはASCIIの大文字小文字だけで、非ASCII文字(全角英字・アクセント付きの文字など)は区別される。
- 既存のカラムへ後から指定すると、テーブルを作り直すマイグレーションが生成される。そのため、`textNoCase`はテーブルを新規に作成するときに指定する。

## 命名規則

- テーブル名は小文字の複数形にする(例: `users`・`articles`)。
- テーブル名は`snakeCase.table`の第1引数で指定する。
- カラム名は、TypeScriptのキーをキャメルケースで書き、データベースではスネークケースにする(例: `createdAt`→`created_at`)。
  - `drizzle-orm` v1には、接続の設定や`drizzle-kit`の設定で列名の変換を指定する`casing`が無い。そのため、テーブルは`drizzle-orm/sqlite-core`の`snakeCase.table`で定義し、変換をテーブル定義に持たせる。マイグレーションの生成と実行時のクエリが同じテーブル定義を読むため、両者の列名が一致する。
  - `sqliteTable`・`sqliteTableCreator`は使用しない。列名がキーのまま(キャメルケース)で作られる。静的解析の`no-restricted-imports`で、スキーマ定義からのimportを禁止する。
  - カラム型の関数に列名を渡すと(`text('source_id')`など)、`snakeCase.table`の中でもその名前が使われる。変換結果が意図と異なるキーは、列名を明示する。例えば、大文字に続く数字の前でも区切られるため、`totpSecretV2`は`totp_secret_v_2`になる。

```typescript
import { snakeCase, text } from 'drizzle-orm/sqlite-core';

import { ulidPrimaryKey } from './_shared/columns.ts';

export const accounts = snakeCase.table('accounts', {
  id: ulidPrimaryKey(),
  displayName: text().notNull(), // display_name
  totpSecretV2: text('totp_secret_v2'),
});
```

## 関連する制約

D1ではトランザクション・バインド変数の数・エクスポートなどに固有の制約がある。クエリとスキーマを設計するときは「[D1の制約と対処](002-d1-constraints.md#d1の制約と対処)」に従う。
