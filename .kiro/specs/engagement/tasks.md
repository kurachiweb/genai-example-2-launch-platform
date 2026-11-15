# Implementation Plan

- [ ] 1. 基盤: 入力の規則・テーブル・サービス仕様
- [x] 1.1 コメントと評価の入力の規則を、4アプリが読み込める共有の定義として作る
  - 前提: dev-tooling〜notificationsの20specの全タスクが完了していること(directory-discoveryの`PRODUCT_PAGE_SECTIONS`・`PRODUCT_LAUNCH_SECTIONS`・`DIRECTORY_ITEM_METRIC_SOURCES`・`DIRECTORY_ITEM_METRICS`と区画の文脈の型・E2Eの`e2e/support/directory-fixtures.ts`、product-launchの`core/product`の`ProductDirectory`・`PRODUCT_PLATFORM_TYPES`・`visibleProducts()`・`wonLaunchExists()`・プロダクトライフサイクルの登録口、identity-authの`AccountGuard`・`visibleUsers()`・`verifiedUsers()`・ユーザーライフサイクルの登録口・`LoginRequiredDialog`・`resendVerificationEmail`、content-processingの`markdownTextSchema`・`MarkdownEditor`・`useMarkdownOptions`、user-profile-socialの`UserSummary`・`userSummaryLoader`・`UserAvatar`、backend-platformの`SCHEDULED_JOBS`と改訂2のE2Eの共有の補助`triggerScheduled`(`e2e/support/scheduled-trigger.ts`)、admin-foundationのE2Eの`executeLocalD1`。2026-11-15のギャップ分析で全タスクの完了と契約の実在を確かめた)。無ければ該当するタスクを保留して開発者へ報告する(`triggerScheduled`が無い場合は9.1の4:21の匿名化の確かめだけを保留する)
  - 先に、単体テストで、本文の2,000書記素の境界(結合文字を含む絵文字)・空白だけ・使用できない文字の文言と順、評価の0・6・小数・文字列の拒否、1ページ10件と3階層の定数、bot対策の操作名3つ、見出しのアンカーの接頭辞がコメントのIDごとに異なり英小文字と数字の32文字以内になること、キックオフ前のローンチと自身のプロダクトの評価の文言の定数(`LAUNCH_NOT_COMMENTABLE_MESSAGE`・`OWN_PRODUCT_RATING_MESSAGE`)が文言規則(設計のError Handling)の文言と一致することを確かめる
  - 完了状態: 単体テストが成功し、apiとclientの型検査で規則を読み込める
  - _Requirements: 1.2, 1.3, 2.2, 3.1, 7.3, 8.1, 9.5, 11.6_

- [x] 1.2 コメントと評価のテーブル、表示できるコメントと有効な評価の条件、マイグレーションを作る
  - 先に、テーブルの定義の単体テストで、階層の1〜3と評価の1〜5の制約、利用者とプロダクトの組の一意、外部キー(プロダクト・ローンチ・親のコメント・利用者)に削除時の動作の指定が無いこと、コメントのトップレベルのページ・返信のまとめ読み・投稿者・プロダクト・削除の日時の索引と、評価の評価者の索引を確かめる
  - 表示できるコメントの条件(削除・非公開化・匿名化の印が無く、投稿者が紐付いていて可視)と有効な評価の条件(無効化・論理削除の印が無く、評価者が可視)を、利用者のテーブルとの結合で使う条件の部品として作る
  - 階層の1〜3と評価の1〜5の制約は、`apps/db`が`common-lib`を読み込めないためテーブル定義のファイルに`COMMENT_MAX_DEPTH`・`RATING_SCORES`の写しの名前付きのリテラルの定数を置いてCHECKをそこから組み立て(値は文に埋め込む)、写しの側に元の場所と照合のテストのファイル名をコメントで示す。ルートの`config/engagement-contract-copies.unit.test.ts`で写しの定数と元の値との一致を確かめ(他のアプリのファイルを`import`せず、ソースを構文解析して定数の初期化子を比べる)、ルートの`package.json`の`check:contract-copies`の引数に加える
  - mainの最新を取り込んでからマイグレーションを生成する
  - 完了状態: 単体テストと`bun run check:contract-copies`が成功し、マイグレーションをローカルに適用できる
  - _Requirements: 2.2, 5.1, 9.2, 11.1, 14.4_

- [x] 1.3 (P) ページ配置・文言規則・日次タイムラインに、本specの決定と画面と文言を先に書く
  - ページ配置: 評価欄の状態(未ログイン・未確認・本人・0件・取得の失敗)、コメント欄の開閉と件数の数え方(置き換え表示を数えない)・「あなた」のバッジ・投稿欄の評価の行、2026-10-24に開発者が確定した仮1〜仮4の決定の注記を加える
  - 文言規則: 設計のError Handlingに挙げた追加の文言(エラー・トースト・空の状態・削除の確認・評価欄の状態)を加える
  - 日次タイムライン: 4:21のジョブの表に本specの匿名化のジョブ(1400)の行を加える(表が無ければ上流の行とともに作る)
  - 完了状態: 3つの文書が整形の検査を通り、6・7のタスクが参照する文言がすべて文言規則にある
  - _Boundary: `docs/GUIDES/service/design/002-page-layouts.md`・`003-text-and-copy-rules.md`・`docs/GUIDES/service/overview/007-daily-timeline.md`_
  - _Requirements: 15.5_

- [ ] 2. 共有部品
- [x] 2.1 共有部品の契約とDIの識別子を一括で作り、コメントのストアの照会と投稿・返信の条件付きの書き込みの文を作る
  - 先に、単体テストで、識別子`ENGAGEMENT_PLATFORM_TYPES`が`Symbol.for('engagement.<名前>')`の値を持ち凍結されていることを確かめる(`core/media/identifiers.unit.test.ts`と同じ形)
  - 先に、ローカルD1のWorkers統合テストで、投稿の文がプロダクトの非公開化・論理削除・投稿者の停止・未掲載の他者のプロダクト・投稿者の未確認のいずれかで一括の書き込みごと失敗し、投稿者本人なら未掲載のプロダクトでも書き込めること、返信の文が親の第3階層・置き換え表示・別のローンチで失敗し、返信のルートと階層が親から決まること、本文をマークダウンの原文のまま保存すること、識別子からの照会が状態の印と投稿者とプロダクトとローンチを返すことを確かめる
  - 共有部品(コメントのストア・スレッドの照会・評価のストア・匿名化と物理削除のストア・コメントと評価の出力・管理画面のコメントと評価の一覧の照会)の契約と入出力の型を`apps/backend-lib/core/engagement/ports.ts`に、コメントと評価の文の部品を加えたDIの識別子を`core/engagement/identifiers.ts`に、ここで一括で作る(2.2〜2.7は識別子を作らない)。api・eventのapplication層は`**/lib/workers/**`を型も含めて読み込めないため、application層と後続specが受け取る契約と識別子は`core`に置き、`workers/engagement`には実装と束縛だけを置く
  - 投稿・返信の条件付きの書き込みの文はデータベースの型を持つため、文の部品`CommentStatements`(`workers/engagement/comment-statements.ts`、apiのinfrastructure層だけが使う)に作り、識別子からの照会はD1の実装(`workers/engagement/d1-comment-store.ts`)に作る
  - 完了状態: 単体テストとWorkers統合テストが成功し、識別子でコメントのストアを取得する型検査が通り、`core/engagement`が`workers`・`apps/db`を読み込まない(静的解析が成功する)
  - _Requirements: 1.9, 2.1, 2.3, 2.4, 7.4, 12.5_

- [x] 2.2 コメントの文の部品に編集・削除・非公開化の書き込みを加える
  - 先に、Workers統合テストで、編集の文が他者・削除済み・非公開化・匿名化のコメントと閲覧できないプロダクトで一括の書き込みごと失敗し、成功で編集の日時が入ること、削除の文が自分の未削除・未非公開化のコメントだけを変え、変更の件数で対象の有無が分かること、非公開化と復元が変更の有無と不在を返し、渡した文を同じ一括の書き込みに入れることを確かめる
  - 完了状態: Workers統合テストが成功する
  - _Boundary: CommentStatements_
  - _Requirements: 4.1, 4.3, 12.2, 12.4_

- [x] 2.3 (P) スレッドのページとローンチごと・プロダクトごとの件数の照会を作る
  - 先に、Workers統合テストで、トップレベルの新しい順の10件と11件目の境界、カーソルの続きが間の投稿で重複・欠落しないこと、各ルートの全ての返信が古い順に1回の一括の読み取りで返ること、退会・本人の削除・停止・非公開化・匿名化の5つの事情で本文・投稿者・日時を返さず同じ形になること、返信の無い置き換え表示のトップレベルも返ること、停止の解除と非公開化の取消で再び表示されること、件数が置き換え表示を数えないことを確かめる
  - 完了状態: Workers統合テストが成功する
  - _Depends: 2.1_
  - _Boundary: CommentThreadQuery_
  - _Requirements: 3.1, 3.2, 3.4, 3.6, 3.7, 5.1, 5.2, 5.3, 5.4, 5.5, 14.1, 14.4, 14.6_

- [x] 2.4 (P) 評価のストア(取消・自分の評価・集計)と評価の文の部品(上書きの文・無効化)を作る
  - 先に、Workers統合テストで、同じ利用者の2回目の評価が上書きになり1件のままであること、上書きの文がプロダクトの非公開化・未掲載・評価者の未確認で失敗すること、取消が物理削除で無くても成功すること、無効化を上書きで保ち取消で行ごと消えること(仮3)、自分の評価が無効化されていても返ること、平均値と件数から無効化・退会の論理削除・停止中の評価者を除き停止の解除で戻ること(仮2)、無効化と取消が変更の有無と不在を返し渡した文を同じ一括の書き込みに入れることを確かめる
  - 完了状態: Workers統合テストが成功する
  - _Depends: 2.1_
  - 上書きの文と無効化は呼び出し側の文を受け取りデータベースの型を持つため、`workers/engagement/rating-statements.ts`の`RatingStatements`(apiのinfrastructure層だけが使う)に作り、取消・自分の評価・集計は`core/engagement`の`RatingStore`のD1の実装(`d1-rating-store.ts`)に作る
  - _Boundary: RatingStore、RatingStatements_
  - _Requirements: 9.2, 9.3, 9.10, 11.1, 11.2, 11.11, 12.3, 12.4, 14.4_

