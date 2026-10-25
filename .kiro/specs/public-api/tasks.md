# Implementation Plan

- [ ] 1. 基盤: 共有の規則・テーブル・設定・文言
- [ ] 1.1 APIキーの名前と権限スコープの規則を、apiとclientが読み込める共有の定義として作る
  - 前提: dev-tooling〜sponsorshipの23specの全タスクが完了していること(api-gatewayの公開RESTの骨格とGraphQLの基盤、backend-platformの`RateLimitCounter`・`bindingRateLimit`・`KeyedHasher`、identity-authの`AccountGuard`・`USER_LIFECYCLE_SYNC_HANDLERS`・設定ページのシェル・`e2e/support/mailpit.ts`、directory-discoveryの`DirectoryReader`・`DirectoryCategoryReader`・`ProductPageReader`・`e2e/support/directory-fixtures.ts`、match-engineの`MatchDirectory`・`SupporterDirectory`・`UpvoteHistoryReader`、engagementの`CommentReader`・`RatingService`、user-profile-socialの`MyProfileReader`・`ProfileEditor`・`PublicProfileReader`・`UserProfileDirectory`、product-launchの`ProductDirectory`・`MyProductsReader`・`ProductDescriptionEditor`、media-pipelineの`MediaFiles`・`common-lib/media`、上流の改訂のapi-gatewayの`createRestModule`の`options.info`・相対の`servers`、backend-platformの`REDACTION_PATTERNS`の`lsk_`と改訂3のSentryの伏せ字の範囲、product-launchの仮12の`ProductDescriptionEditor`の`product_hidden`、infra-deliveryの改訂1の「ホスト名から導かれる変数の値」の表のapiの`IMAGES_ORIGIN`・clientの`PUBLIC_API_ORIGIN`の行)。無ければ該当するタスクを保留して開発者へ報告する
  - 先に、単体テストで、名前の空・空白だけ・前後の空白の除去・50書記素と51書記素(結合文字を含む絵文字)、7機能の許される値(読み取りの5機能の`read_write`の拒否・未知の値の拒否)、発行の初期値(読み取りの5機能は`read`、2機能は`none`)、機能と値の表示名の網羅を確かめる
  - 他の層を読み込まない(書記素の数え方はcommon-libの既存の関数を使う)
  - 完了状態: 単体テストが成功し、apiとclientの型検査で規則を読み込める
  - _Requirements: 1.3, 1.4, 2.1, 6.3, 6.4_

- [ ] 1.2 APIキーのテーブルとマイグレーションを作る
  - 先に、テーブルの定義の単体テストで、列名(snake_case)・NOT NULL・ハッシュの一意索引・`(user_id, created_at, id)`の索引・権限スコープの列のCHECKの値・利用者への外部キーに`ON DELETE`の指定が無いことを確かめる
  - スキーマの集約点に再エクスポートを加え、mainの最新を取り込んでからマイグレーションを生成する
  - 完了状態: 単体テストが成功し、マイグレーションをローカルに適用でき、CHECKに違反する値の挿入が失敗する
  - _Requirements: 1.2, 1.5, 2.1, 5.5_

- [ ] 1.3 (P) ページ配置・文言規則に、本specの画面と文言を先に書く
  - ページ配置: 「APIキー(`/settings/api-keys`)」の節(一覧・発行と編集のフォーム・平文の1度だけの表示・削除と再発行の確認・停止中の扱い)と、「APIドキュメント(`/api-docs`)」の節(見出し・説明・Swagger UI・読み込み中と失敗)を、2026-10-24に開発者が確定した仮1〜仮4(停止中のキーは公開データだけ読める、再発行は元のキーを残す、他の利用者の公開プロフィールを読める、Swagger UIは同一オリジンで配信)に合わせて加える
  - 文言規則: 設計の画面の部品とError Handlingに挙げた文言(平文の保管の案内・コピーの成功と失敗・削除の確認と再発行の確認(元のキーが残ることと、不要になったら削除すること)・0件・一覧の取得の失敗・停止中の案内・キーが見つからない・APIドキュメントの読み込みの失敗・名前の入力の誤り)を加える
  - 完了状態: 2つの文書が整形の検査を通り、6・7のタスクが参照する文言がすべて文言規則にある
  - _Boundary: `docs/GUIDES/service/design/002-page-layouts.md`・`003-text-and-copy-rules.md`_
  - _Requirements: 17.5_

- [ ] 1.4 (P) APIサーバーにIP単位の制限のバインディングと画像配信のオリジンの変数を加える
  - Wrangler設定の3環境に`PUBLIC_API_RATE_LIMITER`(`limit: 60`・`period: 60`、`namespace_id`はローカル1005・staging 2005・prod 3005)と`IMAGES_ORIGIN`の値(infra-deliveryの改訂1の表のapiの行)を加え、環境の検証のスキーマと型の宣言に足す
  - 先に、Wrangler設定の検査のテスト(`apps/api/test/config/wrangler-config.unit.test.ts`)で、3環境のバインディング名・上限・期間・`namespace_id`が他のWorkerと重ならないこと・変数の値の形を確かめる
  - 完了状態: 設定の検査のテストと環境の検証の単体テストが成功し、ローカルのapiが起動する
  - _Boundary: `apps/api/wrangler.jsonc`・`apps/api/src/composition/env-schema.ts`_
  - _Requirements: 13.4, 8.9_

