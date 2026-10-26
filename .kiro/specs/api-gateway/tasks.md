# Implementation Plan

- [ ] 1. 基盤: 依存の導入・環境の種別・内部経路の契約の型・import制限
- [x] 1.1 APIサーバーへGraphQL・OpenAPI関連の依存を固定した版で導入し、環境の種別を設定に加える
  - 前提: backend-platformの全タスクが完了し、api・eventのプロジェクト・Wrangler設定・Workers統合テストの設定が存在すること。無ければ止めて報告する
  - 設計のTechnology Stackの依存(`graphql` 16.14.2・GraphQL Yoga・persisted operationsとintrospection無効化のプラグイン・GraphQL Armor・DataLoader・`@hono/zod-openapi`、開発用にGraphQL Code Generatorのcli・typescript・typescript-resolvers)を、版を完全に固定して導入する
  - 先に、backend-platformのWrangler設定の整合の単体テストへ、環境の種別の変数がルート`local`・staging`staging`・prod`prod`であることの確認を加え、失敗を確かめてから設定と環境の検証スキーマに変数を加え、実行時の型を再生成する
  - 新規採用のtypescript・typescript-resolversを、導入と同じ変更でtech-stack.mdへ記載し、依存の版の一覧に`graphql`・GraphQL Code Generatorのcliを「api・client・adminで版をそろえる」として加える
  - 完了状態: apiのロックファイルの各版が設計の表と一致し、`graphql`の実体が1つだけで、Wrangler設定の整合テスト・型生成の検査・型検査が成功し、tech-stack.mdと依存の版の一覧が更新されている
  - _Requirements: 6.1, 6.3, 14.6_

- [x] 1.2 内部経路の契約の型と、生成コマンドがBunで読み込むファイルのimport制限を用意する
  - 呼び出し元の種類・環境の種別とデプロイ先の判定・中継ヘッダーとセッションの指示ヘッダーの名前を、設計の契約どおりに定数と型で提供する。先にデプロイ先の判定の単体テストを書く
  - 先に、backend-platformの層の規則の単体テストへ、スキーマモジュール・合成・上限・エラーコードの各ファイルと登録箇所から`cloudflare:*`・Sentry・インフラ層を読み込む違反例が報告されることを加え、apiの静的解析設定に禁止importを加える
  - (承認後の改訂2)後の設定の禁止importは同じファイルの層の規則を置き換えるため、追加する規則に合成ルートの禁止も含め直し、対象のファイルから合成ルートを読み込む違反例も報告されることを層の規則の単体テストで確かめる
  - Workers統合テストで`*.graphql?raw`を文字列として読み込むためのモジュール宣言を置く
  - 完了状態: 契約の定数の単体テストと、違反例のimportが報告される層の規則のテストが成功し、apiの静的解析・型検査が成功する
  - _Requirements: 2.4, 3.8, 9.1_

- [ ] 2. 共有コード: セキュリティヘッダーとSentryの除外ヘッダー
- [x] 2.1 (P) 応答へセキュリティヘッダーを付ける部品を共有コードに作る
  - 先に、HSTS・`X-Content-Type-Options`・`Referrer-Policy`・Permissions-Policy・既定のCSPが付くこと、応答が既にCSPを持てば置き換えないこと、ヘッダーが不変の応答も複製して付けられること、Workerのハンドラーを包んだ場合に`fetch`の応答にだけ付くことを確かめるWorkers統合テストを書く
  - 設計の値の表どおりに、応答への付与とWorkerのハンドラーの包みを実装する
  - 完了状態: 共有コードのWorkers統合テストが成功し、包んだハンドラーの`scheduled`・`queue`がそのまま委ねられる
  - _Boundary: SecurityHeaders_
  - _Requirements: 12.1, 12.2, 12.3_

- [x] 2.2 (P) Sentryのイベントから中継ヘッダーを除く
  - 先に、backend-platformのイベントの除去の単体テストへ、元のクライアントIP・セッション識別子・bot判定のトークンのヘッダーが除かれることを加え、失敗を確かめる
  - 除くヘッダーの一覧に3つを加える。関数の形と既存の除去規則は変えない
  - 完了状態: 除去の単体テストが既存の項目を含めて成功する
  - _Boundary: SentryScrubAdditions_
  - _Requirements: 2.2, 3.7_

- [x] 2.3 イベントサーバーの全応答にセキュリティヘッダーを付ける
  - 先に、イベントサーバーのWorkers統合テストへ、ヘルスチェックと未登録の経路の応答にセキュリティヘッダーが付くことを加える
  - イベントサーバーの既定のエクスポートを2.1の包みで包む。Queueのconsumerの経路は変えない
  - 完了状態: イベントサーバーのWorkers統合テストが、Queueからデッドレターまでの既存の項目を含めて成功する
  - _Depends: 2.1_
  - _Requirements: 12.1_

- [ ] 3. 内部経路と外部経路の境界
- [x] 3.1 (P) 呼び出し元の付与・除去・読み取りと、送信元IPアドレスの解決を作る
  - 先に、呼び出し元の上書き、外部経路での呼び出し元と元のクライアントIPのヘッダーの除去、IPv4・IPv6の解釈と不正値の拒否、内部経路では引き継いだIP・外部経路では接続元のIPを返す解決を確かめるWorkers統合テストを書く
  - backend-platformのクライアントIPの解決の型に合わせて実装し、`cf`の情報を保ったまま要求を複製する
  - 完了状態: 外部経路で偽の呼び出し元・IPのヘッダーを付けた要求が内部経路として扱われず、内部経路で欠落・不正なIPが不明として返ることをテストで確かめられる
  - _Boundary: InternalRequest_
  - _Requirements: 1.3, 1.4, 2.1, 2.2, 2.3_

- [x] 3.2 (P) セッションの検証のポートと、常に未ログインとする既定の実装を作る
  - 先に、セッション識別子の形式(32バイトの乱数のbase64url、43文字)の判定と、既定の実装が常に無効を返すことの単体テストを書く
  - 認証済みの主体・未ログイン・発行の指示・検証結果の型、検証のポートと識別子、既定の実装をアプリケーション層に置く
  - 完了状態: 単体テストが成功し、ポートと型がアプリケーション層の外を読み込まない
  - _Boundary: SessionVerifierPort, AnonymousSessionVerifier_
  - _Requirements: 3.3, 3.4_

- [x] 3.3 セッションの検証の呼び出しとCookieの指示を集約する部品を作る
  - 先に、呼び出し元の種類で検証の種類(利用者・管理者)が決まること、形式不正のトークンでは検証を呼ばないこと、最初の参照で1回だけ検証すること、無効の判定で削除の指示、更新と発行で発行の指示が応答ヘッダーに出ること、形式不正の発行値を拒否すること、未ログインで認証を要求すると未認証の共通エラーになることを確かめるWorkers統合テストを書く
  - 処理単位のコンテナから検証のポートを取得し、指示を応答ヘッダーへ反映する関数を実装する。トークンは本文とログに出さない
  - 完了状態: テストが成功し、ログの出力にトークンの値が含まれないことを確かめられる
  - _Depends: 1.2, 3.2_
  - _Requirements: 3.1, 3.2, 3.4, 3.5, 3.6, 3.7_