- [x] 2.5 (P) 匿名化と利用者・プロダクト単位の物理削除のストアを作る
  - 先に、Workers統合テストで、削除の業務日付から13日目の閾値より前の未匿名化のコメントだけが本文を空にされ投稿者を外され行が残ること(12日目の行は残る)、非公開化だけのコメントが対象にならないこと、500件の上限と期限を過ぎた件数の数え方、利用者単位の処理で全てのコメントの紐付けが外れ評価が消え、続けてidentity-authの利用者の物理削除が外部キーで失敗しないこと、プロダクト単位の処理で返信を含む全てのコメントと評価が階層の深い順に消え、続けてproduct-launchのプロダクトの物理削除が失敗しないこと、それぞれ2回実行しても結果が同じことを確かめる
  - 完了状態: Workers統合テストが成功する
  - _Depends: 2.1_
  - _Boundary: EngagementErasureStore_
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 13.5, 13.6, 13.7_

- [x] 2.6 出力の部品を作り、共有の束縛をapiとeventに組み込む
  - 先に、Workers統合テストで、コメントの出力が本人の未匿名化のコメントだけを作成の古い順に返し(削除済み・非公開化を印付きで含む)、評価の出力が本人の論理削除されていない評価だけを返し、管理者による無効化の有無(`invalidatedByAdmin`)が無効化した評価で真・していない評価で偽になることを確かめる(仮5、data-exportの依頼)
  - コメントのストア・コメントの文の部品・スレッドの照会・評価のストア・評価の文の部品・匿名化と物理削除のストア・出力の部品のD1の実装を処理単位で束縛するモジュール(`workers/engagement/engagement-platform-module.ts`)を作り、apiとeventの束縛の一覧へ同時に加える
  - 完了状態: Workers統合テストと、3経路(api・eventの`fetch`・eventの`queue`)のDIの解決の検査が成功する
  - _Requirements: 14.3, 14.4_

- [x] 2.7 管理画面のコメントと評価の一覧の照会を作り、共有の束縛に追記する(仮6)
  - 契約の形(`AdminCommentDirectory`・`AdminRatingDirectory`と記録・絞り込み・状態の型)は本specの設計を正とし、ugc-moderationはそれを使う(形は変えない)
  - 先に、ローカルD1のWorkers統合テストで、コメントの投稿者・プロダクト・投稿期間(開始を含み終了を含まない境界)の絞り込み、5つの状態(非公開化・削除・匿名化・投稿者の退会や停止・表示中)の絞り込みと優先(非公開化かつ削除は非公開化、停止中の投稿者は投稿者が利用できない状態)、非公開化・削除のプロダクトのコメントも返すこと、本文の先頭200文字の抜粋と匿名化の空、作成の新しい順とカーソルの続きと不正なカーソルの拒否を確かめる。評価は、プロダクト・評価者・無効化の状態の絞り込み、更新の新しい順とカーソル、退会の論理削除の行を返さないこと、識別からの照会が存在しない識別を除き、91件以上の識別でも90件ずつ読んで全件を返すことを確かめる
  - 2つの照会を共有の束縛のモジュールに追記する
  - 完了状態: Workers統合テストと、3経路(api・eventの`fetch`・eventの`queue`)のDIの解決の検査が成功し、`ENGAGEMENT_PLATFORM_TYPES.AdminCommentDirectory`・`AdminRatingDirectory`で照会を取得する型検査が通る
  - _Depends: 2.1, 2.6_
  - _Boundary: AdminCommentDirectory、AdminRatingDirectory_
  - _Requirements: 12.6, 14.5_

- [ ] 3. APIサーバーのユースケース
- [x] 3.1 (P) 閲覧の可否・コメントできるローンチ・スレッドの組み立ての純粋な規則を作る
  - 先に、単体テストで、閲覧の可否(不在・可視でない・掲載中・未掲載の他者と本人)、コメントできるローンチ(予定・組み合わせ済み・当日・終了・取消・不在)、スレッドの照会の行からスレッドへの組み立て、投稿者本人と閲覧者自身の判定、置き換え表示でバッジと作者の判定が常に偽になることを確かめる
  - 閲覧の可否は、directory-discoveryの`decideProductPageAccess`(ハンドルの解決が入力)と共有せず、同じ規則(可視かつ、掲載中か投稿者本人)を本specに持ち、同じ真理値表の単体テストで揃える。可視でないプロダクトは`findSummaries(ids, 'visible')`の結果に無いため、照会に無いことを閲覧できないとする
  - 完了状態: 単体テストが成功し、規則がD1を読み込まない
  - _Depends: 2.3_
  - _Boundary: EngagementAccess、CommentThreads_
  - _Requirements: 1.4, 1.5, 3.2, 3.3, 5.2, 13.2_

- [x] 3.2 投稿先の解決を作り、apiのDIの識別子と束縛のモジュールを作る
  - 先に、単体テスト(模擬の`ProductDirectory`)で、プロダクトの照会とローンチの一覧を並行に1回ずつ読み、閲覧できなければ未解決、ローンチが別のプロダクトのものや取消なら未解決のローンチを返すこと、非公開化・論理削除(投稿者の退会を含む)・投稿者の停止のプロダクトが未解決になり、復元と停止の解除で解決されることを確かめる
  - apiのDIの識別子(投稿先の解決・コメントと評価のユースケース・コメントと評価の書き込みの単位・スレッドの読み取り・2つの管理の操作口・コメント数の供給元・退会の同期の処理・匿名化のジョブ)をここで一括で作り、apiの束縛のモジュールを作って束縛の一覧へ加える(3.3以降と5.1・5.2は束縛を追記する)
  - 完了状態: 単体テストと、apiのDIの解決の検査が成功する
  - _Depends: 2.6_
  - _Requirements: 1.4, 3.5, 9.6, 13.2, 13.3, 13.4_

- [x] 3.3 コメントの投稿と返信のユースケースを作る(評価の同時保存を含む)
  - 先に、単体テスト(偽の`CommentWriter`・`CommentStore`・`ProductDirectory`などの模擬のポート)で、判定の順(投稿先→ローンチの状態→親→評価)と各エラー、投稿者本人のコメントを受け付けること、返信への評価と投稿者本人の評価の拒否、評価を添えた投稿でコメントと評価が1回の書き込みの単位に渡ること、書き込みの単位が`rejected`を返したら読み直しで理由が分類されることを確かめる
  - 同じく先に、Workers統合テストで、書き込みの単位の実装`D1CommentWriter`が評価を添えた投稿でコメントと評価を1回の一括の書き込みで保存し、評価の違反でコメントも残らず`rejected`を返すこと、評価を添えない投稿で既存の評価が変わらないこと、判定の後の非公開化・停止・親の削除で書き込まれず`rejected`になること、条件の違反以外のD1の例外を投げることを確かめる
  - `launch_not_commentable`の文言は`common-lib/engagement`の`LAUNCH_NOT_COMMENTABLE_MESSAGE`を使う
  - application層に書き込みの単位のポート`CommentWriter`(`apps/api/src/application/engagement/ports.ts`)を定義し、文の部品`CommentStatements`・`RatingStatements`から文を組み立てて`db.batch()`を実行する実装`D1CommentWriter`をinfrastructure層に作る。application層はデータベースの接続・SQLの文・一括の書き込みを扱わない
  - 完了状態: テストが成功し、apiの束縛に追記したユースケースと書き込みの単位を解決でき、静的解析でapplication層に`**/lib/workers/**`の読み込みが無い
  - _Requirements: 1.1, 1.5, 1.8, 1.9, 2.1, 2.3, 2.4, 2.5, 7.4, 10.1, 10.2, 10.3, 10.4_

- [x] 3.4 コメントの編集と削除のユースケースを作る
  - 先に、単体テスト(模擬のポート)とWorkers統合テスト(`D1CommentWriter`の編集と削除を含む)で、自分の表示できるコメントだけを編集・削除でき、他者・置き換え表示・閲覧できないプロダクトのコメントが同じ「見つからない」になること、トップレベルの編集だけ評価を添えられ、評価の違反で本文も更新されないこと、削除の変更が0行なら書き込みの単位が`not-found`を返すこと、編集の本文の規則、投稿からの経過時間やローンチの状態で制限しないことを確かめる
  - `CommentWriter`に編集と削除の書き込みの単位を加え、`D1CommentWriter`に実装する
  - 完了状態: テストが成功し、apiの束縛に追記したユースケースを解決でき、静的解析でapplication層に`**/lib/workers/**`の読み込みが無い
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.7_

- [x] 3.5 スレッドの読み取りとローンチごとの件数のユースケースを作る
  - 先に、単体テストとWorkers統合テストで、閲覧できないプロダクトと別のプロダクトのローンチでnullを返すこと、カーソルの符号化と続き、不正なカーソルが`invalid_cursor`になること、閲覧者による「投稿者」「あなた」の判定、ローンチごとの件数を返すことを確かめる
  - 完了状態: テストが成功し、apiの束縛に追記したユースケースを解決できる
  - _Requirements: 3.1, 3.5, 3.6_

- [x] 3.6 評価のユースケースを作る
  - 先に、単体テスト(偽の`RatingWriter`・`RatingStore`などの模擬のポート)とWorkers統合テスト(`D1RatingWriter`を含む)で、閲覧できないプロダクトの評価と取消の拒否、自身のプロダクトの拒否、初回と上書きと取消の後の平均値・件数・自分の評価、評価の無い取消の成功、無効化された自分の評価を返すこと、投稿者本人と未ログインの自分の評価がnullであること、判定の後の非公開化で書き込まれず`rejected`になることを確かめる
  - `rating_own_product`の文言は`common-lib/engagement`の`OWN_PRODUCT_RATING_MESSAGE`を使う
  - application層に書き込みの単位のポート`RatingWriter`を定義し、`RatingStatements`の上書きの文を実行する実装`D1RatingWriter`をinfrastructure層に作る
  - 完了状態: テストが成功し、apiの束縛に追記したユースケースと書き込みの単位を解決でき、静的解析でapplication層に`**/lib/workers/**`の読み込みが無い
  - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.6, 9.10, 11.9, 11.11_