- [ ] 1.5 (P) clientの環境に公開APIのオリジンを加え、CSPの接続先に入れる
  - content-processingの`CLIENT_SITE_ORIGIN`・paymentsの`STRIPE_PUBLISHABLE_KEY`と同じ手順で、clientの環境の検証に`PUBLIC_API_ORIGIN`(URLのオリジン、clientだけ必須)を加え、公開設定の`publicApiOrigin`(adminは未定義)へ渡し、実行時の許可先の`connect-src`に値があれば加える
  - clientのWrangler設定の3環境に値を書く(ローカル`http://localhost:48042`、staging・prodはapiのホスト名。infra-deliveryの改訂1の表のclientの行に合わせる)
  - 先に、単体テストで、不正なオリジンの拒否・adminで値が無くても検証が通ること・ページのCSPの`connect-src`に値が入りadminには入らないことを確かめる
  - 完了状態: frontend-libとclientの単体テストと設定の検査のテストが成功し、ローカルのclientのページのCSPに公開APIのオリジンが載る
  - _Boundary: `apps/frontend-lib/server/env/frontend-env.ts`・`apps/frontend-lib/server/http/security-policy.ts`・`apps/client/wrangler.jsonc`・`apps/client/test/config/wrangler-config.unit.test.ts`_
  - _Requirements: 15.2, 15.7_

- [ ] 2. ドメインの規則と共有部品
- [ ] 2.1 (P) 平文の形式・Bearerの解析・権限スコープの判定の純粋な規則を作る
  - 先に、単体テストで、ヘッダーの欠落・空・方式名の大文字小文字・別の方式・接頭辞と長さの違反、全7機能×全値×読み取りと書き込みの判定の表(読み取りの5機能に書き込みを問うと常に偽)を確かめる。経路の対象の型(公開データ・自分のデータ)も同じファイルに置く
  - 完了状態: 単体テストが成功し、規則がD1・Honoを読み込まない
  - _Depends: 1.1_
  - _Boundary: ApiKeyToken、ApiKeyScopes_
  - _Requirements: 2.2, 2.3, 7.2, 7.3_

- [ ] 2.2 (P) データエクスポートが使うAPIキーの照会を作り、apiとeventの両方に束縛する(backend-lib・api・eventにまたがる統合のタスク)
  - 先に、ローカルD1のWorkers統合テストで、利用者のキーだけを発行の古い順に返すこと、名前・権限スコープ(camelCaseのキーと`none`・`read`・`read_write`)・発行日時だけを返し平文とハッシュを持たないことを確かめる
  - 照会を処理単位で束縛するモジュールとDIの識別子を作り、apiとeventの束縛の一覧へ同時に加える
  - 完了状態: Workers統合テストと、3経路(apiの`fetch`・eventの`fetch`・eventの`queue`)のDIの解決の検査が成功する
  - _Depends: 1.2_
  - _Boundary: ApiKeyExport、PublicApiPlatformModule、`apps/api/src/composition/modules.ts`・`apps/event/src/composition/modules.ts`_
  - _Requirements: 16.1, 1.9_

- [ ] 2.3 回数の規則・未ログインとキーの持ち主のセッション・ポートとDIの識別子を作る
  - 3つの回数の規則(発行は1時間3回、読み取りは1分30回、書き込みは1分15回)と操作による選択、IP単位の制限の値の定数(1分60回。Wrangler設定の値と照合し、仕様書の説明と、4.3が`bindingRateLimit`へ渡す期間(429の`Retry-After`の元)に使う)、常に未ログインを返すセッションと、キーのIDを入れた疑似のセッションIDで利用者を返すセッションを作る
  - キーのストア・乱数とハッシュの生成のポートと型、本specのapiの全部品のDIの識別子をここで一括で作る(3〜5のタスクは識別子を作らない)
  - apiの束縛のモジュールを空で作り、apiの束縛の一覧へ加える。以後の3.1〜3.4・4.1・5.1は自分の部品の束縛をこのモジュールへ追記し、5.3・5.5・5.6の部品の束縛は5.7でまとめて追記する(並行のタスクが同じファイルを書かない)
  - 先に、単体テストで、規則の名前・上限・期間、IP単位の制限の定数、操作から規則への対応、2つのセッションが返す主体の形を確かめる
  - 完了状態: 単体テストが成功し、型検査でポートと識別子を読み込め、空のモジュールを加えたapiのDIの解決の検査が成功する
  - _Requirements: 4.1, 4.3, 5.2, 8.8, 13.1, 13.3, 13.8_

