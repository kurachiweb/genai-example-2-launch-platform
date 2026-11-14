# 利用者間の関係の保存と一覧

利用者どうしの一方向の関係を、組ごとに1行で保存し、件数と一覧を利用者の可視性で絞り、退会と物理削除の波及を上限件数ずつ行うための規約を定める。組の一意とCHECK制約、関係の記録と解除、退会の論理削除、可視性で絞った件数と一覧のカーソル、物理削除の上限件数ずつの処理を扱う。テーブルの共通の規約は「[データベースのスキーマ規約](003-schema-conventions.md)」、一括の書き込みと制約の違反の扱いは「[Cloudflare D1の制約と対処](002-d1-constraints.md)」、退会・停止・物理削除の順序は「[ユーザーライフサイクルイベント](../backend/007-user-lifecycle-events.md)」に従う。

## 前提と用語

| 用語         | 意味                                                                                                                                                                                                                 |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 起点         | 関係を張る側の利用者。行の`source_id`                                                                                                                                                                                |
| 相手         | 関係を張られる側の利用者。行の`target_id`                                                                                                                                                                            |
| 関係の行     | 起点と相手の組の1行。組ごとに高々1行                                                                                                                                                                                 |
| 可視         | 利用者が退会しておらず、かつ停止中でないこと。公開の一覧と件数は、この条件で利用者を絞る。テーブル定義と並べて置いた条件を使う(「[利用者の情報の参照](../backend/007-user-lifecycle-events.md#利用者の情報の参照)」) |
| 解除         | 利用者が関係を取り消す操作。関係の行を物理削除する                                                                                                                                                                   |
| 論理削除     | 利用者の退会の時に、関係の行の`deleted_at`を設定すること                                                                                                                                                             |
| 上限件数ずつ | 1回の文で消す件数に上限を置き、残りを後の呼び出しに分けること                                                                                                                                                        |

本プロジェクトの関係の呼び名とテーブル名は、技術ドキュメントに写さず、プロジェクト固有の値の文書「[本プロジェクト固有の値](../../../onboardings/project-values.md)」に置く。以下の例のテーブル名は`user_relations`とする。

## テーブルの形

```typescript
export const userRelations = snakeCase.table(
  'user_relations',
  {
    id: ulidPrimaryKey(),
    sourceId: text()
      .notNull()
      .references(() => users.id),
    targetId: text()
      .notNull()
      .references(() => users.id),
    ...timestamps(),
    ...softDelete(),
  },
  (table) => [
    uniqueIndex('user_relations_source_id_target_id_unique').on(
      table.sourceId,
      table.targetId,
    ),
    index('user_relations_source_id_created_at_id_idx').on(
      table.sourceId,
      table.createdAt,
      table.id,
    ),
    index('user_relations_target_id_created_at_id_idx').on(
      table.targetId,
      table.createdAt,
      table.id,
    ),
    check(
      'user_relations_not_self_check',
      sql`${table.sourceId} <> ${table.targetId}`,
    ),
  ],
);
```

| 制約・索引                          | 目的                                                          |
| ----------------------------------- | ------------------------------------------------------------- |
| `(source_id, target_id)`の一意      | 同じ組の関係は1行にする。論理削除済みの行も一意の対象に含める |
| `source_id <> target_id`のCHECK     | 自分自身への関係を、データベースで拒否する                    |
| `(source_id, created_at, id)`の索引 | 起点の側の一覧と件数を、索引の順に読む                        |
| `(target_id, created_at, id)`の索引 | 相手の側の一覧と件数を、索引の順に読む                        |

- 一意制約とCHECK制約は、アプリケーションの検査が同時の操作で破られるため、データベースに置く。
- 外部キーは両方とも利用者のテーブルを参照し、`ON DELETE`を指定しない(「[外部キー](../backend/007-user-lifecycle-events.md#外部キー)」)。
- 論理削除は退会の時にだけ行い、取り消さない。論理削除済みの行も一意の対象に含めるため、同じ組を新しい行で作り直すことはできない。論理削除された関係を復活させない規約は、この性質に依存する。
- 解除は物理削除なので、解除の後に同じ組を記録すると新しい行になる。

## 関係の記録

```sql
INSERT INTO user_relations (id, source_id, target_id, created_at, updated_at)
SELECT ?, ?, ?, ?, ?
WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND <可視の条件>)
ON CONFLICT (source_id, target_id) DO NOTHING;
```

- 相手が可視であることの判定と挿入を1文で行う。判定と挿入の間に、相手の停止や退会が挟まらない。
- `INSERT … SELECT`に`ON CONFLICT`を続けるため、`SELECT`には`WHERE`句を必ず付ける(「[版と元データの存在を条件にした追加か更新](002-d1-constraints.md#版と元データの存在を条件にした追加か更新)」)。
- 同じ組の2回目以降の記録は`ON CONFLICT DO NOTHING`で無視し、結果を変えない(冪等)。
- 挿入の件数(`meta.changes`)で結果を分ける。1なら挿入した。0なら、有効な関係の行があれば既存、無ければ相手が使えない。論理削除済みの行しか無い組も相手が使えない扱いにする。

## 解除と退会

- 解除は、関係の行を物理削除する。解除した関係を後から参照する要件が無いため、論理削除にしない。論理削除にすると、件数と一覧の条件に解除の状態が加わる。
- 退会は、退会の確定と同じ一括の書き込みで、退会した利用者を起点または相手とする行を論理削除する。条件には`deleted_at IS NULL`を含め、同じ利用者への後の遷移と食い違わないようにする(「[同期の波及処理](../backend/007-user-lifecycle-events.md#同期の波及処理)」)。
- 停止と停止の解除では、関係の行を変えない。件数と一覧の読み取りで可視の条件により除き、停止の解除で再び現れる。

## 件数と一覧

### 件数

```typescript
const [row] = await db
  .select({ count: count() })
  .from(userRelations)
  .innerJoin(users, eq(users.id, userRelations.sourceId))
  .where(
    and(
      eq(userRelations.targetId, userId),
      notDeleted(userRelations.deletedAt),
      visibleUsers(),
    ),
  );
```

- 件数は、関係の行の起点の側の利用者を可視の条件で結合して数える。除外を読み取りで行うため、停止の解除で数が戻り、記録を変える必要がない。
- 件数は、絞り込みに使う相手の側の列(`target_id`)の索引で数える。

### 一覧

```typescript
function afterPosition(
  position: { readonly t: number; readonly id: string } | undefined,
): SQL | undefined {
  if (position === undefined) {
    return undefined;
  }
  const createdAt = new Date(position.t);
  return or(
    lt(userRelations.createdAt, createdAt),
    and(
      eq(userRelations.createdAt, createdAt),
      lt(userRelations.id, position.id),
    ),
  );
}

const rows = await db
  .select({
    relationId: userRelations.id,
    relatedAt: userRelations.createdAt,
    userId: users.id,
    handle: users.handle,
  })
  .from(userRelations)
  .innerJoin(users, eq(users.id, userRelations.sourceId))
  .where(
    and(
      eq(userRelations.targetId, userId),
      notDeleted(userRelations.deletedAt),
      visibleUsers(),
      afterPosition(after),
    ),
  )
  .orderBy(desc(userRelations.createdAt), desc(userRelations.id))
  .limit(first + 1);
```

- 並び順は作成日時の降順、同じ日時はIDの降順とする。位置は`(created_at, id)`の組で、「[ページングの型と命名](../backend/004-graphql-server.md#ページングの型と命名)」の`encodeCursor`で符号化する。
- 次の位置の条件は、並び順のキーと同じ順に`created_at < t OR (created_at = t AND id < id)`とする。同じ日時の行が複数あっても、位置を境に抜けや重複が生じない。
- `first`より1件多く読み、超えた分で続きの有無を決める。
- 可視の絞り込みは結合の条件として同じ問い合わせに含めるため、除かれた利用者がいても1ページの件数は保たれる。除外を後から行うと、1ページの件数が減る。
- 相手の表示用の情報は、同じ問い合わせに左結合で含める。件数ごとに問い合わせを分けない。
- カーソルが不正な場合は、「[ページングの型と命名](../backend/004-graphql-server.md#ページングの型と命名)」の`invalid_cursor`で拒否する。

## 上限件数ずつの物理削除

利用者の物理削除の段階で、その利用者を起点または相手とする関係の行を全て消す。利用者の行より先に消さないと、外部キーの違反で利用者の行を消せない。

```typescript
const targets = db
  .select({ id: userRelations.id })
  .from(userRelations)
  .where(
    or(eq(userRelations.sourceId, userId), eq(userRelations.targetId, userId)),
  )
  .limit(limit);

const deleted = await db
  .delete(userRelations)
  .where(sql`${userRelations.id} IN ${targets}`)
  .returning({ id: userRelations.id });

return deleted.length;
```

- 1回の文で消す件数は、呼び出し側が渡す上限(`limit`)までとする。上限の値は、1回の処理の時間に収まり、バインド変数の上限(「[バインド変数の上限](002-d1-constraints.md#バインド変数の上限)」)に影響しない値にする。
- `DELETE`の`LIMIT`は、SQLiteのコンパイル時の選択肢が有効な場合にしか使えないため、主キーの副問い合わせで上限まで選び、`IN`で消す。
- 起点と相手の両方向を同じ文で消す。一方向だけを消すと、もう一方向の行が残り、利用者の行を消せない。
- 戻り値の件数で続きを判定する。件数が上限に達したら、残りがあり得るため続きにする。上限に達しなかったら、残りは無いため次の段階へ進む。判定の対応付けは「[保有者単位で上限件数ずつ処理する操作の対応付け](../backend/007-user-lifecycle-events.md#保有者単位で上限件数ずつ処理する操作の対応付け)」に従う。
- 削除は冪等にする。同じ利用者の関係の行が無ければ0件を返し、何も変えない。

## テスト

- 組の一意とCHECK制約は、生成したマイグレーションのSQLに含まれることを確かめ、Workers統合テストで同じ組の挿入と自分自身への関係の挿入が拒否されることを確かめる。
- 記録は、同じ組の2回目で結果が変わらないこと、論理削除済みの組が復活しないこと、相手が可視でない場合に挿入されないことを確かめる。
- 件数と一覧は、停止の解除で数が戻ること、同じ日時の行がIDの降順で並び、位置を境に抜けと重複が無いこと、除かれた利用者がいても1ページの件数が保たれることを確かめる。
- 上限件数ずつの削除は、上限ちょうどの件数の後に続きを示す戻り値になること、上限未満の件数で残りが無くなること、両方向の行が同じ文で消えることを確かめる。
- テストの後始末は、関係の行を利用者の行より先に消す。
- テストの種別と命名は「[テストの種別と命名](../testing/001-test-strategy.md#テストの種別と命名)」に従う。