- [x] 3.7 管理の操作口とディレクトリのコメント数の供給元を作り、apiの項目の値の登録口へ登録する
  - 先に、Workers統合テストで、コメントの非公開化・復元と評価の無効化・取消が変更の有無と不在のエラーを返し、渡した記録の文が同じ一括の書き込みに入り、非公開化が次の読み取りから置き換え表示になり復元で戻ること、コメント数の供給元がコメントの無いプロダクトを0で補うことを確かめる
  - 2つの管理の操作口は呼び出し側の記録の文(`BatchItem`)を受け取るため、契約と実装をapiのinfrastructure層(`infrastructure/engagement/comment-moderation-control.ts`・`rating-moderation-control.ts`)に作り、文の部品の非公開化と無効化を呼ぶ。コメント数の供給元はapplication層に作る
  - apiの`DIRECTORY_ITEM_METRIC_SOURCES`に`engagement.comment-count`(`key`は`comments`、`order` 10)を登録する
  - 完了状態: テストが成功し、directory-discoveryの登録口の検証を通る
  - _Requirements: 12.1, 12.2, 12.3, 12.4, 14.1_

- [ ] 4. APIサーバーのGraphQL
- [x] 4.1 スキーマモジュールの型とコメントの照会を作り、組み込む
  - 先に、Workers統合テストで、呼び出し元が利用者側でなければ拒否、IDとカーソルの検証、置き換え表示の項目のnull、投稿者を利用者の表示用のローダーで解決し、ローダーがnullを返せばnullのまま返すこと、閲覧できない照会がnullになることを確かめる
  - コメント・スレッド・接続・件数・評価欄の値(`ProductRating`)・操作の結果の型と、スレッドのページ・ローンチごとの件数の照会と、コメントの投稿者のリゾルバを作り、スキーマモジュールの一覧へ加え、スキーマと型を生成する。リゾルバは利用者の状態の判定を`IDENTITY_PLATFORM_TYPES.AccountGuard`(`core/identity/identifiers.ts`)で解決する
  - 完了状態: Workers統合テストとスキーマの合成の検査が成功する
  - _Requirements: 3.1, 3.3, 3.5, 5.2_

- [x] 4.2 コメントの投稿・編集・削除の操作を加える
  - 先に、Workers統合テストで、未ログイン・未確認・停止の拒否(削除は未確認でも受け付ける)、bot対策の検証の失敗の拒否と検証がログインの判定の後に行われること、本文と評価の入力の検証、評価を添えた投稿と編集の返り値に評価欄の値が含まれ、評価の違反でコメントも残らないことを確かめる
  - 完了状態: Workers統合テストとスキーマの合成の検査が成功する
  - _Requirements: 1.2, 1.6, 1.7, 4.5, 4.6, 10.1, 10.3_

- [x] 4.3 評価の照会と操作を加える
  - 先に、Workers統合テストで、評価欄の値の照会(閲覧できなければnull)、評価と取消の利用者の状態の判定(取消は未確認でも受け付ける)、bot対策を課さないこと(仮4)、評価の値の検証、自身のプロダクトの拒否、無効化された自分の評価を返すことを確かめる
  - 完了状態: Workers統合テストとスキーマの合成の検査が成功する
  - _Requirements: 9.5, 9.7, 9.8, 9.9, 11.11_

- [ ] 5. ライフサイクルの処理と日次のジョブ
- [x] 5.1 退会の確定と同じ書き込みでコメントと評価を論理削除する同期の処理を作り、登録する
  - 先に、Workers統合テストで、identity-authの退会の確定でその利用者のコメントと評価に論理削除の印が入り、確定の失敗で取り消されること、他の利用者の行が変わらないこと、返す文が利用者で絞った集合の更新だけであることを確かめる
  - apiの束縛に追記し、ユーザーライフサイクルの同期の登録口へ加える
  - 完了状態: テストが成功し、apiのDIの解決とユーザーライフサイクルの同期の登録口の検証を通る
  - _Requirements: 13.1, 13.7_

- [x] 5.2 4:21の匿名化のジョブを作り、日次のジョブへ登録する
  - 先に、単体テストで、業務日付の切り替わりの前後の閾値の計算、500件ずつ最大10回で500件未満になったら止まること、期限を過ぎた残りがあれば件数だけの`error`のログになること、同じ日の再実行で結果が変わらないこと、ジョブの定義の名前・時刻・`order`を確かめる
  - ジョブのファイルが`COMMENT_ANONYMIZATION_JOB_DEFINITION`(`engagement.comment-anonymization`・4:21・`order` 1400を凍結した値)を輸出し、apiの`SCHEDULED_JOBS`に並べ(product-launch・match-engine・notificationsのジョブの定義と同じ形)、apiの束縛に追記する。4:21の起動の時間の予算(`SCHEDULED_RUN_BUDGETS`の合計300秒)の値は変えない
  - 完了状態: 単体テストとcronの登録の検証が成功する(ローカルでの4:21の起動による匿名化の確かめは9.1のE2Eで行い、本タスクでは起動の補助を作らない)
  - _Requirements: 6.1, 6.4, 6.5, 6.6, 13.8_

- [x] 5.3 (P) eventのDIの識別子と束縛を作り、利用者とプロダクトの物理削除の時期の処理を作り、登録する
  - 先に、単体テストで、残りがあれば`continue`、無ければ`done`を返すことを確かめ、Workers統合テストで、ユーザーの`purge_due`の処理(1400)の後にidentity-authの物理削除が成功し、プロダクトの`purge_due`の処理(1400)の後にproduct-launchの物理削除が成功し、同じイベントで2回動いても結果が同じことを確かめる
  - eventのDIの識別子と束縛のモジュールを作って束縛の一覧へ加え、ユーザーとプロダクトのライフサイクルの非同期の登録口へ追記する
  - 完了状態: テストと、eventのDIの解決と、両方の登録口の検証(名前の形式・同じ種類の`order`の重複)が成功する
  - _Depends: 2.5, 2.6_
  - _Boundary: AccountErasureHandler、ProductErasureHandler、eventの束縛_
  - _Requirements: 6.2, 13.5, 13.6, 13.7, 13.8_

- [ ] 6. 利用者側の画面: 評価欄
- [x] 6.1 評価・コメント・確認メールの再送のGraphQLの操作の文書を作り、許可リストを再生成する
  - 評価欄の値・評価・取消、スレッドのページ・ローンチごとの件数・投稿・編集・削除、確認メールの再送の操作の文書を、clientの`src/graphql/operations/engagement/`に1ファイル1操作の`.graphql`(操作名は`Client`で始める)で書き、`graphql()`を呼ばない。clientで`bun run graphql:generate`を実行して型とpersisted operations(`src/graphql/generated/`)を生成し、apiで`bun run graphql:allowlist`を実行して許可リストを再生成する(返信は平たい一覧として読む)。部品は`src/graphql/generated/graphql.ts`の`<操作名>Document`を読む
  - 確認メールの再送の文書はidentity-authの文書と異なる一意の操作名(例: `ClientEngagementResendVerificationEmail`)にする
  - 完了状態: 生成で操作名の重複エラーが出ず、生成物と許可リストの検査とclientの`codegen.unit.test.ts`(操作名の接頭辞)が成功し、clientの型検査で操作の型を読み込める
  - _Depends: 4.2, 4.3_
  - _Requirements: 1.1, 3.1, 3.6, 9.1, 9.3_

- [x] 6.2 (P) 閲覧者の状態の判定と星の評価の入力を作る
  - 先に、単体テストで、閲覧者の状態の判定(未ログイン・未確認・本人・それ以外の順、未確認の本人)を、ブラウザテスト(`runAxe`の違反0件)で、星の入力が5つの選択肢の1つを選ぶ操作として矢印キーで選べ、各星に「5段階中{n}」の名前があり、無効の理由が支援技術に伝わり、プライマリの色で塗られることを確かめる
  - 星の入力はモックアップの`star-rating-input.tsx`を移植して自作し、frontend-libの`RadioGroup`は使わない
  - 完了状態: テストが成功する
  - _Boundary: EngagementViewer、StarRatingInput_
  - _Requirements: 11.7, 11.8, 11.13_

- [x] 6.3 評価欄と評価の操作の呼び出しを作り、詳細ページのサイドバーへ登録する
  - 評価欄の値の照会の設定(キャッシュのキー)と、評価・取消の呼び出しとキャッシュの置き換えをここで作る(7.3の評価の初期値と7.6の評価欄の値の更新が同じキーを使う)
  - 先に、ブラウザテスト(`runAxe`の違反0件)で、平均値の小数第1位と件数、0件の文言と評価できる閲覧者への一言、ログイン中の入力と評価済みの「取り消す」、本人の文言、未ログインの案内とログインのダイアログ、未確認の無効、評価・変更・取消の成功の通知と値の更新、失敗で表示が戻ること、取得の失敗が欄の中に閉じ込められることを確かめる
  - 評価欄はfrontend-libの`Card`(投稿者本人向けの操作の`owner-card.tsx`と同じ枠)で描き、本人の文言は`OWN_PRODUCT_RATING_MESSAGE`を使う。定期の取り直しを持たないため、区画の文脈の`reportAutoUpdating`で申告しない
  - 詳細ページの区画の登録口のサイドバーに`order` 20で登録する
  - 完了状態: ブラウザテストが成功し、ローカルの詳細ページのサイドバーに評価欄が出る
  - _Depends: 6.1_
  - _Requirements: 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 11.9, 11.10, 11.12_

- [ ] 7. 利用者側の画面: コメント欄
- [x] 7.1 (P) スレッドの木の組み立てとキャッシュの更新、投稿欄の検証を作る
  - 投稿欄の検証のスキーマは、Zodの値を`lib/utilities/validation/zod.ts`の`z`から読んで組み立てる(`zod`からは型だけを読む)
  - 先に、単体テストで、平たい返信の一覧から親ごとの木を組むこと(返信は古い順)、スレッドのページの無限の取得のデータに対する投稿の先頭への追加・返信の親の末尾への追加・編集の置き換え・削除の置き換え表示への変更が元のデータを変えないこと、投稿欄の検証が共有の本文の規則と同じ文言を返すことを確かめる
  - 完了状態: 単体テストが成功する
  - _Depends: 6.1_
  - _Boundary: CommentTree、CommentFormSchema_
  - _Requirements: 1.3, 8.15_