- [ ] 3. APIキーの管理
- [ ] 3.1 APIキーのストアと乱数・ハッシュの生成を作る
  - 先に、ローカルD1のWorkers統合テストで、ハッシュでの照合、発行の`CASE`式(停止中・退会済みの利用者では保存しない)、編集の本人の確認、同じ名前と権限スコープのキーを重ねて保存でき元のキーと新しいキーの両方で照合できること、他人のキーを本人のキーとして引くと見つからないこと、削除、一覧の発行の新しい順と続きのカーソル、キーの数に上限が無いこと、生成した平文の形式とハッシュの用途を確かめる
  - ストアと生成の束縛をapiの束縛のモジュールへ追記する
  - 完了状態: Workers統合テストが成功し、利用者の物理削除の検知(外部キー)がキーの行の無い利用者で妨げられない
  - _Requirements: 1.1, 1.2, 1.5, 1.8, 3.1, 3.3, 3.4, 3.5, 5.5, 7.4_

- [ ] 3.2 APIキーの一覧・発行・編集・再発行・削除のユースケースを作る
  - 先に、模擬のポートの単体テストで、名前と権限スコープの項目ごとの検証の誤り、発行と再発行で回数の制限を先に掛けて4回目を429にすること、編集と削除が回数に数えないこと、再発行が最初に元のキーを読み(無ければ回数を消費せずに見つからない旨)、元の名前と権限スコープを複写した新しいキーを発行と同じ処理(回数の制限→乱数とハッシュ→保存)で加え、元のキーを変えないこと、他人・不在のキーを区別しない見つからない旨、停止中・退会済みの保存の拒否の変換、平文を応答でだけ返すこと、発行・再発行・削除のログがキーのIDと利用者のIDだけで平文を含まないことを確かめる
  - 発行・再発行・削除をカテゴリ`['api', 'public-api', 'key']`の`info`で記録し、ユースケースの束縛をapiの束縛のモジュールへ追記する
  - 完了状態: 単体テストが成功する
  - _Requirements: 1.1, 1.3, 1.4, 1.8, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4_

- [ ] 3.3 退会でAPIキーを全て消す同期の波及処理を作り、登録する
  - 読み取りをせず、利用者の全てのキーを消す1文だけを返す処理を作り、その束縛をapiの束縛のモジュールへ追記するのと同じタスクで、退会の同期の波及処理の登録箇所に`public-api.api-key-erasure`(退会だけ)として追記する(束縛の無い登録で退会の経路全体が失敗しないようにするため)
  - 先に、Workers統合テストで、identity-authの退会の確定で利用者のキーが全て消え他の利用者のキーが残ること、停止では消えないことを確かめる
  - 完了状態: Workers統合テストが成功し、4:21のジョブと非同期の波及処理を登録していない
  - _Boundary: ApiKeyErasureSyncHandler、`apps/api/src/composition/user-lifecycle-sync-handlers.ts`_
  - _Requirements: 5.1, 5.4, 16.4_

- [ ] 3.4 APIキーの管理のGraphQLのスキーマモジュールを作り、登録箇所に組み込む
  - 一覧・発行・編集・再発行・削除の5つの操作を、ルート型は`extend`を使わず`type Query`・`type Mutation`のまま書き、呼び出し元をclientに限り、一覧と削除は`requireUser`、発行・編集・再発行は`requireWritableUser`で受け付ける。スキーマモジュールの登録箇所へ加え、生成コマンドでスキーマファイルと型を更新する
  - 先に、Workers統合テストで、各操作のエラーコード(未ログイン・停止中・入力の誤り・見つからない・429)、停止中の一覧と削除の許可、未確認の利用者の発行の許可、発行の3回目と4回目、平文が発行と再発行の応答にだけ含まれることを確かめる
  - 完了状態: Workers統合テストとスキーマの食い違いの検査が成功する
  - _Requirements: 1.1, 1.6, 1.7, 1.9, 3.7, 3.8, 4.2_

- [ ] 4. 公開APIの認証と回数の制限
- [ ] 4.1 キーの照合・利用者の状態・権限スコープ・利用者単位の回数の制限を判定するユースケースを作る
  - 先に、模擬のポートの単体テストで、判定の順序(形式→照合→利用者の状態→権限→回数)、形式違反と不在のキーの区別の無い無効、経路の対象による利用者の状態の判定(停止中の持ち主のキーは公開データの経路で通り、自分のデータの経路で403)と利用者が見つからない場合の無効への変換、権限の不足の403、読み取りと書き込みで別の規則を使い利用者のハッシュ化した識別をキーにすること、失敗が回数を消費しないこと、上限・残り・リセットの時刻を返すこと、429に再試行の秒数と回数の値を持たせることを確かめる
  - ユースケースの束縛をapiの束縛のモジュールへ追記する
  - 完了状態: 単体テストが成功する
  - _Requirements: 2.2, 2.3, 2.4, 5.2, 5.3, 7.3, 7.4, 7.5, 13.1, 13.2, 13.3, 13.6, 13.8_