- [x] 3.4 内部経路だけで受け付ける経路と、内部RESTの登録の仕組みを作る
  - 先に、外部経路の要求が共通のエラー形式の404になり、内部経路の要求は登録した経路に届くこと、内部経路でIPが欠落・不正なら値を含めない警告ログが出ることを確かめるWorkers統合テストを書く
  - 内部経路だけで受け付けるミドルウェアと、`/internal`の下に登録した経路を追加するモジュールの組み立てを実装する
  - 完了状態: テスト用に登録した内部RESTの経路が、内部経路では応答し外部経路では404になる
  - _Requirements: 1.2, 1.6, 2.3_

- [x] 3.5 外部経路の既定のエクスポートと、呼び出し元を固定した名前付きエントリポイントの部品を作る
  - 先に、既定のエクスポートの包みが中継ヘッダーを除いてから内側のハンドラーへ渡すこと、CORSの方針が返すヘッダーを付けること、全応答にセキュリティヘッダーを付けること、エントリポイントのクラスが呼び出し元を付けて内側のハンドラーへ渡すことを、テスト用のハンドラーとCORSの方針で確かめるWorkers統合テストを書く
  - CORSの方針の契約(対象のパスなら付けるヘッダーを返す)を外部経路の側で定義し、外部経路の包みと、呼び出し元ごとのエントリポイントのクラスを作る関数を実装する。RPCのメソッドは持たせない
  - 完了状態: テスト用のハンドラーで、外部経路と内部経路の前処理・後処理がそれぞれ設計どおりになることをテストで確かめられる
  - _Depends: 2.1_
  - _Requirements: 1.1, 1.3, 1.4, 1.5, 12.1_

- [ ] 4. GraphQLのスキーマモジュールの規約と生成
- [x] 4.1 (P) スキーマモジュールの契約・基盤の型定義・日時のスカラー・合成と重複検査・印字を作る
  - 先に、複数モジュールの`Query`・`Mutation`の結合、モジュール名・型・項目(列挙型の値・入力型の項目を含む)の重複での合成エラー、スキーマに無い型・項目のリゾルバでの失敗、日時の出力(エポックミリ秒と日付からUTCのRFC 3339)と不正な入力の拒否、同じ定義から同じ印字結果になることを確かめるWorkers統合テストを書く
  - 基盤の型定義(日時・カーソル型とオフセット型のページング情報)を先頭に置いて合成し、型と項目を名前順に並べて印字する
  - 完了状態: テストが成功し、合成と印字の関数がBunからも読み込める(禁止importが無い)
  - _Boundary: SchemaModule, SchemaComposer, PlatformTypeDefs, DateTimeScalar_
  - _Requirements: 8.1, 8.2, 8.6, 9.2_

- [x] 4.2 (P) 処理単位ごとの関連データの一括読み込みの部品を作る
  - 先に、同じ処理単位で3件の読み込みが1回の一括読み込みになること、別の処理単位の読み込み結果を共有しないこと、件数の上限(既定50)で分割されること、一括読み込みの関数が処理単位のコンテナから依存を取得できることを確かめるWorkers統合テストを書く
  - 一括読み込みの定義と、処理単位ごとに定義から読み込み器を1つ作って使い回す登録表を実装する
  - 完了状態: テストが成功し、一括読み込みの回数をテストで観測できる
  - _Boundary: Loaders_
  - _Requirements: 8.3_

- [x] 4.3 リゾルバに渡すGraphQLの文脈を作る
  - 先に、文脈が呼び出し元・相関ID・クライアントIP・セッションの参照・一括読み込みの登録表を持ち、処理単位のコンテナから依存を取得でき、bot判定の呼び出しが引き継いだトークンとクライアントIPをbackend-platformの検証へ渡すことを確かめるWorkers統合テストを書く
  - 要求ごとの文脈の生成を実装する
  - 完了状態: テスト用の検証の差し替えで、bot判定の成功・失敗がそれぞれ通過・共通エラーになることを確かめられる
  - _Depends: 3.3, 4.2_
  - _Requirements: 3.1, 8.4, 8.7_

- [x] 4.4 リゾルバの引数の検証とページングの補助を作る
  - 先に、引数の検証の失敗が入力不正のエラーコードと引数のパスの詳細になること、カーソルの符号化と不正なカーソルの拒否、次のページの有無と末尾のカーソル、オフセット型の総ページ数、ページングの引数の範囲を確かめるWorkers統合テストを書く
  - 引数の検証の包みと、カーソル型・オフセット型の引数スキーマと結果の組み立てを実装する
  - 完了状態: テストが成功し、包んだリゾルバが生成したリゾルバの型に代入できる
  - _Requirements: 8.5, 8.6_

- [x] 4.5 スキーマファイルの印字とリゾルバの型の生成コマンドを作り、生成物をコミットする
  - スキーマモジュールの登録箇所を作り、疎通確認のモジュールを型定義だけで登録する(リゾルバは4.6で加える)
  - 型生成の設定(入力はスキーマファイル、文脈の型と日時のスカラーの対応)と、登録箇所を合成してスキーマファイルへ印字した後に型生成を起動する生成コマンドを作る
  - 先に、登録箇所から合成した印字結果とコミットしたスキーマファイルが一致することを確かめるWorkers統合テストを書く
  - 完了状態: 生成コマンドを2回実行しても生成物が変わらず、スキーマファイルの一致のテストと型検査が成功する
  - _Depends: 1.2, 4.1_
  - _Requirements: 8.1, 9.1, 9.2, 9.3_

- [x] 4.6 疎通確認のユースケース・データベースの到達確認・リゾルバを作る
  - 先に、ユースケースが時計の値と到達可否を返す単体テストと、データベースに到達できれば真・失敗を差し込めば偽と警告ログになるWorkers統合テストを書く
  - アプリケーション層のユースケースと到達確認のポート、インフラ層の到達確認、ユースケースだけを呼ぶリゾルバを実装し、疎通確認のモジュールにリゾルバを加える
  - 完了状態: テスト用のコンテナで`systemStatus`が時刻とデータベースの到達可否を返し、生成した型でリゾルバの型検査が成功する
  - _Requirements: 8.4, 8.8_

- [ ] 5. GraphQLの実行基盤
- [x] 5.1 (P) クエリの上限と、拒否の種類・エラーコードの分類を作る
  - 先に、深さ9・エイリアス16・コスト5000超・字句1000超・ディレクティブ51の操作がそれぞれの種類のエラーコードに、構文の誤りと存在しない項目がそれぞれのコードに分類されること、上限以内の操作が通ること、デプロイ先の設定では上限値と実測値と項目の候補が応答に出ないことを確かめるWorkers統合テストを書く
  - 上限値の定数、Armorの設定と拒否の種類の記録、エラーコードの型と解析・検証の失敗の分類を実装する
  - 完了状態: テストが成功し、上限とエラーコードのファイルがBunからも読み込める
  - _Boundary: QueryLimits, ErrorCodes_
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.6, 4.7, 4.8, 6.2_

- [x] 5.2 (P) 呼び出し元別の許可リストとpersisted operationsのプラグインを作る
  - 先に、許可リストの形の検証、`documentId`での照会、呼び出し元の一覧だけを照会すること(他方の操作は未登録)、本文だけの要求・識別子なし・未登録がそれぞれのエラーコードと400になること、任意の操作を許す判定が真の要求だけ本文を受け付けること、許可リストの検証が最初の照会で1回だけ行われることを確かめるWorkers統合テストを書く
  - 許可リストの読み込みと照会、`documentId`の抽出、プラグインの組み立てを実装する
  - 完了状態: テストが成功する
  - _Boundary: OperationAllowlist_
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 13.3_