- [x] 7.2 投稿日時の表示・読み込み中の表示・未ログインと未確認の案内を作る
  - 先に、ブラウザテスト(`runAxe`の違反0件)で、経過の表現と30日以上前の日付、ホバーとフォーカスで完全な日時が出ること、未ログインの案内のログインへの導線(現在のページへ戻る)、未確認の案内と確認メールの再送の成功・429の通知、スケルトンの名前を確かめる
  - 完了状態: ブラウザテストが成功する
  - _Requirements: 8.4, 8.5, 8.7_

- [x] 7.3 コメントの投稿欄を作る
  - フォームは`useAppForm<TInput, TOutput>(schema, { defaultValues })`(使うスキーマの全欄の既定値)と`AppForm`(`serverFieldPrefix="input"`・`onSubmitError`)で作る。評価の行を描く投稿欄(投稿者本人以外のトップレベルの投稿欄と編集欄)は本文と評価の`commentWithRatingFormSchema`、返信の投稿欄と編集欄と投稿者本人の投稿欄と編集欄は本文だけの`commentFormSchema`で作り、投稿先と編集するコメントのIDはスキーマの入力に含めず`onSubmit`で足す。欄に対応しない失敗の文言は`errorMessageOf(error, CLIENT_PROFILE.contactAvailable)`で選ぶ。bot対策のウィジェットは`TurnstileWidget`(非表示)で置き、判定の枠と場所を設けない
  - 先に、ブラウザテスト(`runAxe`の違反0件)で、書式のツールバー・書く/プレビュー・「1,234 / 2,000」のカウンター、上限超過と空でフォーカスアウト時に文言が出て送れないこと、評価の行の有無(投稿者本人以外のトップレベルの投稿と編集だけ)と現在の評価の初期値、評価の行を描かない投稿欄が`rating`を送らず、返信の評価の`validation_error`(詳細`rating`)をフォーム全体の失敗として示し送信ボタンが無効のまま残らないこと、bot対策のトークンが用意できるまで送れないこと、送信の結果を呼び出し元へ渡し、失敗で入力が保たれ項目の文言が出ること、成功で入力が空になることを確かめる
  - 完了状態: ブラウザテストが成功する
  - _Depends: 6.3, 7.1_
  - _Requirements: 1.3, 8.3, 8.16, 10.5_

- [x] 7.4 他者のコメントの操作の登録口・操作のメニュー・削除の確認のダイアログを作る
  - 先に、ブラウザテスト(`runAxe`の違反0件)で、自身のコメントに「編集」「削除」、他者のコメントに登録された操作が`order`順に出て、登録が無ければメニューが出ないこと、キーボードで開閉と選択ができること、削除の確認のダイアログの見出し・説明・「キャンセル」・「削除」と、確定するまで削除せず、削除のbot対策のトークンが用意できるまで「削除」を押せないことを確かめる
  - 登録口は初版を空にする(通報はcontent-reportingが追記する)
  - 完了状態: ブラウザテストが成功し、登録口の型を他のspecが読み込める
  - _Requirements: 8.10, 8.11, 8.18, 14.2_

- [x] 7.5 コメントの操作の呼び出しとキャッシュの更新を作る
  - スレッドのページ(無限の取得)とローンチごとの件数の照会の設定(キャッシュのキー)をここで作る(7.7の一覧と7.8の件数が同じキーを使う)
  - 先に、ブラウザテスト(模擬の通信)で、投稿・返信・編集・削除の成功でスレッドのページと件数のキャッシュが更新され8.15の文言が通知されること、評価を添えた投稿で評価欄の値のキャッシュも更新されること、失敗でキャッシュが変わらず理由の文言が出ることを確かめる
  - 完了状態: ブラウザテストが成功する
  - _Depends: 6.3, 7.1_
  - _Requirements: 8.15, 8.16, 10.1_

- [x] 7.6 コメントの項目を作る
  - 返信・編集・削除は呼び出し元から受け取る操作として受け、項目の中の返信と編集の投稿欄・メニュー・削除のダイアログからそれを呼ぶ
  - 先に、ブラウザテスト(`runAxe`の違反0件、操作は模擬)で、プロフィール画像・ニックネームのリンク・「投稿者」と「あなた」のバッジ・「(編集済み)」、本文のマークダウンの描画と別オリジンのリンクの`rel="noopener ugc"`と別タブ、見出しのアンカーが他のコメントと衝突しないこと、置き換え表示(作者が取れない表示中のコメントを含む)で本文と作者と日時を出さず返信を残すこと、第3階層に「返信」が無いこと、未ログインの「返信」でログインのダイアログ、未確認で「返信」が無効になり理由が出ること、返信がインデントの一覧になることを確かめる
  - 完了状態: ブラウザテストが成功する
  - _Depends: 7.2, 7.3, 7.4_
  - _Requirements: 5.1, 5.2, 5.3, 7.1, 7.2, 7.3, 8.5, 8.6, 8.8, 8.9, 8.18_

- [x] 7.7 スレッドの一覧を作り、投稿・返信・編集・削除をコメントの操作の呼び出しへつなぐ
  - トップレベルの投稿欄と、項目の返信・編集の投稿欄・削除のダイアログを、7.5のコメントの操作の呼び出しへつなぐ
  - 先に、ブラウザテスト(`runAxe`の違反0件、模擬の通信)で、閲覧者の状態ごとの投稿欄と案内、投稿・返信・編集・削除が一覧に反映されること、続きがあるときだけの「さらに読み込む」と次の10件、続きの失敗で取得済みを保った再試行、最初の失敗が欄の中に閉じ込められること、0件の文言と閲覧者の状態ごとの一言を確かめる
  - 完了状態: ブラウザテストが成功する
  - _Depends: 7.5, 7.6_
  - _Requirements: 8.12, 8.13, 8.14, 8.15, 8.17_

- [x] 7.8 ローンチのコメント欄を作り、詳細ページのローンチのブロックへ登録する
  - 先に、ブラウザテスト(`runAxe`の違反0件)で、キックオフ前の文言、件数を添えた開閉のボタンと開閉状態の伝達、最も新しいキックオフ済みのローンチだけが既定で開くこと、件数の取得が同じプロダクトのブロックで1回に共有されること、件数の取得の失敗でもボタンが出ること、演出のアニメーションが無いことを確かめる
  - キックオフ前の文言は`LAUNCH_NOT_COMMENTABLE_MESSAGE`を使う
  - 詳細ページのローンチのブロックの区画の登録口に`order` 10で登録する
  - 完了状態: ブラウザテストが成功し、ローカルの詳細ページのローンチのブロックにコメント欄が出る
  - _Requirements: 8.1, 8.2, 8.18_

- [x] 7.9 (P) ディレクトリの項目のコメント数の部品を作り、clientの項目の値の登録口へ登録する
  - 先に、ブラウザテスト(`runAxe`の違反0件)で、数が詳細ページのマッチ履歴とコメントの見出しへのリンクになり、「コメント{n}件」が支援技術に伝わることを確かめる
  - clientの`DIRECTORY_ITEM_METRICS`に`comments`(`order` 10)で登録する
  - 完了状態: ブラウザテストが成功し、ローカルのディレクトリの項目にコメント数が出る
  - _Depends: 3.7_
  - _Boundary: CommentCountMetric、clientの`DIRECTORY_ITEM_METRICS`への登録_
  - _Requirements: 14.1_

- [ ] 8. 文書
- [x] 8.1 (P) 技術ドキュメントを書き、CLAUDE.mdから参照する
  - `backend/015-tombstoned-comment-threads.md`・`frontend/015-star-rating-and-threaded-composer.md`を設計のEngagementTechDocsの内容で、本プロジェクト固有の値を含めずに書き、`backend`・`frontend`のREADMEの文書一覧に行を加える
  - CLAUDE.mdの「技術規則の参照先」に「削除しても返信を残すコメントや保持期間後の匿名化を設計する前に: `backend/015`」を、作った見出しへのリンクで加える
  - 完了状態: 文書とREADMEが整形の検査を通り、本プロジェクト名とサービス固有の仕様を含まず、CLAUDE.mdのリンクの見出しが実在する
  - _Boundary: `docs/GUIDES/tech/backend/015-tombstoned-comment-threads.md`・`frontend/015-star-rating-and-threaded-composer.md`・`backend/README.md`・`frontend/README.md`・`CLAUDE.md`_
  - _Requirements: 15.4_

- [x] 8.2 (P) オンボーディングに本specの固有の値を記録する
  - `docs/onboardings/project-values.md`に、処理とジョブの名前と`order`、bot対策の操作名、区画と項目の値の登録の`order`、上限の値を加える
  - 完了状態: 文書が整形の検査を通り、3・5・6・7のタスクの登録の値と一致する
  - _Depends: 5.3, 7.9_
  - _Boundary: `docs/onboardings/project-values.md`_
  - _Requirements: 13.8, 15.5_