- [ ] 4.2 経路の定義の補助・認証の中間処理・公開APIのエラーコードの表を作る
  - 機能・操作・対象(公開データか自分のデータか)を宣言すると、Bearerの認証方式・中間処理・401・403・429の応答・必要な権限の説明が経路の定義に加わる補助を作る。中間処理は401に`WWW-Authenticate`を、成功と429に`X-RateLimit-*`を付け、拒否をキーのID・利用者のID・経路のパターン・状態コードだけで記録する
  - 設計のData Contractsのエラーコードの表(`unauthenticated`・`invalid_api_key`・`account_unavailable`・`insufficient_scope`・`product_not_found`・`user_not_found`・`launch_not_found`・`match_not_found`・`product_hidden`)を、文言と`AppError`の生成とともにここで全て作る(5.2〜5.6は読み込むだけで追記しない)。`product_hidden`の文言はproduct-launchの仮12の文言と同じにし(product-launchが定数を公開していればそれを使う)、単体テストで一致を確かめる
  - 先に、テスト用の経路を登録したWorkers統合テストで、ヘッダーの欠落・形式違反・不在・削除済みのキーの401と`WWW-Authenticate`、権限の不足の403、停止中の持ち主のキーで対象が公開データの経路は200・自分のデータの経路は403、読み取りの30回目と31回目・書き込みの15回目と16回目の429と`Retry-After`・`X-RateLimit-*`、1分後のリセット、停止の解除後に自分のデータの経路も200になること、仕様書の経路の説明と認証方式、ログに`Authorization`と平文が出ないことを確かめる
  - 完了状態: Workers統合テストが成功する
  - _Requirements: 2.5, 5.2, 5.3, 7.1, 7.2, 7.3, 13.5, 13.7, 16.2, 17.2_

- [ ] 4.3 公開APIのIP単位の回数の制限を作り、経路の登録箇所の先頭に置く
  - 公開APIの経路の集約(初版はIP単位の制限だけ)を作り、経路の登録箇所に先頭が必要である旨の注記とともに追記する
  - 期間は2.3のIP単位の制限の定数から取り、Wrangler設定の検査のテストに、3環境の`PUBLIC_API_RATE_LIMITER`の`limit`・`period`がその定数と一致することを加える
  - 先に、Workers統合テストで、仕様書の配信を含む60回目と61回目の429と`Retry-After: 60`、プリフライトを数えないこと、送信元IPアドレスごとに別に数えることを確かめる
  - 完了状態: Workers統合テストが成功する
  - _Requirements: 13.4, 13.5, 17.2_

- [ ] 5. 公開APIの経路
- [ ] 5.1 共通の応答の形・画像と利用者の表示の写像・一括の照会を作る
  - 画像の写像(隔離中・削除待ちは空、変換の名前と形式)、利用者の表示、プロフィールとプロダクトのページのURL、カーソルの問い合わせのスキーマ、写像の前に画像と利用者を1回ずつまとめて読む照会を作る
  - 経路が共用する補助として、プロダクトのハンドルの解決(ハンドルの形式・`resolveHandle`・未ログインの公開範囲の判定)と、旧ハンドルの302の応答(現在のハンドルへ置き換えた同じパスとクエリの維持)を作る(5.2〜5.5は読み込むだけ。5.3のサポーターの読み取りはapplication層のため302の応答だけを使う)
  - 一括の照会の束縛をapiの束縛のモジュールへ追記する
  - 先に、単体テストで写像の各場合と302の場所の組み立てを、Workers統合テストで照会が画像と利用者をそれぞれ1回だけ読むことと、ハンドルの解決の4つの結果(現在・旧・公開範囲外・形式違反)を確かめる
  - 完了状態: 単体テストとWorkers統合テストが成功する
  - _Requirements: 8.5, 8.6, 8.9, 14.1, 14.3, 14.6, 16.3_

- [ ] 5.2 (P) プロダクトの一覧・詳細・カテゴリ・ローンチ履歴の経路を作る
  - 一覧は問い合わせを厳密に検証してディレクトリの読み取りを未ログインで呼び、存在しないカテゴリを入力の誤りにする。詳細とローンチ履歴はプロダクト詳細の読み取りを未ログインで呼び、旧ハンドルを302、公開範囲外を404にする
  - 先に、単体テストで写像(基準勝利の3種類・対戦相手の4種類・受賞・通算成績)を、Workers統合テスト(テスト用に経路を組み立てる)で、掲載中・未掲載・非公開化・停止中の投稿者・論理削除のプロダクトの200と404、旧ハンドルの302とクエリの維持、各問い合わせの違反の400、範囲外のページの空の一覧、キーの持ち主の未掲載のプロダクトも404であること、1ページ20件と総件数を確かめる
  - 完了状態: 単体テストとWorkers統合テストが成功する
  - 4経路は対象を公開データとして定義する
  - _Depends: 4.2, 5.1_
  - _Boundary: `routes/product-routes.ts`・`schemas/products.ts`・`mappers/product-mappers.ts`_
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 9.1, 9.2, 14.2_