- [x] 5.3 エラーのマスキングと状態コードの方針を作る
  - 先に、共通エラー型の失敗のコード・メッセージ・詳細、回数超過と一時的な障害の429・503と`Retry-After`、想定外の例外の定型の文言とログ・送信の1回の呼び出し、共通エラー型を送信しないこと、実行前の拒否の400、バッチ・変数の型の不一致の要求不正を確かめるWorkers統合テストを書く
  - 実行時のエラーのマスキングと、解析・検証の拒否へコードと400を付けるプラグインを実装する
  - 完了状態: テストが成功し、想定外の例外の内部の詳細が応答に含まれない
  - _Depends: 5.1_
  - _Requirements: 4.5, 7.1, 7.2, 7.3, 7.4, 7.6_

- [x] 5.4 (P) 操作ログとトレースのプラグインを作る
  - 先に、操作名・種類・呼び出し元・結果・エラーコード・状態コード・処理時間を持つ操作ログが1件出ること、変数・セッション識別子・bot判定のトークンが含まれないことを確かめるWorkers統合テストを書く
  - (承認後の改訂2)あわせて、Sentryの送信を差し替えたトランスポートで、ルートのスパンの名前が経路の名前のまま操作名・種類・呼び出し元の属性を持つこと、実行した操作だけに操作名入りの実行の子のスパンがあること、どちらの値もスパンの除去処理を通った後に残ることを確かめるテストを書く。Sentryのhonoの計装が応答の時点でルートのスパンの名前を書き戻すため、ルートのスパンの名前は変えない
  - 操作の記録、プラグイン、操作ログの出力を実装する
  - 完了状態: テストが成功する
  - _Boundary: OperationObservability_
  - _Requirements: 3.7, 13.1, 13.2_

- [x] 5.5 Yogaを組み立て、環境ごとにisolate内で使い回す
  - 先に、テスト用のスキーマモジュールと許可リストで、デプロイ先の設定ではintrospection・GraphiQLが無効で、ローカルの設定ではGraphiQLの要求だけ任意の操作とintrospectionが通り、上限が両方に適用され、バッチ・マルチパートが拒否され、組み立てが最初の要求で1回だけ行われることを確かめるWorkers統合テストを書く
  - 設計の設定とプラグインの順で組み立てる。想定外の例外の送信には、backend-platformのログとSentryを使う
  - 完了状態: テストが成功し、モジュールの読み込みだけでは組み立てが行われない
  - _Depends: 4.1, 4.3, 5.2, 5.3, 5.4_
  - _Requirements: 4.5, 6.1, 6.3, 6.5, 13.3_

- [x] 5.6 GraphQLの経路を作り、受付経路の判定と応答の後処理を行う
  - 先に、内部経路の要求が呼び出し元の許可リストで実行され、デプロイ先の外部経路のGET・POSTが404、ローカルの外部経路がGraphiQLの経路として呼び出し元とセッションを手入力のヘッダーで指定でき、本文1MiB超が413、応答が`no-store`でセッションの指示ヘッダーを持ち、操作ログが出て、GraphiQLの画面の応答だけCSPが置き換わることを確かめるWorkers統合テストを書く
  - 受付経路の判定・本文の上限・要求ごとの範囲の組み立て・後処理を持つモジュールの組み立てを実装する
  - 完了状態: backend-platformのアプリの組み立てにテスト用のモジュールとして載せたGraphQLの経路で、テストが成功する
  - _Depends: 3.4, 5.5_
  - _Requirements: 1.1, 1.2, 1.5, 6.3, 6.4, 6.6, 7.5, 12.3, 13.1_

- [ ] 6. 許可リストの生成と検査のコマンド
- [x] 6.1 操作の本文をスキーマと上限で検証する関数を作る
  - 先に、テスト用のスキーマで、上限を超える操作がそれぞれの種類のコードを返し、構文の誤りと存在しない項目がそれぞれのコードを返し、上限以内の操作が合格する単体テストを書く
  - 5.1の上限とエラーコードの分類を使い、解析と検証だけを行う関数を実装する(実行はしない)
  - 完了状態: 単体テストが成功し、Bunのカバレッジで読み込んだ上限とエラーコードのファイルも80%を満たす
  - _Depends: 5.1_
  - _Requirements: 4.9_

- [x] 6.2 (P) 許可リストを組み立てる純粋な処理と引数の解析を作る
  - 先に、現行と直前の和集合、直前だけの検証失敗の除外と一覧、現行の検証失敗・識別子の形式不正・ハッシュの不一致・同じ識別子の本文の衝突での失敗、キーの順の決まった出力、直前のリリースの引数の有無と値の欠落を確かめる単体テストを書く
  - 組み立て(検証関数を受け取る)、直列化、引数の解析を実装する
  - 完了状態: 単体テストが成功する
  - _Boundary: GraphQLScripts(許可リストの組み立てと引数の解析)_
  - _Requirements: 5.5, 5.6, 5.7, 5.8_

- [x] 6.3 操作の一覧を作業ツリーとGitの履歴から読み、許可リストの生成コマンドを作る
  - 先に、一時的なGitリポジトリで、作業ツリーにファイルが無い場合の空、指定コミットにファイルが無い場合の空、存在しないコミットでの失敗を確かめる単体テストを書く
  - 利用者側・管理者側の操作の一覧の場所の契約、読み出し、生成コマンド(直前のリリースの指定が無ければその旨を表示)を実装し、現行の操作だけで生成した許可リストをコミットする
  - 完了状態: フロントエンドの一覧が無い状態で生成コマンドが空の許可リストを出力し、テスト用の一覧を置くと呼び出し元ごとの許可リストになる
  - _Requirements: 5.6, 5.7, 5.9_

- [x] 6.4 スキーマファイル・リゾルバの型・許可リストの食い違いを検査するコマンドを作る
  - 登録箇所から合成した印字結果とスキーマファイルの比較、型生成の検査、現行だけで生成した許可リストとコミットした許可リストの比較を行い、食い違いがあれば再実行すべき生成コマンドを表示して失敗する
  - (承認後の改訂2)先に、dev-toolingの一括検査の単体テストへ、型生成の検査と型検査の間にアプリだけを対象とする段階「GraphQLの生成物の検査」が入り、検査のスクリプトを持たないアプリは「スクリプト未定義」で飛ばされることを加え、失敗を確かめてから一括検査の段階に加える。スクリプト契約の文書の表・段階の一覧・出力例にも加える
  - 完了状態: 生成直後は成功し、スキーマファイル・型・許可リストのいずれかを手で変えると終了コード1になる。ルートの一括検査でもapiの段階として実行され、一括検査の単体テストが成功する
  - _Depends: 4.5, 6.1, 6.3_
  - _Requirements: 4.9, 9.3, 9.4_

- [ ] 7. 公開RESTの骨格とCORS
- [x] 7.1 (P) 公開APIのアプリ・応答のスキーマ部品・認証方式の宣言を作る
  - 先に、テスト用の経路で、検証の失敗が400と項目ごとの詳細の共通のエラー形式になること、単体・オフセット型・カーソル型の成功応答のスキーマとエラー応答のスキーマがOpenAPI仕様に現れること、Bearer認証の方式を宣言できることを確かめるWorkers統合テストを書く
  - 基準パス・仕様の経路の定数、検証失敗を共通エラー型へ変換するアプリの生成、応答のスキーマ部品、認証方式を実装する
  - 完了状態: テストが成功する
  - _Depends: 1.1_
  - _Boundary: PublicApiApp, Responses_
  - _Requirements: 10.1, 10.4, 10.6, 10.7_