- [ ] 9. 検証
- [ ] 9.1 E2Eテストでコメントと評価の流れを確かめる
  - コメント欄の開閉・投稿・返信・編集・削除と評価欄の操作は、画面の操作の手順`e2e/client/engagement-steps.ts`に置き、テストの本体`e2e/client/engagement.e2e.test.ts`から呼ぶ。マークダウンの入力欄はproduct-launchの`e2e/client/markdown-steps.ts`の`markdownEditable`で取り、書式のツールの有効化を待って本文を打つ手順は`engagement-steps.ts`に置く(上流の手順のファイルは変えない)。詳細ページの経路はdirectory-discoveryの`e2e/client/directory-steps.ts`の`productPagePath`を使う
  - `e2e/client/engagement.e2e.test.ts`: directory-discoveryの`e2e/support/directory-fixtures.ts`で掲載中のプロダクトと確定した予選のローンチを作り、identity-authの`e2e/support/mailpit.ts`で確認済みの利用者2人を登録する(メールアドレスのドメインは`.example`)
  - 利用者がコメントに評価を添えて投稿し、もう1人が第3階層まで返信して第3階層に「返信」が無いこと、編集で「(編集済み)」、削除で置き換え表示と返信の維持、評価欄の変更と取消で平均値と件数が変わること、投稿者本人に「自身のプロダクトは評価できません。」が出ること、ログアウトした閲覧者にログインへの導線が出ること、ディレクトリの項目にコメント数が出ることを確かめる。Ultrasの機能フラグで結果が変わる表示は確かめない
  - 4:21の匿名化: 画面からコメントを2件投稿して削除し、当日の業務日付Dを`BusinessTime`で求め、Dの13日前と12日前の0:00(業務時間)を`fromBusinessDateTime`で日時にしてエポックミリ秒の整数とし、admin-foundationの`executeLocalD1`(値は`sqlStringLiteral`)で2件の削除の日時をその値に書き換え、backend-platformの改訂2の`triggerScheduled({ worker: 'api', businessDate: <当日の業務日付>, businessTime: '04:21' })`(`e2e/support/scheduled-trigger.ts`)で4:21のジョブを動かし、`executeLocalD1`の読み取りで13日前の行だけ本文と投稿者の紐付けが消え、12日前の行が変わらないことを確かめる。独自の起動の補助を作らない(4:21の他のジョブも動くが、ローカルのD1だけに影響する)
  - 前提: backend-platformの改訂2の`triggerScheduled`が完了していること。無ければ4:21の匿名化のテストケースだけを理由を添えて飛ばし、9.1を未完了のまま9.2の報告に記録して開発者へ報告する
  - 完了状態: ローカルでE2Eテストが成功する(4:21の匿名化のテストケースを含む)
  - _Depends: 5.2, 6.3, 7.8, 7.9_
  - _Requirements: 6.1, 15.3_

- [ ] 9.2 全体の検査とカバレッジを確かめ、決定と運用の事項を報告する
  - 整形の検査・静的解析・型検査・写しの照合(`check:contract-copies`)と、単体テスト・Workers統合テスト・ブラウザテストを一括で実行し、本specが追加・変更したファイルのカバレッジが80%以上であることを確かめる。静的解析で、api・eventのapplication層に`**/lib/workers/**`の読み込みが無く、`core/engagement`が`workers`・`apps/db`を読み込まないことを確かめる。ログとSentryへの送信にコメントの本文・利用者のニックネームとハンドルが含まれないことを検索で確かめる
  - roadmapの帯の割り当ての表の本specの「使用中の値」(4:21は1400、波及処理は1400)と、ugc-moderationが本specの管理画面の一覧の照会(`AdminCommentDirectory`・`AdminRatingDirectory`、仮6)を使う旨を作業の報告に記録する(仮1〜仮6は2026-10-24に開発者が確定済み)
  - 完了状態: すべての検査とテストが成功し、カバレッジの結果が閾値を満たし、報告に帯の値と照会の利用者が載っている
  - _Requirements: 14.5, 14.6, 15.1, 15.2_

## Implementation Notes