- [ ] 5.3 (P) サポーターとUpvote履歴の経路を作る
  - サポーターはプロダクトの公開範囲・マッチの側・確定を確かめてから20件ずつ読み、Upvote履歴は上流の読み取りを未ログインで呼ぶ
  - 先に、単体テストでサポーターの読み取りのユースケースと写像を、Workers統合テストで、退会・停止したサポーターの除外、他のプロダクトのマッチ・未確定のマッチの404、カーソルの続きと不正なカーソルの400、非公開化・論理削除されたプロダクトのUpvote履歴からの除外と総件数、停止中・退会済みの利用者の404を確かめる
  - 完了状態: 単体テストとWorkers統合テストが成功する
  - ユースケースの束縛はこのタスクではapiの束縛のモジュールへ追記せず、テストではテスト用のコンテナで組み立てる(束縛は5.7で追記する)
  - 2経路は対象を公開データとして定義する
  - _Depends: 4.2, 5.1_
  - _Boundary: PublicSupporterReader、`routes/upvote-routes.ts`・`schemas/upvotes.ts`・`mappers/upvote-mappers.ts`_
  - _Requirements: 9.3, 9.4, 9.5, 9.6, 9.7_

- [ ] 5.4 (P) コメントと評価の集計の経路を作る
  - コメントは上流のスレッドの読み取りを未ログインで呼び、評価の集計は上流の評価の読み取りを未ログインで呼ぶ
  - 先に、単体テストで置き換え表示のコメントの写像(本文と投稿者を含めない)を、Workers統合テストで、10スレッドずつの続きと返信の古い順、削除・非公開化・停止中の利用者のコメントの置き換え、取り消し・他のプロダクトのローンチの404、無効化した評価と停止中の利用者の評価を除いた平均値と件数を確かめる
  - 完了状態: 単体テストとWorkers統合テストが成功する
  - 2経路は対象を公開データとして定義する
  - _Depends: 4.2, 5.1_
  - _Boundary: `routes/engagement-routes.ts`・`schemas/engagement.ts`・`mappers/engagement-mappers.ts`_
  - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

- [ ] 5.5 (P) 公開プロフィール・自分のプロフィールの読み取りと部分更新の経路を作る
  - 部分更新は現在のプロフィールに指定の項目だけを重ね、画像と旧ハンドルの確認の値を現在の値にしてプロフィールの保存を呼ぶ。公開プロフィールは常に未ログインのセッションで読む
  - 先に、単体テストで部分更新の合成(未指定の項目と画像が保たれる)を、Workers統合テストで、自分のプロフィールの読み取り、各項目の検証の400・予約語と使用中のハンドルの拒否・画像の項目の400・未知の項目の400・空の本文の400、停止中・退会済みの利用者の公開プロフィールの404と旧ハンドルの302、フォロワー数とUltras加入中かどうかを確かめる
  - 完了状態: 単体テストとWorkers統合テストが成功する
  - ユースケースの束縛はこのタスクではapiの束縛のモジュールへ追記せず、テストではテスト用のコンテナで組み立てる(束縛は5.7で追記する)
  - 公開プロフィールの経路は対象を公開データ、自分のプロフィールの読み取りと更新の経路は対象を自分のデータとして定義する
  - _Depends: 4.2, 5.1_
  - _Boundary: PublicProfileUpdater、`routes/profile-routes.ts`・`schemas/profiles.ts`・`mappers/profile-mappers.ts`_
  - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7_

- [ ] 5.6 (P) 自分のプロダクトの一覧と説明文の更新の経路を作る
  - 説明文の更新は自分のプロダクトを解決し(旧ハンドルは現在のハンドルで読み直す)、非公開化中ならproduct-launchの仮12と同じ文言(「このプロダクトは公開が停止されているため、説明文を更新できません。」)の`product_hidden`(409)にしてから説明文の保存を呼び、読み直した結果を返す。説明文の保存が投げる`product_hidden`・`product_not_found`・`account_unavailable`は変えずにそのまま返す
  - 先に、単体テストでユースケースの判定を、Workers統合テストで、未掲載を含む自分のプロダクトの20件ずつの一覧、他人・論理削除のプロダクトの404、非公開化の409と文言がproduct-launchの`product_hidden`と同じであること、事前の判定の後に非公開化・停止・論理削除された場合に説明文の保存のエラー(`product_hidden`・`account_unavailable`・`product_not_found`)がそのまま返ること、説明文の空・20,000書記素を超える値の400、更新でdirectory-discoveryの保存の登録口が掲載中のプロダクトの索引を更新待ちにすることを確かめる
  - 完了状態: 単体テストとWorkers統合テストが成功する
  - ユースケースの束縛はこのタスクではapiの束縛のモジュールへ追記せず、テストではテスト用のコンテナで組み立てる(束縛は5.7で追記する)
  - 2経路は対象を自分のデータとして定義する
  - _Depends: 4.2, 5.1_
  - _Boundary: OwnProductDescriptionService、`routes/my-product-routes.ts`・`schemas/my-products.ts`・`mappers/my-product-mappers.ts`_
  - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_