- [x] 7.2 登録済みの経路の表とCORSの方針を作る
  - 先に、パスに対する受け付けるメソッドの算出(パスの変数を含む)、基準パスの下の全応答のCORSのヘッダー、更新系での`Content-Type`、未登録のパスでの`OPTIONS`だけ、`Access-Control-Allow-Credentials`が無いこと、基準パスの外では付けないことを確かめるWorkers統合テストを書く
  - 経路の表と、3.5の契約に従うCORSの方針を実装する(公開RESTの側から外部経路の契約を参照し、逆向きの参照を作らない)
  - 完了状態: テストが成功する
  - _Depends: 3.5_
  - _Boundary: RouteTable, CorsPolicy_
  - _Requirements: 11.1, 11.2, 11.4, 11.5_

- [x] 7.3 公開RESTのモジュールを作り、仕様の配信とプリフライトを提供する
  - 先に、認証なしでOpenAPI 3.1の仕様が返ること、登録した経路が仕様に含まれること、仕様の`servers`が`[{ url: '/v1' }]`であること、登録箇所から仕様書の情報(題名・版・任意の説明)を渡さなければ既定の題名と版になり、渡せばその値になること、プリフライトが204になること、基準パスの下の未登録の経路が404になること、登録が空なら仕様の配信だけが公開されることを確かめるWorkers統合テストを書く
  - 登録された経路の追加・認証方式の登録・仕様の経路(相対のサーバーと、指定または既定の仕様書の情報)・プリフライトの経路を持つモジュールと経路の表の組み立てを実装する
  - 完了状態: backend-platformのアプリの組み立てに載せたモジュールで、テストが成功し、配信された仕様の`servers[0].url`が`/v1`である
  - _Boundary: RestModule_
  - _Requirements: 10.2, 10.3, 10.5, 10.8, 10.9, 10.10, 11.3_

- [ ] 8. APIサーバーへの結線と端から端までの確認
- [x] 8.1 登録箇所・合成・エントリをAPIサーバーへ結線する
  - 公開REST・内部REST・セッションの束縛の登録箇所を作り(初版は空、セッションは既定の実装)、モジュールの登録へセッション・疎通確認の束縛とGraphQL・公開REST・内部RESTのモジュールを加える
  - Workerの組み立て(クライアントIPの解決の差し替え、外部経路の包みとCORSの方針)を合成ルートの1ファイルにまとめ、メインモジュールは既定のエクスポート・2つの名前付きエントリポイント・backend-platformの厳密カウンタのクラスだけをエクスポートする
  - 完了状態: apiの静的解析・型検査・既存のWorkers統合テストが成功する(実際の入口のバンドルは10.1のdry-runで確かめる。承認後の改訂2)
  - _Depends: 3.5, 4.6, 5.6, 6.3, 7.3_
  - _Requirements: 1.6, 3.3, 8.1, 10.2, 13.3_

- [x] 8.2 テスト補助を作り、内部経路・外部経路の端から端までをWorkers統合テストで確かめる
  - 環境と呼び出し元を指定してエントリを呼ぶテスト補助と、`documentId`の要求の組み立てを作る
  - 実際の結線では、名前付きエントリポイント経由の未登録の操作が拒否され(コミットした許可リストはフロントエンドの操作の一覧が無いため空)、ローカル環境の外部経路(GraphiQL)では登録箇所の`systemStatus`が実行できることを確かめる
  - テスト用の許可リストで組み立てたアプリで、名前付きエントリポイント経由の`systemStatus`の実行、利用者側から管理者側の操作の拒否を確かめる
  - デプロイ先環境の外部経路のGraphQL・内部RESTの404、引き継いだIPでのIP制限と偽のIPヘッダーの無視、公開APIの仕様の配信とIP制限の429へのCORSのヘッダー、全応答のセキュリティヘッダーを確かめる
  - 完了状態: 端から端までのWorkers統合テストが、デプロイ先環境とローカル環境の両方の設定で成功する
  - _Requirements: 1.1, 1.2, 1.4, 1.5, 2.1, 2.2, 5.4, 6.3, 6.6, 11.1, 12.1, 14.2_

- [ ] 9. 技術ドキュメントとオンボーディング
- [x] 9.1 (P) GraphQL基盤の技術ドキュメントを追加する
  - 受付経路、上限と算出方法、呼び出し元別の許可リストと現行・直前のリリース、introspection・GraphiQL、エラーの分類と状態コード、スキーマモジュールの規約(合成・重複の禁止・リゾルバに業務ロジックを置かない・一括読み込みと件数の上限・引数の検証・ページングの型と命名・日時のスカラー・bot判定)、生成と検査のコマンド(一括検査の段階を含む)、操作ログ、トレースへの操作名の付け方(ルートのスパンの属性と実行の子のスパン、ルートのスパンの名前を変えない理由)を記載し、索引へ1行追記する
  - 完了状態: バックエンドの索引から文書へ辿れ、記載の規約がテストで確かめた振る舞いと一致し、プロジェクト名と固有値を含まない
  - _Boundary: 技術ドキュメント群(GraphQL基盤の文書)_
  - _Requirements: 7.7, 14.3, 14.5_

- [x] 9.2 (P) 公開RESTの骨格の技術ドキュメントを追加する
  - 基準パスと版、経路の登録、検証失敗の応答、成功応答の形式とページング、認証方式の宣言、OpenAPI仕様の配信(相対のサーバーで基準パスを示す理由と、登録箇所からの仕様書の情報の指定)、CORSの規則とHonoの外で付ける理由を記載し、索引へ1行追記する
  - 完了状態: バックエンドの索引から文書へ辿れ、プロジェクト名と固有値を含まない
  - _Boundary: 技術ドキュメント群(公開RESTの文書)_
  - _Requirements: 14.3, 14.5_

- [x] 9.3 (P) 内部経路とセキュリティヘッダーの技術ドキュメントを追加する
  - 名前付きエントリポイントによる内部認証、呼び出し元の判定、元のクライアントIPの扱い、セッションの受け渡しと指示、内部RESTの追加規約、Hono内の順序とHono外の前処理・後処理の2段、セキュリティヘッダーの値とCSPの置き換え方を記載し、索引へ1行追記する
  - 完了状態: バックエンドの索引から文書へ辿れ、プロジェクト名と固有値を含まない
  - _Boundary: 技術ドキュメント群(内部経路の文書)_
  - _Requirements: 2.4, 3.8, 12.4, 14.3, 14.5_

- [ ] 9.4 (P) GraphQL通信のサーバー側の契約の技術ドキュメントを追加する
  - 要求の形式、中継ヘッダーと指示ヘッダーの一覧、エラーコード表と状態コード、スキーマファイルの場所、操作の一覧の場所・形式・識別子、許可リストの生成とデプロイの順序、直前のリリースの渡し方を記載し、クライアント側の節は見出しだけを置いて、索引へ1行追記する
  - 完了状態: コーディングの索引から文書へ辿れ、frontend-platformが追記する節が用意され、プロジェクト名と固有値を含まない
  - _Boundary: 技術ドキュメント群(GraphQL通信の文書)_
  - _Requirements: 2.4, 3.8, 5.9, 7.7, 9.4, 14.4, 14.5_