- 1.1: 規則は`apps/common-lib/engagement/engagement-rules.ts`。本文は`markdownTextSchema(COMMENT_BODY_RULE)`(名前「コメント」)、評価の文言「評価は1〜5で選んでください。」は非公開の定数で`ratingScoreSchema`の文言として読む(clientのフォームで要るなら`ratingScoreSchema`を使う)。`commentIdScope(id)`は`c`+小文字のIDで入力のULIDを検証しない(7.xの呼び出し側は26文字のULIDを渡す。不正なら`idPrefixFor`が例外を投げる)。
- 1.2: テーブルは`apps/db/schema/engagement/`の`launchComments`・`productRatings`、条件の部品は`displayableComment()`(`users`を`author_user_id`で外部結合する前提)・`validRating()`(`users`を`user_id`で内部結合する前提)。マイグレーションは`20261115074652_engagement`。トップレベルの`root_id`は自身のIDで、返信のまとめ読みの索引`(root_id, created_at, id)`にトップレベル自身も入るため、2.3の返信の照会は`depth > 1`で除く。`depth = 1`と`parent_id`のNULLの整合はDBの制約に無く、2.1の書き込みの文で保つ。階層のCHECKは`between 1 and 3`(整数でない値は書き込みの文が作らない)。
- 1.3(差し戻し1回): 設計に文言が無くモックアップから決めた文言(0件の一言4つ・ログインの案内のダイアログの題名と説明・「このプロダクトの評価(任意)」・「コメントを読み込み中」「評価を読み込み中」)を文言規則に置いた。6・7は`003-text-and-copy-rules.md`の「コメントと評価の画面の文言」節の文字列をそのまま使う。評価を添えた編集のトーストは「コメントを更新しました。」、未確認でも評価済みなら「取り消す」を使える(6.3で確かめる)、30日以上前の投稿日時は`dateWeekday`で年を付けない(ローンチ・マッチの日付の「今年なら年を省く」と違う。最終報告で開発者へ挙げる)。IDの形式違反(`validation_error`)の文言は未定(3.x・4.xで既存の前例に従う)。
- 2.1: 契約と型は`apps/backend-lib/core/engagement/ports.ts`、識別子は`identifiers.ts`(10種、`Symbol.for('engagement.<名前>')`)。`CommentStatements`(`workers/engagement/comment-statements.ts`)の型は`insertStatement`だけで、2.2が編集・削除・非公開化を足す。`RatingStatements`の型は2.4で作る。投稿の文は条件が成り立たないと`product_id`にNULLを入れて一括ごと失敗させる(違反の判定は`NOT NULL constraint failed: launch_comments.product_id`)。設計のCASEに加え「ローンチがそのプロダクトのものであること」「渡した親のルートと階層が親の行と一致し親が第3階層でないこと」を条件に足した。`requireListed`は呼び出し側(3.2・3.3)が`ownerUserId`との比較から導く。ローンチのキックオフ前・取消は書き込みの条件に無く3.2・3.3で判定する。テストの補助は`workers/engagement/testing/engagement-fixtures.ts`(`commentIdOf`・`insertComment`・`readComment`・`countComments`・`clearEngagementTables`)。Workers統合テストはapiの`vitest.worker.config.ts`から`lib/workers/engagement`で実行する。
- 2.2: 編集の文は条件の違反で`product_id`をNULLにする(design.mdのCommentStatementsの箇条は`body`をCASEにするとしており、実装と食い違う)。投稿と同じ`NOT NULL constraint failed: launch_comments.product_id`で一括ごと失敗するため、3.3・3.4の`D1CommentWriter`は1つの判定で`rejected`にできる(判定の正規表現は`comment-statements.ts`の外へ出していない。3.3でエクスポートして再利用し、写しを作らない)。存在しないコメントの編集は失敗せず変更0行になり同じ一括の評価の文は確定するため、3.4は先に`findByIds`で確かめるか`meta.changes`を見る。削除の文はプロダクトの閲覧の可否と停止を条件に持たない(3.4が判定する)。`setHidden`は先に読み、`not-found`・`unchanged`では渡した文を流さない(ugc-moderationの設計に合う)。読みの後の物理削除は捕まえられない(既知の限界)。D1の結果の`meta.changes`は`engagement-fixtures.ts`の`changesOf`と同じ形で絞る(lintの`no-unsafe-*`)。
- 2.3(差し戻し1回、テストの不足): スレッドの照会は`workers/engagement/d1-comment-thread-query.ts`の`D1CommentThreadQuery`。`page`は1回の`db.batch`に2文(トップレベル11件と、ページのルート10件を別名`page_roots`の副問い合わせで選び直した返信`depth > 1`)。置き換え表示は`CASE`で投稿者・本文・日時・編集の印をDBから返さない。`countsByLaunch`・`countsByProduct`は件数0のキーを返さない(0の補いは3.5の呼び出し側・clientと3.7の`CommentCountMetricSource`)。カーソルの符号化は3.5、`after.createdAt`はミリ秒。閲覧の可否・ローンチの所属・取消のローンチの除外はこの層でせず3.5が判定する。テストの補助`recordingDatabase()`(文ごとの読んだ行数の記録)はこのテストのファイル内にある。
- 2.4: 違反の判定は共有の`workers/engagement/engagement-guard.ts`の`guardedProductId()`・`isEngagementGuardViolation()`(`launch_comments.product_id`と`product_ratings.product_id`のNOT NULLの違反を`cause`を辿って判定。2.2の注記の「3.3で`comment-statements.ts`から輸出する」に代わる)。3.3・3.6の書き込みの単位はこれ1つで投稿・編集・評価の違反を`rejected`にする(設計のファイル構成に無いファイル)。上書きは`ON CONFLICT(product_id, user_id) DO UPDATE SET score, updated_at`で無効化の印とIDと作成日時を保つ。`setInvalidated`は`setHidden`と同じ形で、論理削除(退会)の評価は`not-found`。読んだ後に利用者が取消で物理削除すると、更新0行のまま渡した記録の文が確定して`changed`を返す(既知の限界。評価の取消は通常の操作なのでコメントより起こり得る)。`summaries`は要求した全てのIDに項目を返し、有効な評価が無ければ`{ average: null, count: 0 }`(2.3の`countsByProduct`の0のキーを返さない形と違う)。平均は丸めない(画面で小数第1位)。`remove`は`deleted_at`を見ずにキーで消す。`RatingModerationControl`(3.7)は`not-found`を`AppError(not_found, 'rating_not_found')`にする。
- 2.5: `D1EngagementErasureStore`(`workers/engagement/d1-engagement-erasure-store.ts`)は閾値をそのまま比べる(`deleted_at < threshold`)。5.2のジョブは`anonymizeDeletedBefore`に`fromBusinessDateTime(業務日付−12日, 0:00)`と`limit` 500、`countOverdue`に`fromBusinessDateTime(業務日付−13日, 0:00)`を渡す(identity-authの`scheduledTime − 14日`と方式が違うが設計どおり)。`eraseAccount`・`eraseProduct`の`remaining`は同じ一括の中で書き込みの後に`LIMIT 1`で読み直した残りの有無(件数が上限に達したかでは決めない。`backend/007`の「上限ちょうどで`continue`」の規則は件数方式向け)で、5.3は`remaining`をそのまま`continue`/`done`にする。上限はコメントと評価のそれぞれに500件。プロダクト単位は`depth DESC`で消す。上流の物理削除はテストの中で`users`・`product_launches`→`products`の削除を再現しただけで、本物の`D1IdentityPurgeStore`・`D1ProductPurgeStore`(`apps/event/src`)の後に成功することは5.3で確かめる。テストの補助に`insertComments`・`insertRatings`(一括の挿入)を足した。
- 2.6: 出力の部品は`workers/engagement/d1-engagement-export.ts`(`D1CommentExport`・`D1RatingExport`)。評価の出力の順は設計に定めが無く、作成の古い順・同時刻はIDとした。共有の束縛は`workers/engagement/engagement-platform-module.ts`の`ENGAGEMENT_PLATFORM_MODULE`(型は前例どおり`Omit<AppModule, 'routes'>`。設計は`AppModule`)で、処理単位(呼び出しごとのコンテナの`inSingletonScope()`)に8つを束縛し、apiの`MODULES`は`API_NOTIFICATIONS_PLATFORM_MODULE`、eventは`EVENT_NOTIFICATIONS_MODULE`の直後に置いた。DIの解決の検査は`apps/api/src/composition/engagement-platform.worker.test.ts`(fetch)・`apps/event/src/composition/engagement-platform.worker.test.ts`(fetch・queue)と、モジュール自身のテスト(scheduledを含む)。2.7は2つの照会を足すとき、3つのテストのファイルの`IMPLEMENTATIONS`と`toHaveLength(8)`・テスト名の「8つ」を10へ直す。テストの補助`testing/engagement-platform-fixtures.ts`(`seedEngagementPlatformSample`)は設計のファイル構成に無い(product の前例に倣った)。
- 2.7: 管理画面の照会は`workers/engagement/d1-admin-comment-directory.ts`・`d1-admin-rating-directory.ts`、カーソルと件数の共通の処理は設計のファイル構成に無い`admin-directory-page.ts`。カーソルは前例(product・identityの管理画面の照会)の「ミリ秒:ID」のbase64urlで、design.mdの「api-gatewayと同じbase64urlのJSON」と食い違う(ugc-moderationは中身を読まない)。件数は1〜100の整数以外を`validation_error`で拒む。抜粋は書記素で200(匿名化は空)。コメントの状態は設計どおり非公開化>削除>匿名化>投稿者が利用できない>表示中の1つのCASEで、削除の後に匿名化したコメントは`deleted`になり、`anonymized`は利用者単位の物理削除の処理(`eraseAccount`)による削除されていない匿名化だけになる(最終報告で開発者へ挙げる)。評価の状態は無効化の印だけ(停止中の評価者は`valid`)。束縛は10個になった。
- 3.1: 純粋な規則は`apps/api/src/domain/engagement/`の`engagement-access.ts`(`canViewProduct`・`isCommentableLaunch`。キックオフ済みは`in_progress`・`finished`)と`comment-threads.ts`(`toCommentViews`、要素の型`CommentThreadView`は設計で無名だったものに名前を付けた)。`removed`の`CommentView`は設計の型どおりバッジ・作者・投稿者の項目自体を持たず、4.1はGraphQLの`REMOVED`で`byProductOwner`・`viewerIsAuthor`を`false`に固定する(設計の箇条の「常に偽」はここで満たす)。`CommentRow.commentId`は`id`へ写す。
- 3.2: apiの識別子は`apps/api/src/application/engagement/engagement-types.ts`の`ENGAGEMENT_TYPES`(11個)、束縛は`apps/api/src/composition/engagement-module.ts`の`ENGAGEMENT_MODULE`(`MODULES`の末尾)。投稿先の解決は`DirectoryEngagementTargetResolver`で、`EngagementTarget`(`product`・`launch`・`viewerIsOwner`)を返す。3.3以降は`requireListed`を`!target.viewerIsOwner`から導く(本人なら未掲載でも書ける)。模擬の`ProductDirectory`は設計のファイル構成に無い`application/engagement/testing/target-fakes.ts`(`createFakeTargetDirectory`・`summaryOf`・`launchOf`。`'visible'`の照会で可視でないプロダクトを返さない)で、3.3〜3.6が再利用する。apiのWorkers統合テストの全体(`bun run test:worker`)は600秒を超えるため、各タスクは対象のファイルに絞って流し、全体は最終検証で親が背景で流す。
- 3.3: `StoreCommentService.post`(`application/engagement/comment-service.ts`)と`D1CommentWriter`(`infrastructure/engagement/d1-comment-writer.ts`)。取り消されたローンチへの投稿は`comment_target_not_found`(投稿先の解決が取消を返さないため)で、design.mdのError Categoriesの表と文言規則(`003-text-and-copy-rules.md`)の「キックオフ前・取消は`launch_not_commentable`」と食い違う(最終報告で開発者へ挙げる)。`rejected`の読み直しで変化が無ければトップレベルは`account_unavailable`、返信は`comment_parent_unavailable`(`StoreAccountGuard`は同じ要求の中で利用者を読み直さない。match-engineの`UpvoteService`と同じ形)。エラーは設計のファイル構成に無い`engagement-errors.ts`(3.4が`comment_not_found`、3.6が`rating_target_not_found`を足す)。評価欄の値は`product-rating-view.ts`の`readProductRatingView`(3.6が再利用)で、評価を添えない投稿は`rating: undefined`。返信への評価の`validation_error`の`field`は`'rating'`で、4.2がリゾルバの検証の`field`(`input.rating`)と揃えるかを決める。模擬のポートは`testing/comment-fakes.ts`。
- 3.4: `CommentWriter.update`の戻り値は設計の`WriteOutcome`から`WriteOutcome | 'not-found'`(`CommentUpdateOutcome`)に広げ、編集の文の`meta.changes`が0なら`not-found`。`CommentService.remove`の戻り値は`RemovedCommentView`(設計の`CommentView`の`removed`の部分型)。ユースケースは`findByIds`で自分の表示できるコメントを確かめてから書き込みの単位を呼ぶため、存在しないコメントに評価の文だけが確定することは無い(判定の後の物理削除はプロダクトの削除だけで、評価の文の条件の違反で一括ごと取り消される)。本文の規則と未確認の編集の拒否(4.6)はリゾルバ(4.2)の担当で、4.2のテストに編集の本文の検証と未確認の拒否を含める。`changesOf`は前例どおり`d1-comment-writer.ts`に写しを持つ。模擬の`createFakeCommentWriter`は`{ onPost, onUpdate, onRemove }`を受ける。
- 3.5: `StoreCommentReader`(`application/engagement/comment-reader.ts`)。カーソルは設計のファイル構成に無い`comment-thread-cursor.ts`(`{ createdAt(ミリ秒), commentId }`の詰め物なしのbase64urlのJSONで`encodeCursor`と同じ形。application層は`presentation/graphql/pagination.ts`を読めないため前例`my-products-cursor.ts`に倣った)で、4.1は`endCursor`を符号化済みで受け取りpresentationで符号化し直さない。2.3の`CommentThreadQuery.page`は置き換え表示の行の日時を返さないため、ページの最後が置き換え表示なら`CommentStore.findByIds`で`createdAt`を読む(1ページ最大1回の追加の読み取り、記録が無ければnull)。そのカーソルは削除済みのコメントの作成日時に復号できるが、ULIDのIDが同じ時刻を持つため新しい情報は無いと判断した(最終報告で開発者へ挙げる)。`counts`は取消を除く全ローンチ(キックオフ前を含む)を`listLaunches`の順で0で補う。取消のローンチのページはnull(3.3と同じ扱い)、キックオフ前は空のページ。戻り値は`{ threads, endCursor, hasNextPage }`。
- 3.6: `StoreRatingService`(`application/engagement/rating-service.ts`)と`D1RatingWriter`(`infrastructure/engagement/d1-rating-writer.ts`)。投稿者本人の取消は拒否せず(設計と要件9.4は評価だけを拒否する。本人には評価の行が無いため何も消さずに自分の評価nullの値を返す)。`rejected`の読み直しで閲覧できれば`account_unavailable`。ユースケースはメールアドレスの確認を判定せず、書き込みの条件`verifiedUsers()`が未確認を`rejected`にするため、4.3のリゾルバは評価の前に`email_not_verified`の判定を必ず行い取消では行わない(9.8)ことをテストで確かめる。状態を持つ模擬は設計のファイル構成に無い`testing/rating-fakes.ts`(`createFakeRatingWorld`・`fakeRatingRowOf`)。
- 3.7: 管理の操作口は`apps/api/src/infrastructure/engagement/comment-moderation-control.ts`(`D1CommentModerationControl`・`ModerationChangeResult`)・`rating-moderation-control.ts`(`D1RatingModerationControl`)。ugc-moderationのdesign.md 59行は`ModerationChangeResult`を`ENGAGEMENT_TYPES`のものと書くが、実体はこのinfrastructureのファイルにある(ugc-moderationの`ControlEngagementModerationWriter`はinfrastructure層なので読み込める)。`comment_not_found`は本specの設計どおり「コメントが見つかりません。削除された可能性があります。」で、ugc-moderationのdesign.md 1531行の「コメントが見つかりません。」と食い違う(最終報告で挙げる)。`rating_not_found`の文言はugc-moderationの「評価が見つかりません。」を採り、文言規則への追記は8.xで行う。コメント数の供給元`ThreadQueryCommentCountMetricSource`は渡した全プロダクトに値を返し0で補う(`DirectoryItemMetricSource`の型の注記と`backend/013`の「該当するものだけを返す」と字面が食い違うが両立する)。apiの`DIRECTORY_ITEM_METRIC_SOURCES`に`engagement.comment-count`(`key` `comments`・`order` 10)を登録した。
- 4.1: スキーマモジュールは`apps/api/src/presentation/graphql/modules/engagement/`(`type-defs.ts`・`inputs.ts`・`resolver-support.ts`・`engagement-views.ts`・`comment-resolvers.ts`・`index.ts`)、テストの補助は`apps/api/test/support/engagement-graphql-operations.ts`(4.2・4.3が操作を足す)。IDの検証は設計の`z.ulid`ではなく前例(directory・follow)の`/^[0-9A-Z]{26}$/u`(テスト用データのIDがO・Lを含み`z.ulid`を通らないため。matchは`z.ulid`で前例が揃っていない)。IDの形式違反の文言は`comment_target_not_found`の文言(matchの前例)で、4.2の`commentId`は同じ形で`comment_not_found`の文言にする。カーソルは256文字の上限(超えれば`invalid_cursor`の文言の`validation_error`)。`REMOVED`は投稿者・本文・日時をnull、`edited`・`byProductOwner`・`viewerIsAuthor`を偽。codegenのmappersで`LaunchComment`を`LaunchCommentModel`(`CommentView`)に結んだ。投稿と編集の入力の型は4.2、`productRating`の照会と`rating-resolvers.ts`は4.3。テストのデータで1つのプロダクトに未決着のローンチは1つしか置けない(`product_launches_product_id_open_unique`)。
- 4.2: 操作のリゾルバの順は呼び出し元→入力の検証→利用者の状態(投稿・編集は`requireVerifiedUser`、削除は`requireWritableUser`)→`context.assertHuman(COMMENT_BOT_ACTIONS.*)`→ユースケース(`backend/004`と`upvote`の前例)。返信への評価の`validation_error`は`withInputPath('input', …)`で`input.rating`になる(clientは`serverFieldPrefix="input"`で`rating`)。形式違反の`parentId`は`comment_parent_unavailable`、`commentId`は`comment_not_found`の文言。評価を添えない結果の`rating`はnull。テストは設計のファイル構成に無い`comment-mutations.worker.test.ts`。許可リストの再生成は6.1。
- 4.3: 評価のリゾルバは`rating-resolvers.ts`(照会`productRating`は`currentUser`、`rateProduct`は`requireVerifiedUser`、`cancelProductRating`は`requireWritableUser`。どれも`assertHuman`を呼ばない、仮4)。評価の値の違反は`field` `score`(トップレベルの引数のため。clientの評価欄は`AppForm`を使わずエラーの`code`で文言を選ぶ)。引数の検証は利用者の判定より先に走るため、未ログインの不正な値は`validation_error`になる。テストは設計のファイル構成に無い`rating-resolvers.worker.test.ts`。clientの操作は`productId`・`score`の引数に合わせる。
- 5.1: 退会の同期の処理は`apps/api/src/infrastructure/engagement/engagement-withdrawal-sync-handler.ts`(DBの型を扱うため前例どおりinfrastructure)、`USER_LIFECYCLE_SYNC_HANDLERS`の末尾に`engagement.withdrawal`(`withdrawn`だけ、同期の登録口は`order`を持たない)。`deleted_at IS NULL`の行だけに`deleted_at`・`updated_at`を退会の日時で入れ、本人が先に削除した日時は上書きしない(匿名化の期限を保つ)。`docs/onboardings/project-values.md`の「同期の波及処理の登録」の行(7件)は8.2で`engagement.withdrawal`を加えて8件にする。テストの補助は設計のファイル構成に無い`infrastructure/engagement/testing/withdrawal-fixtures.ts`。
- 5.2(差し戻し1回): 4:21の匿名化のジョブは`apps/api/src/application/engagement/comment-anonymization-job.ts`(`COMMENT_ANONYMIZATION_JOB_DEFINITION`、`SCHEDULED_JOBS`の`NOTIFICATION_MAINTENANCE_JOB_DEFINITION`の直後)。期限を過ぎた残りは、設計のファイル構成に無い`EngagementIncidentReporter`(`ports.ts`、種類`comment-anonymization-overdue`と件数)と`infrastructure/engagement/sentry-engagement-incident-reporter.ts`で`logger.error`と`captureEvent`へ送る(前例のincident reporterと同じ形、`try/finally`で匿名化の失敗でも報告)。design.mdの「`error`のログ(Sentryへ送られる)」はログの出力先がコンソールだけであることと食い違う(最終報告で挙げる)。`infra/004`の送信対象の表は汎用の行が覆うため追記していない。`ENGAGEMENT_TYPES`は12個になった。4:21の並びの検査(`notifications-scheduled-jobs.unit.test.ts`・`search-module*.worker.test.ts`)の期待値を更新した。`docs/onboardings/project-values.md`のジョブの表への追記は8.2。
- 5.3: eventの識別子は`apps/event/src/application/engagement/event-engagement-types.ts`の`EVENT_ENGAGEMENT_TYPES`(`engagement.event.<名前>`)、束縛は`apps/event/src/composition/engagement-module.ts`の`EVENT_ENGAGEMENT_MODULE`(`MODULES`の`ENGAGEMENT_PLATFORM_MODULE`の直後)。`engagement.account-erasure`(ユーザー、`purge_due`、1400、`notifications.account-purge`の後)と`engagement.product-erasure`(プロダクト、`purge_due`、1400、`directory-discovery.entry-erasure`の後)は`remaining`をそのまま`continue`/`done`にする。`eraseAccount`の`at`は`Clock.now()`。処理はログを出さず実行器のログに任せる(design.mdのeventの節とMonitoringの「IDと件数を記録する」と食い違う。`EngagementErasureStore`は件数を返さない。最終報告で挙げる)。`purge_due`の並びを確かめる既存のテスト8つに`engagement.*`を加えた。`docs/onboardings/project-values.md`の非同期の波及処理とプロダクトライフサイクルの行は8.2で追記する。
- 6.1: 操作の文書は`apps/client/src/graphql/operations/engagement/`の9本(`ClientLaunchComments`・`ClientLaunchCommentCounts`・`ClientProductRating`・`ClientPostComment`・`ClientUpdateComment`・`ClientDeleteComment`・`ClientRateProduct`・`ClientCancelProductRating`・`ClientEngagementResendVerificationEmail`)。設計のファイル構成に無い断片`apps/client/src/graphql/fragments/engagement/`の`LaunchComment`・`ProductRating`を`coding/004`とmatch・notificationsの前例に従って置いた。部品は生成型`LaunchCommentFragment`・`ProductRatingFragment`(`fragmentMasking: false`)を受け、返信は`nodes[].replies`の平たい一覧を`parentId`・`depth`で木にする。
- 6.2: 閲覧者の状態の判定は`apps/client/src/components/engagement/engagement-viewer.ts`(`engagementViewerKind`)、フックは設計に無い`use-engagement-viewer.ts`(カバレッジの閾値のため分けた。6.3・7.xはここから読む)。閲覧者は設計の「`__root`のルートの文脈」ではなく前例どおり`useViewer()`から読む。未確認の本人は`unverified`になるため、評価欄(6.3)は`kind`より先に`isOwner`を見て本人の文言を優先する(11.6)。星の入力`star-rating-input.tsx`は値が変わったときだけ`onChange`を呼ぶ。名前は呼び出す側が渡し(評価欄は「あなたの評価」、投稿欄は「このプロダクトの評価(任意)」)、未確認の理由は呼び出す側が描いて`describedBy`でIDを渡す。無効の手段は`disabled`だけなので、送信中に`disabled`を渡すとフォーカスが落ちる(6.3は送信中に`disabled`にせず受ける側で無視する)。矢印キーは1回ごとに選択を確定するため、評価欄で2→5へ矢印で移ると3回呼ばれる(6.3で書き込みとトーストの扱いを決める)。矢印キーの向き(上・右で次)・両端で止まる・`Home`・`End`が無いのはモックアップどおりで、WAI-ARIAのradiogroupとRadixの既定と違い、`frontend/004`の「矢印キーの移動はRadixに任せる」と食い違う(改2による例外。8.1の`frontend/015`に記し、最終報告で挙げる)。
- 6.3: 評価欄の値のキャッシュは`apps/client/src/graphql/engagement.ts`(設計のファイル構成に無い。前例の`graphql/<ドメイン>.ts`)の`productRatingQueryOptions(viewerId, productId)`(キーの末尾に閲覧者のID、未ログインは`guest`)と`replaceProductRating(queryClient, viewerId, rating)`で、7.3の評価の初期値と7.5・7.6の評価欄の値の更新はこれを使う。評価欄は`rating-section.tsx`(`Card`、見出し「5段階評価」、`kind`より先に`isOwner`を見る、`reportAutoUpdating`を呼ばない)、操作は`use-rating-mutations.ts`(選んだ値を先にキャッシュへ入れ`cancelQueries`、失敗で最後に確定した値へ戻す。送信中に選んだ値は保留して最後の値だけを送り、トーストは1回)。取得の失敗は欄の中の`PartialErrorState`。文言の定数は`rating-messages.ts`(未確認の理由の写しを持つ前例)。PRODUCT_PAGE_SECTIONSの`aside`に`engagement.rating`(20)を登録した。「取り消す」の送信中は`aria-busy`だけで文言は変えない(文言規則に処理中の文言が無い)。
- 7.1: 木は`comment-tree.ts`の`buildTree(thread)`が返す`CommentTreeNode { comment, replies }`の再帰の形で、7.6は第3階層を`comment.depth`で判定する。キャッシュの更新は`prependThread`・`appendReply`・`replaceComment`・`markCommentRemoved`(型`LaunchCommentsData = InfiniteData<ClientLaunchCommentsQuery, string | null>`、何も変わらなければ同じ参照を返し、既にあるIDは重ねない)で、7.5の無限の取得は`initialPageParam: null`にする。削除は返り値の`REMOVED`を`replaceComment`で反映してもよい。投稿欄のスキーマは`comment-form-schema.ts`の`commentFormSchema`・`commentWithRatingFormSchema`(評価の入力は`number | null`)。
- 1.1の修正(7.1の後): `commentBodySchema`・`ratingScoreSchema`を`coding/005`の「共用部品の検証規則は呼ばれた時に作る関数にする」に合わせて関数(`commentBodySchema()`・`ratingScoreSchema()`)に直し、api・clientの呼び出し側とdesign.mdのEngagementRulesの宣言を直した。後続のタスクは関数の形で呼ぶ。
- 7.2: `CommentTime`(`comment-time.tsx`)は設計の`<time tabIndex=0>`ではなく`<button type="button">`の中の`<time>`(lintの`jsx-a11y-x/no-noninteractive-tabindex`。前例`award-badge-list.tsx`)で、ツールチップが閉じている間も隠した要素を`aria-describedby`に結び完全な日時を伝える。利用する側は`TooltipProvider`の内側に置く。ハイドレーションの前は月日と曜日で示す。frontend-libに`components/datetime/use-now.ts`(`useNow()`、`RelativeTime`の共有タイマーを取り出した)を作り`005-shared-components.md`へ追記した。identity-authの`useResendVerification`に再送の文書の引数(既定は従来)を足し、`CommentGate`(`kind`は`'guest' | 'unverified'`)は`ClientEngagementResendVerificationEmailDocument`を渡す。`CommentListSkeleton`は`loadingMore`で「続きを読み込み中」(7.7が使う)。文言の定数は`comment-messages.ts`。design.mdの「Modified Files」にはfrontend-libの`use-now.ts`・`relative-time.tsx`、identity-authの`use-resend-verification.ts`、`005`が載っていない。
- 7.3: 投稿欄は`comment-composer.tsx`の`CommentComposer({ target, productId, viewerIsOwner, onSubmit })`(`target`は`{mode:'post'} | {mode:'reply', onCancel} | {mode:'edit', body, topLevel, onCancel}`、`onSubmit`は`{ body, rating?, turnstileToken }`を受けて`Promise<void>`、解決で空にし拒否で失敗の文言)。評価の行は`kind === 'member'`のトップレベルの投稿と編集だけで、初期値は`productRatingQueryOptions`の現在の評価、現在の評価から変えたときだけ`rating`を送る(7.5は`rating`の有無で「コメントと評価を投稿しました。」を選ぶ)。未確認の閲覧者の自分の編集欄は評価の行を描かない。トークンは`sendWithTurnstile`ではなく`waitForToken()`で取り出して渡す(`005`の「`sendWithTurnstile`で行う」と食い違い、`bot_verification_failed`で自動で送り直さない)。本文のラベルは視覚的に隠した例文と同じ文言(`008`の「表示しているラベル」と食い違う)。プレビューの`idScope`は`008`の表どおり`'preview'`で、複数の投稿欄のプレビューを同時に開くと見出しのIDが重なり得る(`008`の49行と文書の中で食い違う)。返信・編集の欄は呼び出し元が`onSubmit`の中で閉じフォーカスも扱う。
- 7.4: 他者のコメントの操作の登録口は`apps/client/src/composition/comment-actions.ts`の`COMMENT_ACTIONS`(初版は空)、型は`components/engagement/comment-action-types.ts`(`CommentActionContext`・`CommentAction`)。`CommentMenu`(`comment-menu.tsx`、`actions`の既定値は`COMMENT_ACTIONS`、`viewerIsAuthor`、削除の確認のダイアログをメニューの中で描く)は表示中のコメントにだけ描く前提で、`SHOWN`の判定は7.6が持つ。削除に成功すると「…」が外れフォーカスの戻り先が無くなるため、7.6・7.7は置き換え表示の項目などへフォーカスを移す。`DeleteCommentDialog`の`onDelete`は解決で閉じ、拒否でダイアログに失敗の文言を示す(成功のトーストは7.5)。登録した部品は`DropdownMenuContent`の中に描くためメニューが閉じると外れ、content-reportingの`CommentReportMenuItem`の「メニューを閉じてから`ReportDialog`を開く」はダイアログの状態ごと消える(前例`PUBLIC_PROFILE_MENU_ITEMS`の契約と同じ課題。最終報告で開発者へ挙げる)。
- 7.5: スレッドの照会は`apps/client/src/graphql/engagement.ts`の`launchCommentsQueryOptions(viewerId, productId, launchId)`(キー`[doc, {productId, launchId}, viewerId|guest]`、`initialPageParam: null`)、件数は`launchCommentCountsQueryOptions(viewerId, productId)`(キー`[doc, {productId}, viewerId|guest]`。`launchCommentCounts`は閲覧できないとnullを返し閲覧者で変わるため、設計の`launchCommentCounts(productId)`より細かく閲覧者を含める)で、無効化は前方部分`launchCommentCountsKeyOf(productId)`。操作は`use-comment-mutations.ts`の`useCommentMutations({ productId, launchId, viewerId })`(`post`・`reply(parentId, …)`・`update(commentId, …)`・`remove(commentId, turnstileToken)`、`viewerId`は必須でログイン中の部品の中で呼ぶ)。成功でスレッドを7.1の関数で更新(削除は返り値の`REMOVED`を`replaceComment`)、評価があれば`replaceProductRating`、投稿・返信・削除で件数を無効にして取り直し、8.15のトーストを出す。失敗はトーストを出さずに拒否する(投稿欄・ダイアログが文言を示す)。`cancelQueries`をしないため、書き込みの前に始まった`fetchNextPage`・取り直しが更新を上書きし得る(既知の限界、8.1の`frontend/015`に記す)。
- 7.6(差し戻し1回、テストの不足): コメントの項目は`comment-item.tsx`の`CommentItem`(`mutations: CommentItemMutations | null`、未ログインはnull。`actions?`の既定は`COMMENT_ACTIONS`)。7.7は項目を`<ol>`の中に置き、削除の後のフォーカスは項目自身が置き換え表示の`<article tabIndex=-1>`へ移すため重ねて移さない。返信の一覧は入れ子の`<ol aria-label="返信">`。未確認の「返信」は`aria-disabled`と理由の説明とツールチップ(upvoteの前例。`frontend/004`の「条件を満たすまで押せない→`disabled`」と食い違い、前例も揃っていない)。アバターは`SquareDisplaySize`に36が無いため`size={32}`を36pxで描画(設計は`UserAvatar(36)`)。7.3の`comment-composer.tsx`を変えた: 返信・編集の欄を開いた時に本文へフォーカスを移し、「キャンセル」は`onMouseDown`で`preventDefault`する(空の本文のフォーカスアウトの検証でボタンがずれ押下が外れる不具合の修正)。テストは`DisplayPreferencesProvider`と`TooltipProvider`で包む。
- 7.7: スレッドの一覧は`comment-thread.tsx`の`CommentThread({ product: {id, handle}, launch: {id}, viewerIsOwner })`(`launchComments`がnullなら欄全体を描かない。`useCommentMutations`はログイン中の内側の部品の中だけで呼ぶ)。7.8は開いている間だけ描く。続きの失敗は「さらに読み込む」を`PartialErrorState`の「再試行」に置き換え、フォーカスを新しい再試行のボタンへ移す(`002-page-layouts.md`・`003`のコメント欄の定めと前例`supporters-panel.tsx`に従い、`frontend/006`の「同じボタンで読み込み直す」と`frontend/004`の「読み込みの失敗ではボタンに残す」と食い違う。8.1の`frontend/015`に例外として記し、最終報告で挙げる)。`PartialErrorState`の文言は固定(`frontend/006`の`errorMessageOf`と食い違うが前例どおり)。最初の再試行のフォーカスは欄の外枠(`data-slot="comment-thread"`、`tabIndex=-1`)。件数の取り直しの確認は7.8。テストの補助は設計のファイル構成に無い`comment-thread-testing.tsx`。
- 7.8: ローンチのコメント欄は`launch-comments-section.tsx`の`LaunchCommentsSection`で、`PRODUCT_LAUNCH_SECTIONS`に`engagement.comments`(10)を登録した。件数は区画ごとに`launchCommentCountsQueryOptions`の`select: countOf(launch.id)`で取り出し全ブロックで1回の取得を共有し、`enabled: launch.kickedOff`。開閉の矢印は遷移を付けずに切り替え(前例のサポーターの開閉の`transition-transform`と揃っていない。テストは区画の中のボタン以外のアニメーションを0件とする)。ボタンの名前は「コメント 1,234件」。`docs/onboardings/project-values.md`の区画の登録の行は`PRODUCT_LAUNCH_SECTIONS`を「登録0件」、`PRODUCT_PAGE_SECTIONS`を「4件」と書いて実態と食い違うため、8.2で`engagement.comments`(10)と`engagement.rating`(`aside` 20)を反映する。
- 7.9: ディレクトリの項目のコメント数は`comment-count-metric.tsx`の`CommentCountMetric`(`/p/<handle>#launches-heading`、`MATCH_HISTORY_HEADING_ID`を再利用)で、clientの`DIRECTORY_ITEM_METRICS`に`comments`(10)を登録した(apiの3.7の`key`と手で揃えた)。読み上げは数を`aria-hidden`にし`sr-only`の1つの文「コメント{n}件」にした(前例の分割の形ではChromeが語の間に空白を入れるため。前例`win-summary.tsx`・7.8のボタンの名前と形が揃っていないので8.1で指針を書く)。登録箇所が部品を読み込むため`components/directory/directory-sections.unit.test.ts`を`.browser.test.ts`へ移した(directory-discoveryの前例)。`project-values.md`の「ディレクトリの登録箇所」の行は8.2で直す。
- 8.1(差し戻し1回): 技術文書は`docs/GUIDES/tech/backend/015-tombstoned-comment-threads.md`・`frontend/015-star-rating-and-threaded-composer.md`。CLAUDE.mdの参照先にはbackend/015だけを加えた(設計とタスクの指定どおり。frontend/013・014は参照先にあり、frontend/015も加えると揃う)。frontend/015に、星の入力の自作(`004`のRadixに任せる規則の例外)・続きの失敗で再試行のボタンへ置き換える(`006`・`004`の例外)・理由をツールチップでだけ示す`aria-disabled`(`004`の`disabled`の例外)・本文のラベルを隠す(`008`の例外)・`PartialErrorState`の固定の文言(`006`の例外)と、登録口の項目のダイアログがメニューが閉じると外れる既知の限界を書いた。`004`・`005`・`006`・`008`の側からfrontend/015の例外への参照は加えていない。8.2はプレースホルダー(backend/015の`<階層の上限>`など、frontend/015の`<段階の数>`など)と、例の`aggregate_id`→`product_id`・`target_id`→`launch_id`の対応を`project-values.md`へ写す。
- 8.2(差し戻し1回): `docs/onboardings/project-values.md`に本specの固有の値(処理とジョブの名前と`order`、bot対策の操作名、区画と項目の値の登録、上限、技術文書のプレースホルダー、新しい節「コメントと評価」)を加え、7.8・7.9で食い違っていた登録の行とフラグメントの一覧を直した。期限超過の報告の文言を、コードの判定(論理削除の業務日付が実行日の14日前以前、つまり前日までの実行で匿名化するはずだった行が残れば「期限を過ぎるおそれ」として報告する)に合わせて、`007-daily-timeline.md`・design.mdの匿名化と物理削除の表・`project-values.md`で直した。コードの報告の文言(`sentry-engagement-incident-reporter.ts`の「削除から匿名化の期限を過ぎても…」)は変えていない(最終報告で挙げる)。