- [ ] 5.7 全ての経路を公開APIの経路の集約に加え、仕様書とCORSを確かめる
  - 5.2〜5.6の経路をIP単位の制限の後に加え、5.3・5.5・5.6のユースケースの束縛をapiの束縛のモジュールへ追記する
  - 先に、apiのWorkerの組み立てを使うWorkers統合テストで、仕様書が認証なしで全13経路と必要な権限・エラーの状態コードを載せること、全経路の権限不足の403、プリフライトと各経路の`Access-Control-Allow-Origin: *`・メソッド・`Authorization`と更新の経路の`Content-Type`、停止中の持ち主のキーで公開データの9経路が処理され`/v1/me`の下の4経路が403`account_unavailable`になること、公開データの1要求で上流の照会が項目の数に比例しないことを確かめる
  - 完了状態: Workers統合テストが成功する
  - _Depends: 4.3, 5.2, 5.3, 5.4, 5.5, 5.6_
  - _Requirements: 2.5, 5.2, 14.1, 14.2, 14.4, 14.5, 14.6, 16.3_

- [ ] 6. 利用者側の画面: APIキーの管理
- [ ] 6.1 APIキーの管理の操作と設定ページのナビゲーションを加える
  - 一覧・発行・編集・再発行・削除の操作を定義してコード生成と許可リストを更新し、設定ページのナビゲーションの登録箇所に「APIキー」(`order` 90)を追記する
  - 完了状態: コード生成の検査と許可リストの食い違いの検査が成功し、設定ページのナビゲーションの単体テストで「APIキー」が書き出しの順に並ぶ
  - _Requirements: 6.1_

- [ ] 6.2 (P) 発行と編集のフォームと権限スコープの選択欄を作る
  - 先に、ブラウザテストで、名前の検証(空・51文字)のフォーカスアウトと送信時の表示、40文字を超えた後のカウンター、7機能の選択肢の数(2択と3択)、発行の初期値、編集で現在の値が入ること、429の文言、axe-coreの検査を確かめる
  - 完了状態: ブラウザテストとフォームのスキーマの単体テストが成功し、Storybookに状態ごとの例がある
  - _Depends: 1.1, 1.3_
  - _Boundary: ApiKeyFormDialog、ApiKeyScopeFields、ApiKeyFormSchema_
  - _Requirements: 6.3, 6.4, 6.7_

- [ ] 6.3 (P) 平文の表示のダイアログと削除・再発行の確認のダイアログを作る
  - 先に、ブラウザテストで、平文と保管の案内の表示、コピーの成功と失敗の通知、閉じた後に平文がDOMと状態に残らないこと、削除の確認と再発行の確認(元のキーがそのまま使えることと、不要になったら削除することを示す)の文言と操作名のボタン、axe-coreの検査を確かめる
  - 完了状態: ブラウザテストが成功し、Storybookに例がある
  - _Depends: 1.3_
  - _Boundary: IssuedApiKeyDialog、ApiKeyConfirmDialog_
  - _Requirements: 6.5, 6.6_

- [ ] 6.4 (P) APIキーの一覧と1件の表示を作る
  - 一覧(発行の新しい順・さらに表示)・0件と失敗の状態、1件の表示(名前・権限の要約・発行日時・「編集」「再発行」「削除」)を作る
  - 先に、ブラウザテストで、権限の要約の表記(値ごとに機能の表示名を並べ、全て無効は「権限なし」)、日時の`<time datetime>`、0件の説明と`/api-docs`への導線、失敗の文言と再試行、さらに表示、操作の無効化の受け渡し、axe-coreの検査を確かめる
  - 完了状態: ブラウザテストが成功し、Storybookに0件・失敗・複数件・停止中の例がある
  - _Depends: 1.1, 1.3, 6.1_
  - _Boundary: ApiKeyList、ApiKeyListItem_
  - _Requirements: 6.2, 6.8, 6.9, 6.11_