- [ ] 9.5 (P) 本プロジェクト固有の値・オンボーディング・CLAUDE.mdの参照先を更新する
  - 本プロジェクト固有の値に、エントリポイント名・経路・ヘッダー名・生成物と操作の一覧の場所・環境の種別の値・ローカルのGraphiQLのURL・OpenAPI仕様の既定の情報と相対のサーバーを記載する
  - オンボーディングに、生成・許可リスト・検査のコマンド、フロントエンドの操作を加えた後の手順、ローカルのGraphiQLの使い方を記載する
  - CLAUDE.mdの「技術規則の参照先」に、スキーマモジュール・公開REST・内部RESTを追加する前の参照先を追記する
  - 完了状態: オンボーディングの手順だけで生成と検査が成功し、技術ドキュメントのプレースホルダーがすべて本プロジェクト固有の値で読み替えられる
  - _Boundary: 技術ドキュメント群(固有値・オンボーディング・CLAUDE.md)_
  - _Requirements: 14.5, 14.7_

- [ ] 10. 検証
- [ ] 10.1 生成・検査・ローカル起動の手順を確かめる
  - オンボーディングの手順で生成コマンド・許可リストの生成・検査コマンドを実行し、生成物が変わらず検査が成功することを確かめる
  - シークレットを実行時に注入してAPIサーバーを起動し、ブラウザからローカルのGraphiQLで`systemStatus`を実行でき、外部経路の公開APIの仕様にCORSとセキュリティヘッダーが付くことを確かめる。シークレットが未登録なら登録手順を報告して止める
  - (承認後の改訂2)デプロイしない`wrangler deploy --dry-run`で一時ディレクトリへ出力し、実際の入口(名前付きエントリポイントとYogaを含む)がバンドルでき、バンドルの大きさがWorkerのサイズの上限に十分収まることを確かめる
  - 完了状態: 確かめた結果(dry-runのバンドルの大きさを含む)が記録され、オンボーディングの手順と実際の動作が一致している
  - _Depends: 9.5_
  - _Requirements: 5.7, 6.3, 9.1, 9.2, 9.3_

- [ ] 10.2 一括検査とカバレッジ80%を満たすことを確かめる
  - ルートの一括検査と、カバレッジ計測付きの単体テスト・Workers統合テストの一括実行を行い、api・eventの全ファイルが行・関数80%以上であることを確かめる
  - backend-platformのスモークテスト(DIの変換経路の確認)とマイグレーションの検出確認が、回帰として引き続き成功することを確かめる
  - 完了状態: 一括検査(GraphQLの生成物の検査の段階を含む)・カバレッジ付きの一括テスト・スモークテスト・マイグレーションの検出確認がすべて成功する
  - _Requirements: 14.1, 14.2_

## Implementation Notes