- [ ] 6.5 APIキーの設定の画面を作り、`/settings/api-keys`のルートに組み込む
  - 見出しと説明・停止中の案内と操作の無効化・「APIキーを発行」を持つ画面を作り、6.2〜6.4の部品と操作を結ぶ。発行・再発行の成功で平文のダイアログを開き、一覧を読み直す。`api_key_not_found`は一覧を読み直して「APIキーが見つかりませんでした。一覧を更新しました。」を通知し、`account_unavailable`は停止中の案内を示す
  - 先に、ブラウザテストで、停止中の発行・編集・再発行の無効と削除の有効、発行の成功で平文のダイアログが開くこと、`api_key_not_found`と`account_unavailable`の扱い、429の文言、axe-coreの検査を確かめる
  - 完了状態: ブラウザテストが成功し、Storybookに通常と停止中の例があり、ローカルの`/settings/api-keys`でキーを発行・編集・再発行・削除できる
  - _Depends: 3.4, 6.1, 6.2, 6.3, 6.4_
  - _Requirements: 6.1, 6.2, 6.5, 6.6, 6.7, 6.10, 6.11_

- [ ] 7. 仕様書とSwagger UIのページ
- [ ] 7.1 (P) 仕様書の取得とサーバーのURLの補正、`/api-docs`のページの枠を作る
  - 仕様書のURLの組み立てと相対のサーバーのURLを公開APIのオリジンの絶対URLにする純粋な関数、見出し・説明・読み込み中・失敗の状態を持つページと、Swagger UIの読み込み関数を差し替えられるビューアーの枠を作り、ログイン不要の`/api-docs`のルートに組み込む(Swagger UIの束の読み込みは7.3で加える)
  - 先に、単体テストでサーバーのURLの補正(相対・絶対・無し)を、ブラウザテスト(読み込み関数は模擬)で、見出しと説明・読み込み中・仕様書の取得の失敗の文言と再試行と問い合わせへの導線、axe-coreの検査を確かめる
  - 完了状態: 単体テストとブラウザテストが成功し、ローカルの`/api-docs`で見出しと説明が表示される
  - clientのルートの木は6.5と同じく生成物のため、取り込みの時に生成し直す
  - _Depends: 1.5_
  - _Boundary: ApiDocsPage、SwaggerUiViewer、OpenApiDocument、ApiDocsRoute_
  - _Requirements: 15.1, 15.4, 15.5, 15.6_

- [ ] 7.2 (P) 仕様書の説明の定数を作り、api-gatewayの改訂1の`createRestModule`へ渡す
  - 認証(Bearerと発行の場所)・権限スコープの一覧・回数の制限・ページ分けの方式を説明する`PUBLIC_API_DOCUMENT_INFO`を作り、`createRestModule(routes, { info: PUBLIC_API_DOCUMENT_INFO })`として`api-worker.ts`の呼び出しで渡す。渡した`info`は既定(`Launch Stadium Public API`・`1.0.0`)を項目ごとに合わせず丸ごと置き換えるため、`title`・`version`・`description`の全てを持たせる
  - 権限スコープの表示名は1.1の定数から、回数の上限(利用者単位の読み取り1分30回・書き込み1分15回、IP単位1分60回)は2.3の規則とIP単位の制限の定数から組み立て、値を書き写さない(発行の回数の制限は公開APIの経路ではないため載せない)
  - 先に、単体テストで説明に7機能と読み取り30回・書き込み15回・IP単位60回の上限が載ることを、Workers統合テスト(apiのWorkerの組み立て)で、配信される仕様書の`info`が渡した値と一致すること・`servers`が`[{ url: '/v1' }]`であることを確かめる(認証なしの配信は5.7で確かめる)
  - 完了状態: 単体テストとWorkers統合テストが成功し、仕様書の`info.title`・`version`・`description`が本specの値になる
  - _Depends: 1.1, 2.3_
  - _Boundary: PublicApiDocumentInfo、`apps/api/src/composition/public-api-document-info.ts`・`apps/api/src/composition/api-worker.ts`_
  - _Requirements: 14.4_

- [ ] 7.3 Swagger UIの束を同一オリジンで遅延読み込みし、E2Eで表示とCSPを確かめる
  - clientで`bun add --exact swagger-ui-dist@<5.33.x>`(公開から2週間以上経った最新の5.33.x)を実行し、`package.json`に`^`・`~`の無い版が書かれ`bun.lock`が更新されたことを確かめる(`coding/002-dependency-versions.md`の「版を明示した追加手順」)。導入先がclientだけのため、同文書の主要パッケージの一覧には加えない。tech-stack.mdの記載は反映済みのため変えない
  - ビューアーで束とスタイルを動的に読み込み、補正した仕様書を渡し、外部の検証サービスを使わず、入力したキーを保存しない設定で描画する。外側の配色を明るく固定する
  - `e2e/client/api-docs.e2e.test.ts`で、`/api-docs`に経路の一覧が表示され、frontend-platformの`e2e/support/security-assertions.ts`でCSPの違反が無く、外部のオリジンへの要求が無いことを確かめる。違反が出たらCSPを緩めずに実装を止めて開発者へ報告する
  - clientのビルドの出力のうち、入口とルートのチャンク(`/api-docs`の遅延読み込みのチャンクを除く)に`swagger-ui-bundle`の内容が含まれないことを検索で確かめる
  - 完了状態: E2Eテストが成功し、clientの`package.json`に`swagger-ui-dist`が完全に固定した5.33.xで入り、他のページの初回のバンドルにSwagger UIの束が含まれない
  - _Depends: 1.5, 5.7, 7.1_
  - _Requirements: 15.1, 15.2, 15.3, 15.7, 17.3_