- 1.1(1.2への申し送り): `apps/api/src/composition/env-schema.ts`は`APP_ENVIRONMENT`の3値を暫定の定数`APP_ENVIRONMENT_VALUES`で持つ。1.2で`gateway-headers.ts`の`APP_ENVIRONMENTS`・`AppEnvironment`へ置き換え、定義を1箇所にする。依存の版の一覧は表に「導入先」の列を持つ形のため、`graphql`・`@graphql-codegen/cli`の導入先は「GraphQLのサーバーとクライアントを持つアプリ」と一般化した。`@escape.tech/graphql-armor-types`(任意の相手依存)は未導入。
- 1.1: Betterleaksが`bun.lock`の`"@inquirer/password": "^…"`(パッケージ名)を`generic-password`として誤検知する。依存を変えて該当行が移動したら`.betterleaksignore`のFingerprintを登録し直す。
- 1.2(10.2への申し送り): Workers統合テストの`coverage.include`は`src/presentation/**`を含むため、Bunで単体テストする`gateway-headers.ts`(後の`query-limits.ts`・`error-codes.ts`も)は、Workers統合テストから関数が呼ばれるまで関数カバレッジが閾値を下回る。後続の3.x・5.xで解消される想定で、10.2で確かめる。
- 1.2(後続への申し送り): Bunが読み込むGraphQLのファイルの禁止importは`src/presentation/graphql/modules/**`の`*.worker.test.ts`にも当たり、`cloudflare:*`を読み込めない。疎通確認のモジュールのテストで`cloudflare:test`が要るならテスト補助経由にするか、規則に`ignores`を加える。合成ルートの禁止のパターンと文言は`config/eslint/backend-layers.ts`から複製している。
- 2.1: `withSecurityHeaders`は既存の`withSentryForScheduledAndQueue`にならい`<E, Q = unknown>`(設計は`<E>`)。ヘッダーが不変の応答は設定時の`TypeError`で検出して`new Response(response.body, response)`で複製する。eventの`test:worker`は`lib/**`を除外しているため、共有コードのWorkers統合テストはapiでだけ実行される。
- 2.2: `backend-lib/core`の単体テストはapiの`test:unit`だけが`lib/**`経由で実行する(ルートは`apps/**`を、eventは`lib/**`を除外)。中継ヘッダーは`docs/GUIDES/tech/infra/004-logging-and-error-tracking.md`の伏せ字の規則に一般的な説明で追記した(本プロジェクトのヘッダー名は9.4・9.5で記載する)。
- 2.3(9.3への申し送り): eventは`createWorkerHandler`の戻り値を一番外側で`withSecurityHeaders`で包む(Honoの経路は`@sentry/hono`がアプリを直接計装するため、外側の包みは例外の捕捉に影響しない)。`docs/GUIDES/tech/backend/002-layered-architecture-on-workers.md`の「エントリが`createWorkerHandler`の結果をそのまま`export default`する」記述を9.3で直す。
- 3.1: `resolveGatewayClientIp`は「`readInternalCaller`が有効な呼び出し元を返せば内部経路」と判定する(設計536行の「ヘッダーがあれば」より厳密で、GraphqlModuleの判定と同じ)。要求の複製は`new Request(request, { headers })`で、本文のストリームは複製へ移る(後続は複製だけを読む)。IPの判定はzodの`z.ipv4()`・`z.ipv6()`で、表記の正規化はしない。
- 3.2: `SESSION_TYPES`は設計のFile Structure Planどおり`session-verifier.ts`に置いた(`docs/GUIDES/tech/backend/002-layered-architecture-on-workers.md`の例は識別子を`application/<domain>/types.ts`に置く)。束縛は8.1の`composition/session.ts`で行う。
- 3.3(設計の補完): リゾルバが先に`issue`・`clear`を指示していれば、検証の結果(無効・更新)から出る指示で上書きしない(「最後の指示が有効」はリゾルバの指示どうしに当てはめる)。発行の値は識別子の形式に加え`maxAgeSeconds`が1以上の整数でなければ`RangeError`(メッセージに値を含めない)。`applySessionInstructions`はプライベートフィールドで指示を取り出すため`createSessionAccess`で作った値だけを受け付ける。未認証の共通エラーは下流spec(identity-auth・admin-foundation・inquiry-chat)の表に合わせ、コード`unauthenticated`・文言「ログインが必要です。」。
- 3.4: 外部経路からの`/internal`は環境を問わず常に`NOT_FOUND_RESPONSE`と同じ404(設計588行とError Categoriesの「デプロイ先環境では404」より、System Flows・要件1.2の記述に合わせた)。IPの欠落・不正の警告は`/internal`の下の未登録のパスでも出る。空文字列のIPヘッダーは`invalid`。内部RESTのモジュール名は`internal-rest`(設計に記載なし)。ログのカテゴリの2番目が層名でない点は、`docs/GUIDES/tech/infra/004-logging-and-error-tracking.md`の`[<アプリ名>, <層>, <モジュール>]`と既存のコード(`http`・`queue`)の間で以前から食い違っている。
- 3.5(8.2・9.3への申し送り): 外部経路の後処理は、セキュリティヘッダー(不変なら複製)→CORSの順(設計586行のCORS→セキュリティヘッダーの順では、不変ヘッダーの応答でCORSの設定が例外になるため)。9.3の文書はこの順で書く。エントリポイントのクラスのテストは直接インスタンス化で行い、Service Binding・`exports`経由は8.2で確かめる。内側の`fetch`が例外を投げるとセキュリティヘッダーは付かないため、Honoの`onError`が常に応答を返すことを8.2で確かめる。
- 4.1(設計の「Modified Files」からの逸脱): `graphql-yoga`の型が`@whatwg-node/fetch`の`/// <reference lib="dom" />`を引き込み、workers-typesの`Request`・`BufferSource`と衝突するため、apiの`tsconfig.json`の`paths`で`@whatwg-node/fetch`を`apps/api/types/whatwg-node-fetch.d.ts`(Workersの型を別名で公開する置き換えの宣言)へ向け、`include`に`types/**/*.ts`を加えた。型が`any`になれば`apps/api/test/types/whatwg-node-fetch-types.ts`で型検査が失敗する。実行時(esbuild・Bun・Vite)は実体へ解決する。`@whatwg-node/fetch`の更新時は置き換えの宣言を見直す。手順は`docs/GUIDES/tech/coding/001-javascript-typescript-conventions.md`に記載。
- 4.1(5.xへの申し送り): 不正な日時の変数では`AppError`が`GraphQLError.originalError.originalError`に、リテラルでは`originalError`に入るため、ErrorPolicyは1段深く見る。出力できない日時は`TypeError`(想定外の例外として扱う)。合成エラーのモジュール名の重複は`module:<name>`、基盤の型定義は予約モジュール`platform`として重複検査に加わる。ルート型は`Query`・`Mutation`だけ。
- 4.2(4.3への申し送り): 登録表は`createLoaderRegistry(scope: LoaderScope): LoaderRegistry`(設計に名前の記載なし)で作り、既定の上限は`DEFAULT_LOADER_MAX_BATCH_SIZE`(50)。`createGraphQLContext`は要求ごとに`createLoaderRegistry({ resolve: (id) => container.get(id) })`で作る。`resolve<T>(identifier: symbol): T`は`@typescript-eslint/no-unnecessary-type-parameters`に当たるため、`app-module.ts`にならい理由のコメント付きで抑制している。
- 4.3(5.5への申し送り): `createGraphQLContext`の引数は、設計の`GatewayRequestScope`(5.5で定義、`observation`を含む)の構造的な部分集合`GraphQLContextScope`(`access`・`container`・`correlationId`・`clientIp`・`session`・`botToken`)。5.5では`GatewayRequestScope`をそのまま渡す(循環importを避けるため`graphql-context.ts`から`gateway-server.ts`を読み込まない)。Yogaは文脈の項目を`Object.assign`で自身の文脈へ複製するため、`resolve`・`assertHuman`は`this`に依存しない。`BotVerifier`は`assertHuman`の呼び出し時に取得する。
- 4.4(4.5・9.1への申し送り): 包んだリゾルバの生成型への代入は、codegenと同じ形の`Resolver`型をテスト内に置いて確かめた。4.5で実際の生成型への代入を確かめる。`validation_error`の詳細の`message`はZodの`issue.message`のため、文言を指定しない規則はZodの既定の英語の文言になる。9.1の文書に「利用者へ出る規則には日本語の文言を必ず指定する」と書く。`invalid_cursor`の文言は「ページの位置の指定が正しくありません。」、全体の文言は「入力内容を確認してください。」。検証は`safeParseAsync`(非同期の規則のため)。`first`・`perPage`の既定値は持たせずドメインが決める。
- 4.5(6.4への申し送り): 設計のDependency Directionの「`scripts/graphql/**`は指定のファイルだけを読み込む」「`src`から`scripts`を読み込まない」を強制する静的解析の規則は、どのタスクにも割り当てられていない(現状は手で守っている)。`scripts/graphql/`の入口がそろう6.4で、`files: ['scripts/graphql/**']`に`cloudflare:*`・`@sentry/*`・`**/infrastructure/**`の禁止と、`src/**`から`**/scripts/**`の禁止を加え、層の規則の単体テストに違反例を足す。graphql-codegenは`#!/usr/bin/env node`でNodeで起動する(Wranglerと同じ扱い。9.xの文書に書く)。
- 4.6(8.1・9.1への申し送り): 疎通確認の実装クラスは`DefaultSystemStatusQuery`(設計はインターフェースと同名だが宣言の結合の規則に当たるため)。8.1で`SYSTEM_TYPES.SystemStatusQuery`→`DefaultSystemStatusQuery`、`SYSTEM_TYPES.DatabaseProbe`→`D1DatabaseProbe`を`MODULES`に束縛する。到達確認の警告ログのカテゴリは`['api', 'infrastructure', 'system']`。Bunで読み込むファイルの禁止import規則から`src/presentation/graphql/modules/**/*.worker.test.ts`だけを外した(Bunは読み込まず、D1のため`cloudflare:*`・infrastructureが要る)。9.1の文書にこの扱いを書く。失敗を差し込むD1の偽物は`test/support/failing-d1.ts`。
- 5.1(5.3への申し送り): 上限の拒否の種類は`WeakMap<GraphQLError, QueryLimitKind>`でエラーオブジェクトに記録するため、ErrorPolicyは包み直す前に`classifyDocumentErrors`で分類する。構文の誤りはgraphqlが種類を持たないため"Syntax Error:"の接頭辞で判別し、Armorも同じ接頭辞を使うため記録した種類を先に見る(記録の無い将来のArmorの上限は`graphql_parse_failed`になる)。`@escape.tech/graphql-armor-types`はArmorの下位パッケージの任意依存として推移的に入っており、直接は読み込まない。テスト補助`test/support/query-limit-harness.ts`はBunにも読み込まれるため、Bunのカバレッジの閾値(ファイルごと)を満たすよう全関数をBunのテストで通す。
- 5.2(5.3・5.6への申し送り): persisted operationsの拒否(`persisted_operation_required`・`persisted_operation_not_found`、400)は`path`も原因も持たない`GraphQLError`として`maskError`に届く。設計862行の「`path`も原因も持たない→`graphql_request_invalid`」をそのまま適用すると上書きされるため、5.3では既知の`GatewayErrorCode`を持つエラーを残す規則を先に置く。プラグインは呼び出し元を`x-internal-caller`から、無ければ任意の操作を許す時(ローカルのGraphiQL)だけ`x-debug-caller`(既定`client`)から決め、どちらでもなければ照会せず`persisted_operation_not_found`にする(フェイルクローズ)。5.6はこの規則を重複させず共有する。許可リストの検証は最初の`find`で1回(失敗は記憶しない)。拒否のエラーは要求ごとに作る。文言は「登録済みの操作の識別子(documentId)を指定してください。」「登録されていない操作です。」。
- 5.3(設計の補完と5.5・9.1への申し送り): 拒否のコード(persisted operations・構文・上限)を残すのは`path`も`originalError`も持たないエラーだけで、`path`付きのエラーや外から付けた`internal_error`は想定外として伏せる。伏せ済みの判定はポリシーが作ったエラーの`WeakSet`だけで行う。Armorの深さ・コスト・エイリアス・ディレクティブの拒否は検証中に投げられ`maskError`に届く。Yogaの`usePreventMutationViaGET`が構文エラーの`http.spec`を真にするため、`spec: false`の400として作り直す。GETのmutationの405もYogaの要求エラーとして`graphql_request_invalid`の400になる。不正な日時の変数は`validation_error`の200、リテラルは`graphql_validation_failed`の400。5.5では、Yoga自身のloggerがマスク時に生の例外を出力するため`logging: false`か伏せ字のloggerにする。9.1の文書に「利用者に見せられない内部の詳細は`GraphQLError`ではなく通常の例外か`AppError`で投げる」と書く(`path`の無い`GraphQLError`の文言はそのまま応答に出るため)。`error-codes.ts`はコードの一覧`GATEWAY_ERROR_CODES`から型を作る。
- 5.4(設計の補完と5.5・5.6・9.1への申し送り): 操作ログはエラーコードがあるか状態コードが400以上なら`outcome: error`・`warning`(コードの無い415・413を成功として記録しないため)。不明の操作名・種類は`null`、エラーコードは重複を除く。Yogaのサーバー文脈は`{ scope }`の形(`OperationObservabilityContext`は`GatewayRequestScope`の部分集合)で、5.5で`{ scope: GatewayRequestScope }`を渡し、5.6で`logOperation`を呼ぶ。5.5では同じYogaのインスタンスへ2回要求し、解析・検証のキャッシュが当たっても操作名が記録されることを確かめる。Yogaが結果処理の前に返す応答(415・GraphiQLのHTML)と5.6のモジュールが返す404・413はルートのスパンの属性が付かない(5.6で扱いを決める)。
- 5.5(設計の改訂候補と5.6・9.1への申し送り): 要件6.3・11.5に合わせ、設計から次を変えた。`useDisableIntrospection`は全環境に適用し、ローカルのGraphiQLの要求(内部の呼び出し元ヘッダーが無い要求)だけ通す(設計は「デプロイ先環境だけ」)。`graphiql`はローカルのGraphiQLの要求だけ真(設計は「ローカル環境だけ真」)。Yogaの既定のCORS(任意のOriginを資格情報付きで反射)を`cors: false`で無効にする。`logging: false`。想定外の例外のログのカテゴリは`['api', 'graphql', 'error']`(設計のMonitoringに無い)。`getGatewayServer`は環境だけをキーにisolate内で使い回し、2回目以降の`options`を無視するため、5.6のテストは同じファイル内でスキーマモジュールと許可リストをそろえる。テスト補助`test/support/observability-recording.ts`を追加した(`operation-observability.worker.test.ts`に同じ補助の重複が残る)。1.2の`gateway-headers.ts`の関数カバレッジ不足は解消した。
- 5.6(設計の補完と8.x・9.1・10.1への申し送り): 受付経路は「内部の呼び出し元ヘッダー→ローカルのGraphiQLの要求(`isGraphiqlRequest`を共有)→未登録の経路と同じ404」の順で、404は本文の上限の413より先。413は`AppError`に種類が無いためモジュールで共通のエラー形式を作る(コード`payload_too_large`、文言「リクエストの本文が大きすぎます。」)。本文の上限はHonoの`bodyLimit`で、長さのヘッダーがあればその値を信頼する(区切りは実行基盤が強制する前提)。外部経路の404は経路を隠すため操作ログ・ルートのスパンの属性を出さず、413は操作ログだけ出す。Honoの`c.res`のsetterは古い応答のヘッダーを新しい応答へ書き戻すため、後処理では`c.res = undefined`の後に代入する(YogaのSSEの`Cache-Control: no-cache`で`no-store`が戻るのを防ぐ。SSEは受け付ける)。GraphiQLの画面のCSPはYoga 5.24.6の内蔵HTMLに合わせ、unpkgのスクリプト・スタイル・フォント・接続と`'unsafe-inline'`・`worker-src blob:`を許す(faviconは遮断)。ブラウザでの表示とMonacoの`'unsafe-eval'`の要否は10.1で確かめる。テストは`test/support/graphql-module-harness.ts`と`graphql-module.worker.test.ts`・`graphql-module.response.worker.test.ts`に分けた。
- 6.1(設計の改訂候補と6.4への申し送り): 検証関数は設計どおり上限のプラグインだけのYogaで解析・検証するため、introspection(`__schema`・`__type`)、1つの文書に複数の操作、`Subscription`型の無い`subscription`も合格する。実行時はintrospectionが無効(5.5)なので、許可リストに入っても`graphql_validation_failed`で拒否される。破壊的変更の検出の目的からは、graphqlの`NoSchemaIntrospectionCustomRule`などを加えて実行時と合わせるのが筋だが、設計の範囲外のため加えていない(人の判断待ち)。上限を複数超えた操作は最初の1つのコードだけを返す。テストは`test/support/query-limit-harness.ts`を読み込むため、6.4の`scripts/graphql/**`の読み込み制限ではテストファイルの扱いを決める。
- 6.2(設計の改訂候補と6.3・6.4への申し送り): 設計1404行の「キーを整列した」は、Logical Data Modelの例と既存のfixtureに合わせ`version`→`operations`の順を固定し、呼び出し元と識別子だけ辞書順にした。設計136行の読み込みの許可一覧に無い`operation-allowlist.ts`を、設計自身の`AllowlistData`の参照に従い`import type`で読み込む(6.4の規則で型だけの読み込みを許す)。識別子の正規表現は`operation-allowlist.ts`と重複定義。`PersistedDocuments`・`PersistedDocumentsByCaller`は`allowlist-builder.ts`で定義し、6.3の`allowlist-sources.ts`はここから読み込む。識別子の形式とハッシュの照合は直前の一覧にも当てる。`--previous-ref`はハイフンで始まる値・未知のオプション・位置引数を拒否する。6.3でGitを呼ぶ時はシェルを介さず起動し、可能なら`git rev-parse --verify --end-of-options <ref>^{commit}`でも確かめる。
- 6.3(infra-deliveryへの申し送り): 操作の一覧の場所は`apps/client`・`apps/admin`の`src/graphql/generated/persisted-documents.json`(frontend-platformの設計と一致)。Gitの読み出しは`git ls-tree --format`を使うためGit 2.36以上が必要(開発コンテナは2.47.3)。Gitは呼び出し元の環境を引き継ぐため、`GIT_DIR`などが設定された状態(フックの中など)で単体テストや生成コマンドを動かすと別のリポジトリを読む。CIを作る時に、`GIT_DIR`・`GIT_WORK_TREE`・`GIT_INDEX_FILE`などを除いて起動するか判断する(既存の`test-support/git-ignore.ts`も同じ)。
- 6.4: 比較と表示は純粋関数の`scripts/graphql/generated-check.ts`(設計のFile Structure Planに無い)に置き、`describeBuildError`を`allowlist-builder.ts`へ移して2つの入口で共有した。`graphql-codegen --check`はスキーマファイルと比べるため、スキーマが古い時はスキーマの比較が検出する。codegenの設定の誤りなども「型の食い違い」と表示される(codegenのエラー出力は出る)。静的解析は、`scripts/graphql/**`に`cloudflare:*`・`@sentry/*`・infrastructureと設計136行の一覧に無い`src`のファイルの読み込みを禁止し(`operation-allowlist.ts`は型だけ可、`test/support`は可)、`src/**`から`**/scripts/**`を禁止する(`@typescript-eslint/no-restricted-imports`を使い、層の規則の`no-restricted-imports`のオプションを置き換えない)。dev-toolingの設計(738行付近)の`check`の段階の一覧に`graphql:check`はまだ無い(api-gatewayの変更対象外のため人の判断待ち)。
- 7.1(設計の補完と7.3・8.2・9.2への申し送り): `@hono/zod-openapi`・`@hono/zod-validator`は本文の解析失敗とContent-Typeの不一致でHonoの`HTTPException`(400・415)を投げ、基盤の`onError`が想定外(500・Sentry送信)として扱うため、公開APIのアプリの`onError`で`AppError`に変えて再送出する(応答を返すと`c.error`が`HTTPException`のまま残るため)。400は`validation_error`(詳細`field: ''`・`code: invalid_json`)、415は`AppErrorStatus`に415が無いため`unsupported_media_type`の400(415で返すにはbackend-platformの`AppError`に種類の追加が要る。人の判断待ち)。公開RESTの本文はJSONだけの前提で、`HTTPException`の400はすべて`invalid_json`とみなす。設計に無い`registerApiKeySecurityScheme(api)`を加えた(7.3の`createRestModule`で呼ぶ)。`toFieldErrorDetails`と文言はGraphQLの`validated-args.ts`と重複している(統合の候補)。RESTのページングはsnake_caseの`meta`。Sentryへ送られないことは外側の`c.error`で確かめた(7.3・8.2で`createWorkerApp`に組み込んだ状態でも確かめる)。
- 7.2(7.3・9.2への申し送り): 経路の表は`createRouteTable`を呼んだ時点の`openAPIRegistry`の経路と仕様の経路から作るため、7.3は全経路の登録後に作る。`{name}`は`/`を含まない空でない1セグメントに一致し、それ以外は文字どおり(末尾スラッシュの正規化なし)。`hide: true`の経路と素の`api.get`の経路は表に入らず、ブラウザからのプリフライトが`OPTIONS`だけになる(9.2の文書に「ブラウザから呼ぶ経路に`hide`を使わない」と書く)。Honoとの差は、固定のセグメントの百分率符号化と1セグメント内の複数の変数(`{a}.{b}`)だけで、どちらもCORSが狭くなる側。
- 7.3(8.2・9.2への申し送り): 公開RESTのモジュール名は`public-rest`(設計に記載なし、`internal-rest`にならった)。`@hono/zod-openapi`の`doc31`は仕様を要求ごとに作り、生成に失敗すると例外をそのまま`c.json(e, 500)`で返す(共通のエラー形式・Sentryを通らない)。8.2の端から端までのテストで仕様の配信を確かめ、9.2の文書に「経路を追加したら仕様の取得をテストする」と書く。仕様は子の`OpenAPIHono`の登録だけから作られ、内部経路・GraphQLは載らない。
- 8.1(設計からの逸脱と8.2・9.3・10.1への申し送り): 設計1441行は`MODULES`へ公開RESTのモジュールを加えるが、`createRestModule<Env>(REST_ROUTES)`は`composition/api-worker.ts`で1回だけ作り、`createWorkerApp`へ`[...MODULES, rest.module]`で渡す(`MODULES`は公開RESTを含まない)。アプリに登録するインスタンスと、public-apiのtasks.md 7.2が`api-worker.ts`で`{ info }`を渡すインスタンス・CORSの経路の表を同じにするため。public-restはinternal-restの後に登録される(パスが重ならず振る舞いは同じ)。登録箇所の型は`ApiEnv`ではなく`Env`(Honoの型引数の不変性)。疎通確認の束縛は`modules.ts`の`systemModule`。`wrangler.jsonc`は変更なし(名前付きエントリポイントは呼び出し側のService Bindingで指定)。`wrangler deploy --dry-run`は権限設定で拒否されたため、実際の入口のバンドルは10.1で確かめる。9.3で`docs/GUIDES/tech/backend/002-layered-architecture-on-workers.md`の合成ルートの記述(組み立ては`composition/api-worker.ts`、`index.ts`はエクスポートだけ)と登録箇所の表(`rest-routes.ts`・`internal-routes.ts`・`session.ts`・`graphql-modules.ts`)を直す。実際の結線でのCORS・中継ヘッダーの除去・クライアントIPの解決の差し替えは8.2で確かめる。
- 8.2: 端から端までのテストは`src/index.gateway.worker.test.ts`(実際の結線)と`src/index.allowlist.worker.test.ts`(テスト用の許可リスト。`getGatewayServer`がisolate内で使い回されるため別ファイル)。環境を上書きする時の`callInternal`は設計どおり`apiHandler`へ`markInternalRequest`・`applySecurityHeaders`を当てて呼ぶ(エントリポイントのクラスはローカルの`exports`経由と`createGatewayEntrypointClass`で作るクラスで確かめる)。実際の結線は許可リストが空のため、呼び出し元の偽装の上書き(1.4)はテスト用の許可リストのアプリで確かめた。`REST_ROUTES`・`INTERNAL_ROUTES`が空のため、実際の結線での入力の誤りのSentry非送信と`/internal`の偽装は確かめられず、7.3・3.4の単体で確かめている(下流specが経路を加えた時にテストを足す)。実際の結線は各要求の始めにLogTapeの出力を`console`へ戻すため、ログはconsoleのスパイで捕まえる。
- 9.1(9.4・9.5への申し送り): `docs/GUIDES/tech/backend/004-graphql-server.md`はエラーコードの全表を持つため、9.4の文書は重複させずリンクする。9.5の`project-values.md`に、プレースホルダー`<GraphQLの経路>`・`<GraphQLの本文の上限>`・`<一括読み込みの件数の既定値>`の値と、文書中の「アプリ」(`src/presentation/graphql/`などのアプリ内のパス)が`apps/api`であることを載せる。`Subscription`型の無いスキーマへの`subscription`と、`operationName`の無い複数操作の文書が実行時に`graphql_request_invalid`の400になることは、使い捨てのスクリプトで確かめただけでコミット済みのテストは無い。
- 9.2(9.5への申し送り): `docs/GUIDES/tech/backend/005-public-rest-api.md`のプレースホルダー`<公開RESTの基準パス>`・`<仕様の経路>`・`<仕様書の既定の情報>`の値を`project-values.md`に載せる。合成ルートのファイル名は固有値として書かず「Workerの入口を組み立てる合成ルートのファイル」と書いた(9.3で002を直す時も揃える)。
- 9.3(人の判断待ちと9.5への申し送り): 内部RESTにはGraphQLのような共通の後処理が無く、経路が`AppError`を投げて終えるとセッションの指示(無効と判定したセッションの削除を含む)が応答に載らない(`006-internal-gateway.md`に注意として記載。共通の後処理を設けるかは人の判断待ち)。9.5の`project-values.md`に、`006`のプレースホルダー(利用者側・管理者側のエントリポイント名、内部RESTの接頭辞、呼び出し元・元のクライアントIP・セッション識別子・bot判定のトークン・デバッグ用の呼び出し元・セッションの発行・有効期間・削除の各ヘッダー、APIサーバーのWorker名)の値、「Workerの入口を組み立てる合成ルートのファイル」が`apps/api/src/composition/api-worker.ts`であること、`CALLER_KINDS`の値を載せる。`<バインディング名>`は呼び出し側(frontend-platform)が決める値。`006`のGraphiQLのCSPの表にはYoga内蔵の画面が読み込むCDNのホストが書かれているため、Yogaの更新時に見直す。