- [ ] 8. ドキュメント
- [ ] 8.1 (P) 技術ドキュメントを書き、索引と関連文書へ追記する
  - `backend/020-api-key-authentication.md`(APIキーの発行・ハッシュによる保存と照合・平文の1度だけの表示・Bearerと`WWW-Authenticate`・機能と操作の権限スコープ・認証と回数の制限の順序・キーの持ち主単位とIP単位の制限・`X-RateLimit-*`・経路の対象による停止中の持ち主の扱い・退会での削除)と`frontend/019-self-hosted-api-reference.md`(Swagger UIの同一オリジンの配信とCSP)を、本プロジェクト固有の値を含めずに書く
  - `backend/003`に用途の異なる2つ目のRate Limitingの名前空間の規約を、`backend/005`に経路ごとの認証の中間処理・公開データの未ログインの扱い・画像の絶対URLを追記し、`backend`・`frontend`の索引に加える
  - 完了状態: 文書が整形の検査を通り、プロジェクト名と固有の値が含まれないことを検索で確かめる
  - _Depends: 7.3_
  - _Boundary: `docs/GUIDES/tech/backend/020-api-key-authentication.md`・`frontend/019-self-hosted-api-reference.md`・`backend/003`・`backend/005`・`backend/README.md`・`frontend/README.md`_
  - _Requirements: 17.4_

- [ ] 8.2 (P) オンボーディングに本specの固有の値を記録する
  - `docs/onboardings/project-values.md`に、`PUBLIC_API_RATE_LIMITER`の`namespace_id`、apiの`IMAGES_ORIGIN`とclientの`PUBLIC_API_ORIGIN`の3環境の値、APIキーの接頭辞、回数の規則の名前、退会の波及処理の名前を加える
  - 完了状態: 文書が整形の検査を通り、1.4・1.5・2.3・3.3の値と一致する
  - _Depends: 1.4, 1.5, 2.1, 2.3, 3.3_
  - _Boundary: `docs/onboardings/project-values.md`_
  - _Requirements: 13.4, 15.2, 16.4_

- [ ] 9. 検証
- [ ] 9.1 公開APIの補助とE2Eテストでキーの発行から削除までを確かめる
  - `e2e/support/public-api.ts`: 公開APIのオリジン(既定はローカルのapi、環境変数で上書き)の解決と、APIキーを付けた要求の補助を作る
  - `e2e/client/public-api.e2e.test.ts`: identity-authの`e2e/support/mailpit.ts`で確認済みの利用者を登録し(メールアドレスのドメインは`.example`)、product-launchの登録画面でプロダクトを登録し、directory-discoveryの`e2e/support/directory-fixtures.ts`で掲載中にする。`/settings/api-keys`で「プロダクト」読み取り・「プロダクトの説明文」読み書きのキーを発行して平文を控え、プロダクトの詳細の取得が200、自分のプロフィールの取得が403、説明文の更新が200でプロダクト詳細ページの説明文が変わること、キーを再発行すると元のキーと新しいキーの両方でプロダクトの詳細の取得が200になり、元のキーを削除すると元のキーは401・新しいキーは200になることを確かめる。Ultrasの機能フラグで結果が変わる表示は確かめない
  - 完了状態: ローカルでE2Eテストが成功する
  - _Depends: 5.7, 6.5_
  - _Requirements: 17.3_

- [ ] 9.2 全体の検査とカバレッジを確かめ、確定した決定と上流の改訂への依存を報告する
  - 整形の検査・静的解析・型検査と、単体テスト・Workers統合テスト・ブラウザテストを一括で実行し、本specが追加・変更したファイルのカバレッジが80%以上であることを確かめる。ログとSentryへの送信に`Authorization`・平文のキー・説明文とプロフィールの本文が含まれないことを検索で確かめる
  - 仮1〜仮4が2026-10-24に開発者が確定済みで確認待ちの論点が無いこと(仮1・仮2は推奨と異なる案B)、保留中のタスクが無いこと、本specが依存する上流の改訂(api-gatewayの改訂1の`servers`・`info`、backend-platformの改訂1・改訂3の伏せ字、product-launchの仮12)、要件定義書の改訂が必要な箇所(FR-PAPI-003・006・009、research.md)、roadmapの帯の本specの「使用中の値」が「—」である旨を作業の報告に記録する
  - 完了状態: すべての検査とテストが成功し、カバレッジの結果が閾値を満たし、報告に確定した決定と上流の改訂の一覧が載っている
  - _Requirements: 16.2, 17.1, 17.2_
