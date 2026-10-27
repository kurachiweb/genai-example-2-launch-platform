# Implementation Plan

- [x] 1. 基盤: 共通部品のプロジェクト・静的解析・スタイル・ブラウザテスト
- [x] 1.1 共通部品のプロジェクトを作り、品質ツールと実行時の依存を固定した版で導入する
  - 前提: dev-toolingの全タスクが完了し、ブラウザテストのプリセット・テストの命名検査・共有ディレクトリの配置の確認が使えること。無ければ止めて報告する
  - 共通部品のアプリに、スクリプト契約(静的解析・型検査・単体テスト・ブラウザテスト)を定義し、品質ツール6種・`@types/bun`・Reactの型・Vitest Browser Mode一式・`vitest-browser-react`と、実行時の依存(React・TanStack Start・TanStack Query・Jotai・Zod・LogTapeと伏せ字・Sentryの2つ・UIの土台とクラス名の組み立て・アイコン・トースト・React Hook Formと`@hookform/resolvers`・`@marsidev/react-turnstile`・`@graphql-typed-document-node/core`)と、Vite・`@vitejs/plugin-react`・Tailwind CSSを、設計のTechnology Stackの版で完全に固定して導入する
  - 型検査の設定は基底設定を継承せず、基底設定の値を書き写した自己完結の設定にする。先に、基底設定と差分(JSX・lib・types・include)以外で一致することを確かめる単体テストを書き、失敗を確かめてから設定を置く
  - ここで新しく採用したパッケージ(`radix-ui`・`class-variance-authority`・`clsx`・`tailwind-merge`・`lucide-react`・`sonner`・`@vitejs/plugin-react`・`@hookform/resolvers`・`@graphql-typed-document-node/core`・`@marsidev/react-turnstile`)を、導入と同じ変更でtech-stack.mdへ記載する
  - 完了状態: ルートの一括検査で共通部品のアプリが静的解析・型検査・テスト命名の検査に参加して成功し、型検査の設定の一致の単体テストが成功し、ロックファイルの版が設計の表と一致し、tech-stack.mdに10個のパッケージが載っている
  - _Requirements: 15.2, 15.7_

- [x] 1.2 画面向けの静的解析の規則と、クラス名の整列を用意する
  - React・フック・アクセシビリティ・TanStack Query・TanStack Router・Storybookの規則のプラグインと、クラス名を整列する整形のプラグインを、設計の版で共通部品へ導入する
  - 先に、生のHTMLの挿入(危険なHTMLの属性・`innerHTML`・`outerHTML`への代入)と、依存の方向に反するimport(純粋な関数やサーバーの部品からのReact・TanStack・Workers・Sentryの読み込み、画面部品からのサーバー専用ファイルの読み込み)が報告されることを、ESLintのNode APIで確かめる単体テストを書く
  - 3つのアプリが使う規則の組み立てを共通部品に置き、プラグインの型をimportせずに設定の型で受け取る。共通部品の静的解析設定と整形設定に適用する
  - 新規採用の7つのプラグインを、導入と同じ変更でtech-stack.mdへ記載する
  - 完了状態: 違反例の単体テストが成功し、ルートの整形検査が共通部品のファイルにクラス名の整列を適用し、共通部品の静的解析が成功する
  - _Requirements: 4.8, 15.2, 15.7_

- [x] 1.3 デザイントークン・基本のスタイルと、ブラウザテストの設定・アクセシビリティの検査の補助を用意する
  - モックアップのデザイントークン(ライト・ダークの色、ブレークポイント、OSのフォントの並び)を移植し、Tailwind CSSと`tw-animate-css`の取り込み、ダークモードの切替の条件、視差効果を減らす設定での動きの最小化、フォーカスの輪郭を基本のスタイルに置く。Webフォントを読み込まない
  - ブラウザテストの設定でプリセット・成果物の置き場所・共有Chromiumの起動を取り込み、カバレッジの対象を画面部品に絞る
  - 先に、違反を含むテスト用の要素で検査の補助が違反を返し、違反の無い要素で0件を返すブラウザテストを書き、`axe-core`でWCAG 2.2 AAのタグに絞って検査する補助を作る
  - 新規採用の`axe-core`・`tw-animate-css`・`@tailwindcss/vite`を、導入と同じ変更でtech-stack.mdへ記載する
  - 完了状態: 検査の補助のブラウザテストが成功し、テスト用の要素でライト・ダークの文字色と背景色が設計のトークンの値になり、視差効果を減らす設定でアニメーションの時間が最小になることをブラウザテストで確かめられる
  - _Requirements: 7.1, 7.2, 7.7, 7.9, 10.3, 10.7, 15.1, 15.7_

- [x] 2. 純粋な関数(GraphQLの応答・日時・配色・Sentryの除去)
- [x] 2.1 (P) GraphQLの応答の解析・エラーの型・文書の識別子と取得のキーを作る
  - 先に、成功の応答、api-gatewayのエラーコード・メッセージ・項目ごとの詳細を持つ応答、429・503と`Retry-After`、共通のエラー形式の応答(403・429・503)、JSONでない応答、識別子を持たない文書、識別子と変数の組の取得のキーをそれぞれ確かめる単体テストを書く
  - 想定内の失敗(api-gatewayのAppErrorのコード)と想定外の失敗(内部エラー・実行前の拒否・通信の失敗・解釈できない応答)を区別する印をエラーに持たせる
  - 完了状態: 単体テストが成功し、各ファイルの行と関数のカバレッジが80%以上になる
  - _Boundary: GraphqlResult, PersistedDocument_
  - _Requirements: 6.3, 6.6_

- [x] 2.2 (P) 表示設定の型と、日時・相対表現・数値の整形を作る
  - 先に、書式の名前ごとの整形が指定したタイムゾーンとロケールに従いタイムゾーン名を含まないこと、代替の表示設定がUTCと`ja-JP`であること、経過・残り時間の表現(モックアップの文言)、ロケールごとの3桁区切りを確かめる単体テストを書く
  - モックアップの日時の書式と相対表現を移植する
  - 完了状態: 単体テストが成功し、日時の整形結果にUTC-08:00の表記やタイムゾーン名が現れない
  - _Boundary: DisplayPreferences, DateTimeFormats, RelativeTime, NumberFormat_
  - _Requirements: 9.5, 9.6, 9.7, 9.8_

- [x] 2.3 (P) 配色の選択の保存・初回描画前のスクリプト・クラス名の結合・サーバーの項目のエラーの対応付け・疎通確認の画面の公開の判定を作る
  - 先に、保存値があればそれを、無ければOSの配色の設定を使うこと、保存に失敗しても表示を切り替えること、初回描画前のスクリプトの文字列が文書の要素へ配色のクラスと`color-scheme`を設定すること、項目ごとの詳細が対応する欄と対応しない詳細に分かれること、疎通確認の画面がローカルとstagingだけで公開されprodでは公開されないことを確かめる単体テストを書く
  - クラス名の結合は`clsx`と`tailwind-merge`で作る
  - 完了状態: 単体テストが成功し、初回描画前のスクリプトを偽の文書で実行した結果が保存値とOSの設定の両方の場合で期待どおりになる
  - _Boundary: ThemePreference, ServerFieldErrors, ClassNames, SystemStatusAvailability_
  - _Requirements: 7.3, 7.4, 7.5, 7.6, 8.5, 12.4_

- [x] 2.4 (P) Sentryのイベントとスパンから個人情報を除き、想定内の失敗を除外する関数を作る
  - 先に、イベントの利用者・Cookie・本文・クエリ・IPとトークンのヘッダーの除去、パンくずのURLのクエリの除去、想定内の失敗の除外、スパンの要求ヘッダー(許可した3つを除く)・応答ヘッダー・利用者・接続元・クエリの除去を、research.mdに記録した属性の名前で確かめる単体テストを書く
  - 収集を最小にする設定値(利用者の情報・Cookie・本文・クエリ・GraphQLの文書と変数を収集しない)を同じファイルで提供する
  - 完了状態: 単体テストが成功し、Cookie・IPアドレス・メールアドレス・クエリを含む偽のイベントとスパンから、それらの値が1つも残らない
  - _Depends: 2.1_
  - _Boundary: SentryScrub_
  - _Requirements: 2.13, 13.1, 13.3, 13.5_

- [ ] 3. サーバーのエントリの部品
- [x] 3.1 (P) 環境の検証・公開してよい設定値・アプリのプロファイルの型を作る
  - 先に、必要なキーの欠落と不正な値(環境の種類・トレースの割合・オリジンの形式・バインディングの形)を名前の一覧で返すこと、ブラウザへ渡す設定にシークレットや内部の値が含まれないこと、アクセス解析を持たないプロファイルでは解析のトークンを渡さないこと、送信先が無ければSentryを無効として扱えることを確かめる単体テストを書く
  - 呼び出し元の種類・セッションのCookieの名前・検索除外の判定・アクセス解析の有無を持つプロファイルの型を置く
  - 完了状態: 単体テストが成功し、検証の失敗の結果がキーの名前だけを持ち値を含まない
  - _Boundary: FrontendEnv, AppProfile_
  - _Requirements: 1.2, 1.4, 1.6, 2.9, 13.4, 13.6, 13.7_

- [x] 3.2 (P) 接続元IP・ページの要求・サーバー関数の呼び出しの判定と、Worker単位のIP制限の判定を作る
  - 先に、接続元IPのIPv4・IPv6の解釈と不正値の拒否、ページの要求の判定(メソッドと受け付ける形式)、サーバー関数の呼び出しの判定、キーの形式(不明な送信元は1つのキー)、偽のバインディングでの許可と超過(`Retry-After`は10秒)、バインディングの例外時の通過と警告を確かめる単体テストを書く
  - 上限と期間の定数はbackend-platformの規約(10秒あたり100回)と同じ値にする
  - 完了状態: 単体テストが成功し、キーにIPアドレス以外の値(Cookie・経路)が含まれない
  - _Boundary: ClientIp, PageRequest, IpRateLimit_
  - _Requirements: 2.3, 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 3.3 CSRFの判定を作る
  - 先に、`Sec-Fetch-Site`の`same-origin`だけを許し`same-site`・`cross-site`・`none`を拒否すること、ヘッダーが無い場合の`Origin`の一致と不一致、両方の欠落の拒否、`Referer`だけの要求の拒否、GET・HEAD・OPTIONSは検証の対象外で、サーバー関数の呼び出しはメソッドを問わず対象になることを確かめる単体テストを書く
  - 拒否の理由(ヘッダーの欠落・クロスサイト・オリジンの不一致)を結果に持たせる
  - 完了状態: 単体テストが成功し、すべての拒否の結果が理由を1つ持つ
  - _Depends: 3.2_
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 3.4 (P) nonce・許可先の合成・CSP・Permissions-Policy・セキュリティヘッダーを作る
  - 先に、nonceが要求ごとに異なり十分な長さを持つこと、ページのCSPの各ディレクティブ(nonce・既定の許可先・環境ごとの許可先・デプロイ先だけの安全でない通信の格上げ)、許可先の合成と重複の除去、不正な許可先の値の拒否、Permissions-Policyの既定値と登録した許可、全応答への付与・`no-store`・検索除外の指示、ページ以外の応答のCSPを確かめる単体テストを書く
  - HSTS・`X-Content-Type-Options`・`Referrer-Policy`・Permissions-Policyの機能の一覧は、api-gatewayのセキュリティヘッダーと同じ値にする
  - 完了状態: 単体テストが成功し、ページのCSPに`'strict-dynamic'`・`'unsafe-eval'`・`*`が含まれない
  - _Depends: 3.1_
  - _Boundary: Nonce, SecurityPolicy, SecurityHeaders_
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.7_

- [x] 3.5 (P) 共通のエラー形式の応答と静的なエラー画面を作る
  - 先に、コードごとの状態コード・文言・`Retry-After`・`Allow`、共通のエラー形式の本文、静的なエラー画面(429・500)が外部のファイルを読み込まず、レート制限の文言と想定外のエラーの文言を表示することを確かめる単体テストを書く
  - 文言は文言規則の表と設計の定数に合わせる
  - 完了状態: 単体テストが成功し、エラー画面のHTMLにスクリプトと外部の参照が含まれない
  - _Boundary: ErrorResponses_
  - _Requirements: 1.4, 2.11, 2.12, 3.2, 5.3, 5.4, 8.12_

- [x] 3.6 (P) 中継の契約の値・項目の組み立て・セッションのCookieの処理を作る
  - 先に、元のクライアントIP・セッション識別子・bot判定のトークン・トレースの項目・許可したブラウザの項目だけが付き、ブラウザが送ったCookie・呼び出し元・元のクライアントIPを名乗る項目が付かないこと、Cookieの読み取りと形式の検証、利用者側と管理者側のCookieの取り違えが起きないこと、発行・削除の指示の解釈と形式不正の指示の無視、Set-Cookieの属性(`__Host-`・`Secure`・`HttpOnly`・`SameSite=Lax`・`Path=/`・`Domain`なし)、指示の項目と上流の`Set-Cookie`の除去を確かめる単体テストを書く
  - 中継の項目名とセッション識別子の形式は、api-gatewayの契約の値を1つのファイルに置く
  - 完了状態: 単体テストが成功し、ログや例外のメッセージにCookie・トークン・IPの値が出ないことを確かめられる
  - _Boundary: RelayCore_
  - _Requirements: 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.13_

- [x] 3.7 中継の経路の定義と実行を作る
  - 先に、GraphQLの中継の経路の定義、登録した経路の検索と未登録の経路、メソッドの不一致の405と`Allow`、本文の形式の不一致の415、上流の例外の503と時間切れ(15秒)の503、状態コード・本文・`Retry-After`の保持、Cookieの指示の反映を、偽のService Bindingsで確かめる単体テストを書く
  - 後続のspecが経路を追加できるよう、経路の定義(経路・メソッド・上流のパス・受け付ける形式・追加で引き継ぐ項目・待ち時間)を公開する
  - 完了状態: 単体テストが成功し、テスト用に追加した経路がGraphQLと同じ引き継ぎで中継される
  - _Depends: 3.5, 3.6_
  - _Requirements: 2.1, 2.10, 2.11, 2.12, 2.14_

- [ ] 3.8 (P) 要求から表示設定を推定する関数を作る
  - 先に、接続元のタイムゾーンの採用と不正値の除外、言語の設定の優先度順の解釈と対応していないタグの除外、どちらも得られない場合のUTCと`ja-JP`を確かめる単体テストを書く
  - 完了状態: 単体テストが成功し、推定の結果がいつも`Intl`で使えるタイムゾーンとロケールになる
  - _Depends: 2.2_
  - _Boundary: RequestDisplayPreferences_
  - _Requirements: 9.2, 9.5_

- [ ] 3.9 (P) フロントエンドサーバーのログの設定・伏せ字・アクセスログを作る
  - 先に、テスト用の出力先で、ログがbackend-platformと同じ形式のJSONのオブジェクトになること、IPアドレス・メールアドレス・トークン・Cookieの値とフィールドが伏せられること、相関IDが処理の中のログに付くこと、アクセスログの属性(メソッド・クエリを除く経路・状態コード・処理時間・相関ID・結果)を確かめる単体テストを書く
  - 完了状態: 単体テストが成功し、アクセスログにクエリ・Cookie・IPの値が現れない
  - _Boundary: FrontendLogging_
  - _Requirements: 2.13, 3.6, 13.8_

- [ ] 3.10 (P) サーバー側のSentryの初期化オプションを作る
  - 先に、送信先が無い・環境が不正な場合の無効化、環境とトレースの割合、個人情報の既定の送信の無効化、除去の関数と収集の設定の適用、画面操作の録画の統合を含めないことを確かめる単体テストを書く
  - 完了状態: 単体テストが成功し、オプションに録画とフィードバックの統合が含まれない
  - _Depends: 2.4, 3.1_
  - _Boundary: ServerSentryOptions_
  - _Requirements: 13.1, 13.4, 13.5_

- [ ] 3.11 サーバーのエントリで処理の順序を合成する
  - 先に、偽のバインディングと偽のTanStackのハンドラーで、環境の不備の500とキー名だけのログ、IP制限の超過(ページはHTML・他は共通のエラー形式、CSRF・中継・描画を呼ばない)、CSRFの拒否の403と理由のログ、中継の経路への振り分けと未登録の中継の経路の404、描画へ渡す値(nonce・表示設定・公開設定・中継の文脈・Cookieの名前)、ページのCSPに要求のnonceが入ること、全応答のセキュリティヘッダーと`no-store`、stagingと管理者側の検索除外、例外時の500と送信、アクセスログの出力、モジュールの読み込みだけでは環境の検証もログの設定も行われないことを確かめる単体テストを書く
  - 処理の順序は設計の図の1箇所だけで定め、各段階の中身は3.1〜3.9の部品を呼ぶ。Sentryの送信とトレースの項目の取得は、アプリから渡す関数で行う
  - 完了状態: 単体テストが成功し、エントリのファイルが`cloudflare:*`・TanStack・Sentryのパッケージを読み込まない
  - _Depends: 3.1, 3.2, 3.3, 3.4, 3.5, 3.7, 3.8, 3.9_
  - _Requirements: 1.1, 1.4, 1.5, 1.6, 3.2, 3.3, 3.6, 4.1, 4.4, 4.5, 4.7, 5.3, 5.4, 5.6, 9.2, 13.8_

- [ ] 4. TanStack Startとの接続
- [ ] 4.1 TanStackのグローバルのミドルウェア・ルーターのcontext・QueryClientの既定値を作る
  - CSRFのミドルウェアを、サーバー関数の呼び出しまたは状態変更の要求に絞り、`Referer`の代替を無効にして登録し、Sentryのグローバルのミドルウェアを先頭に置く設定を作る
  - 要求ごとのQueryClient・Jotaiのストア・実行時の値(公開設定と表示設定)の入れ物を持つルーターのcontextと、dehydrate・hydrateでの受け渡しを、TanStack Startを読み込まない純粋なファイルに作る。サーバーでのnonceと実行時の値の読み取りは、同型の関数とサーバー専用のファイルに分ける
  - 先に、純粋なファイルについて、再試行の方針(通信の失敗と上流の一時的な障害だけ2回まで、429と想定内の失敗は再試行しない)と既定値(鮮度の保持・ウィンドウのフォーカスでの再取得なし・変更は再試行なし)、実行時の値の入れ物が1回だけ設定でき未設定の読み取りで例外になること、dehydrateとhydrateで同じ値が戻ることを確かめる単体テストを書く
  - 完了状態: 単体テストが成功し、contextを作る関数を2回呼ぶと別々のQueryClientとストアが返る
  - _Depends: 2.1, 3.11_
  - _Requirements: 1.5, 3.3, 3.4, 3.5, 4.1, 6.5, 6.7, 6.8, 9.2, 12.4_

- [ ] 4.2 GraphQLの実行部品と取得の補助を作る
  - サーバー側はページの描画の文脈(中継の文脈とService Bindings)で、項目の組み立てをブラウザからの中継と共通にしてAPIの`POST /graphql`を呼び、Cookieの指示を送り始める前の応答へ反映し、送り始めた後の指示は警告ログを出して捨てる
  - ブラウザ側は`fetch`を注入する純粋な関数で、中継の経路へ識別子と変数だけを送り、bot判定のトークンを項目として付け、通信の失敗を通信の失敗のエラーにする
  - サーバー専用の処理はサーバー専用のファイルに置き、同型の関数のサーバーの分岐からだけ読み込む。取得の補助のキーは2.1の取得のキーを使う
  - 先に、ブラウザ側の送信の形(本文に操作の本文を含まず、トークンの項目が付く)・通信の失敗・応答の解析を、偽の`fetch`で確かめる単体テストを書く
  - 完了状態: 単体テストが成功し、6.5のビルドでTanStackのimport保護の違反が出ない(サーバー専用のimportがブラウザのバンドルに入らない)ことを確かめられる
  - _Depends: 3.6, 4.1_
  - _Requirements: 2.2, 2.5, 2.7, 2.8, 6.3, 6.6_

- [ ] 4.3 想定外の失敗の送信とブラウザ側のSentryの初期化を作る
  - サーバー側はSentryのCloudflare版の送信とエラーログ、ブラウザ側は純粋な送信待ちの列に初期化前の送信を最大10件まで積み、初期化の後に送る。想定内の失敗と同じ例外の2回目は送らない
  - ブラウザ側のSentryは、ルートの部品のマウント後に、注入できる読み込み関数(既定は動的import)で読み込み、送信先・環境・トレースの割合・ルーターのトレース・中継の経路へのトレースの伝搬・除去の関数・収集の設定で初期化し、送信先が無ければ読み込まない。読み込みと送信の失敗は画面に影響させない
  - 先に、送信待ちの列の上限・重複の除外・想定内の除外・初期化後の直接の送信と、送信先が無い場合に読み込まないこと・初期化のオプションの内容を、偽の読み込み関数で確かめる単体テストを書く
  - 完了状態: 単体テストが成功し、6.5のビルドの出力でブラウザ側のSentryのコードがクライアントの主バンドルに含まれないことを確かめられる
  - _Depends: 2.4, 4.1_
  - _Requirements: 11.6, 13.1, 13.2, 13.4, 13.5, 13.10, 14.2_

- [ ] 4.4 (P) アクセス解析の計測スクリプト・消えたスクリプトの再読み込み・ページのheadを作る
  - 先に、トークンがある場合だけ遅延読み込みの計測スクリプトの定義を返すこと、読み込みの失敗の通知で印が無ければ1回だけ再読み込みし印があれば何もしないこと、タイトル・正規のURL・検索除外の指示のhead定義を、偽のイベントと保存先で確かめる単体テストを書く
  - いずれもTanStack Startを読み込まない純粋なファイルにする
  - 完了状態: 単体テストが成功し、再読み込みが連続して2回起きない
  - _Boundary: WebAnalytics, PreloadRecovery, PageHead_
  - _Requirements: 1.7, 4.7, 11.9, 12.5, 13.6, 13.10, 14.2_

- [ ] 5. 共通の画面部品
- [ ] 5.1 shadcn/uiの基本の部品を部分ごとのファイルに分けて移植する
  - モックアップのボタン・入力欄・ラベル・複数行の入力欄・バッジ・スケルトン・スイッチ・ラジオボタンを、1ファイル1コンポーネントに分けて移植し、見た目の種類の定義は別のファイルに置く。固定幅を持たせない
  - 先に、各部品のキーボード操作・無効の状態・フォーカスの表示・検査の補助の違反0件を確かめるブラウザテストを書く
  - 完了状態: ブラウザテストが成功し、各ファイルがReactコンポーネントを1つだけエクスポートする
  - _Depends: 1.3, 2.3_
  - _Requirements: 7.1, 9.9, 10.1, 10.3_

- [ ] 5.2 ダイアログ・シート・メニュー・ポップオーバー・ツールチップ・タブを移植する
  - モックアップの重ねて表示する部品とタブを、部分ごとのファイルに分けて移植する
  - 先に、開いた時のフォーカスの移動と閉じ込め、閉じた時の元の要素への戻り、Escapeで閉じること、タブの矢印キーの操作、検査の補助の違反0件を確かめるブラウザテストを書く
  - 完了状態: ブラウザテストが成功し、各ファイルがReactコンポーネントを1つだけエクスポートする
  - _Depends: 5.1_
  - _Requirements: 10.1, 10.2_

- [ ] 5.3 (P) フォーム部品を作る
  - 検証規則をZodで定義するフォームの用意(最初にフォーカスを外した時に検証し、以降は入力ごとに検証する)、ラベル・説明・エラーを関連付ける欄、エラーの表示、送信ボタン(未入力の必須項目・検証エラー・送信中に無効、送信中の表示)を作る
  - サーバーが返す項目ごとの詳細を欄のエラーにし、最初のエラーの欄へフォーカスを移す
  - 先に、フォーカスを外した時のエラーの表示と入力ごとの再検証、送信ボタンの無効化、二重送信の防止、サーバーの詳細の表示とフォーカス、エラーの文言とアイコンと関連付け、検査の補助の違反0件を確かめるブラウザテストを書く
  - 完了状態: ブラウザテストが成功し、エラーの文言が「です・ます」調で末尾に「。」が付く
  - _Depends: 2.3, 5.1_
  - _Boundary: FormParts_
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.12, 10.6_

- [ ] 5.4 (P) 状態表示・トースト・存在しないページと想定外のエラーの表示を作る
  - ローディング(スケルトン)・空(次の行動への導線)・エラー(再試行と問い合わせへの導線、技術的な詳細なし)・部分的なエラー・縮退運転中の表示と、トーストとその表示の関数、存在しないページと想定外のエラーの表示を作る
  - 先に、各表示の文言・導線・再試行の操作と、トーストの内容が支援技術へ伝わること、検査の補助の違反0件を確かめるブラウザテストを書く
  - 完了状態: ブラウザテストが成功し、文言が文言規則の表と一致する
  - _Depends: 5.1_
  - _Boundary: StateDisplays, Toaster, ErrorViews_
  - _Requirements: 8.6, 8.7, 8.10, 8.12, 11.7_

- [ ] 5.5 (P) 表示設定の提供と、日時・相対表現・数値の部品を作る
  - 表示設定の提供はサーバー側の値で初期化し、マウント後にブラウザの値と異なる場合だけ切り替える。日時は`<time>`要素に`datetime`属性を付け、相対表現は日時と併記してマウント後に定期的に更新する
  - 先に、サーバーの値で描画した直後の表示、ブラウザの値への切り替え、`datetime`属性のUTCのISO形式、相対表現の併記と更新、ロケールの数値の形式を確かめるブラウザテストを書く
  - 完了状態: ブラウザテストが成功し、ブラウザのタイムゾーンがサーバーの値と異なる設定でもハイドレーションの不一致の警告が出ない
  - _Depends: 2.2_
  - _Boundary: DateTimeDisplay_
  - _Requirements: 9.1, 9.3, 9.4, 9.7, 9.8_

- [ ] 5.6 (P) Turnstileのウィジェットとトークンの管理を作る
  - ルーターの実行時の値のサイトキーとnonceでウィジェットを描画し、スクリプトはマウント後に読み込む。成功・期限切れ・失敗の状態と、使ったトークンの再取得を管理する
  - 先に、ウィジェットの部品を差し替えて、成功時のトークンの受け取り、使用後と期限切れの再実行、失敗時の文言の表示を確かめるブラウザテストを書く
  - 完了状態: ブラウザテストが成功し、失敗時に「認証に失敗しました。ページを再読み込みして再度お試しください。」が警告として読み上げられる
  - _Depends: 4.1, 5.1_
  - _Boundary: TurnstileWidget_
  - _Requirements: 2.5, 8.8, 8.9, 14.2_

- [ ] 5.7 疎通確認の結果の表示を作る
  - サーバー側の描画時とブラウザからの再確認の結果を区別し、APIサーバーの時刻・データベースの到達可否・APIサーバーへ到達できない場合を表示する。再確認の操作と処理中の状態を持つ
  - 先に、到達可能・データベースに到達できない・APIに到達できない・再確認中の各表示を確かめるブラウザテストを書く
  - 完了状態: ブラウザテストが成功し、3つの状態の文言が互いに異なる
  - _Depends: 2.1, 5.5_
  - _Requirements: 12.1, 12.2, 12.3_

- [ ] 5.8 文書の外枠・スキップリンク・画面遷移の通知・ダークモードの切替ボタンを作る
  - 文書の外枠は言語を日本語にし、初回描画前の配色のスクリプトをheadに置き、属性の不一致の警告を抑え、スキップリンク・トースト(5.4)・画面遷移の通知・表示設定の提供(5.5)を含め、マウント後にブラウザ側のSentryの初期化と再読み込みの仕組みを呼ぶ
  - 先に、切替ボタンの操作で配色が切り替わり保存されること、保存が無い時にOSの設定に従うこと、ボタンの名前と押下の状態、スキップリンクで本文へ移動すること、画面遷移の後にタイトルが通知されることを確かめるブラウザテストを書く
  - 完了状態: ブラウザテストが成功し、検査の補助の違反が0件になる
  - _Depends: 4.3, 4.4, 5.4, 5.5_
  - _Requirements: 7.3, 7.4, 7.5, 10.1, 10.4, 10.5_

- [ ] 5.9 部品のカタログを用意する
  - Storybookと、TanStackの部品のための枠組み・アクセシビリティの確認の追加機能を共通部品へ導入し、ライト・ダークの切替と固定の表示設定をカタログの全体に適用する
  - 5.1〜5.8の各部品に、主要な状態(既定・ローディング・エラー・無効など)のストーリーを置く
  - 新規採用の`@storybook/addon-a11y`を、導入と同じ変更でtech-stack.mdへ記載する
  - 完了状態: カタログのビルドが成功し、ローカルの起動で全部品のストーリーをライト・ダークで表示でき、カタログの静的解析の規則に違反が無い
  - _Depends: 5.2, 5.3, 5.6, 5.7, 5.8_
  - _Requirements: 8.11, 15.7_

- [ ] 6. 利用者側フロントエンドサーバー
- [ ] 6.1 利用者側のプロジェクト・ビルドと実行環境の設定・静的なファイルのヘッダーを作る
  - 前提: api-gatewayの全タスクが完了し、APIの名前付きエントリポイントが存在すること。無ければ止めて報告する
  - 利用者側のアプリに、スクリプト契約、共通部品と同じ版の実行時の依存、`@tanstack/react-router-ssr-query`・`@cloudflare/vite-plugin` 1.53.0・`wrangler` 4.124.0・Vite・Tailwind CSSのプラグインを導入し、共通部品の配置先を静的解析とテストから外して型検査に含める
  - 先に、Wrangler設定の3環境の実効値(Worker名・APIのService Bindingsと`ClientGateway`・IP制限のバインディングの名前空間と上限・呼び出しログの無効化・Workers Cacheの無効化・互換性日付・必須の変数・staging・prodのシークレット)と、静的なファイルのヘッダーが共通部品の定数と一致し`/assets/*`が長期キャッシュになることを確かめる単体テストを書く
  - Viteの設定でローカル状態の保存先を共通の場所にし、Wrangler設定と静的なファイルのヘッダーを置く。ブラウザテストの設定は、カバレッジの対象を利用者側の画面部品に絞り、共通部品の配置先を除外する
  - 完了状態: 単体テストが成功し、ルートの一括検査に利用者側のアプリが参加して成功する
  - _Requirements: 1.1, 1.2, 1.3, 4.4, 4.6, 5.1, 5.5, 13.9, 15.2_

- [ ] 6.2 利用者側のコード生成の設定と疎通確認の操作を作る
  - 前提: apiのスキーマファイルが生成済みであること
  - `graphql`・GraphQL Code Generatorのcliとclient-presetをapiと同じ版で導入し、apiのスキーマファイルを入力にし、操作の本文を識別子に置き換えた生成物と操作の一覧を、api-gatewayの契約の場所へ出す設定と、生成・検査のスクリプトを置く。疎通確認の操作を定義して生成する
  - 完了状態: 生成の後に検査が成功し、操作を変えて生成しないと検査が失敗し、生成物に操作の本文が含まれず、操作の一覧の識別子が`sha256:`で始まり、apiの許可リストの生成が利用者側の操作を取り込む
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [ ] 6.3 利用者側のサーバーのエントリ・Startの設定・ルーター・登録箇所を作る
  - 利用者側のプロファイル(Cookieの名前・prodだけ検索を許す・アクセス解析あり)、CSPの許可先(Web Analytics)、中継の経路(GraphQLだけ)の登録箇所を置く。先に、登録箇所の既定値を確かめる単体テストを書く
  - サーバーのエントリはSentryのCloudflare版で包んだ共通部品のエントリに、プロファイル・TanStackのハンドラー・登録箇所・送信と伝搬の関数を渡す。Startの設定とルーター(nonce・context・SSR統合・dehydrate・描画の例外の送信・Jotaiの提供)を置く
  - 完了状態: 単体テストと型検査が成功する(ビルドの確認はルートを置く6.5で行う)
  - _Depends: 3.11, 4.1, 4.2, 4.3, 4.4, 6.1_
  - _Requirements: 1.6, 2.1, 2.9, 2.14, 4.2, 4.3, 13.6_

- [ ] 6.4 (P) 利用者側の共通レイアウトと区画の登録箇所を作る
  - モックアップのヘッダー・狭い画面のメニュー・フッターを本番のURL体系で移植し、ヘッダーのログイン中の表示・「ローンチする」の導線・ヘッダー直下の帯・フッターの直前・フッターのヘルプのリンクの区画を登録箇所から描画する。初版は未ログインの導線(ログイン・登録)を置く
  - 先に、ヘッダー(ロゴ・ディレクトリ・ヘルプ・「ローンチする」・ダークモードの切替・ログインと登録)、768px未満のメニュー、フッターのリンク(ヘルプ・利用規約・プライバシーポリシー・法的通知・料金・問い合わせ)、ランドマークと名前付きのナビゲーション、区画へ差し込んだ部品の描画、幅320pxで横スクロールが出ないこと、検査の補助の違反0件を確かめるブラウザテストを書く
  - 完了状態: ブラウザテストが成功し、区画の登録箇所の型を変えずにテスト用の部品を差し込める
  - _Depends: 5.2, 5.8, 6.1_
  - _Boundary: SiteLayout_
  - _Requirements: 7.2, 10.4, 11.1, 11.2, 11.3_

- [ ] 6.5 利用者側のルート・404とエラーの画面・仮のトップページ・疎通確認の画面を作る
  - ルートで実行時の値をloaderから表示設定と公開設定として渡し、headにタイトル・スタイル・アクセス解析のスクリプトを置き、存在しないページ・想定外のエラーの画面を共通レイアウトの中に出し、loaderの例外を送信する
  - トップページの経路に仮のページを置き、疎通確認の画面はloaderでサーバー側の取得を行い、「再確認」でブラウザから中継の経路を経て取得し、2.3の判定でprodでは存在しないページにし、検索除外の指示を付ける
  - 先に、404とエラーの画面の文言と導線を確かめるブラウザテストを書く
  - 完了状態: ブラウザテストが成功し、`vite build`がTanStackのimport保護の違反無く成功し、主バンドルにブラウザ側のSentryのコードが含まれず、ローカルの開発サーバーで存在しないページが404・疎通確認の画面がサーバー側の結果を表示する
  - _Depends: 5.7, 6.2, 6.3, 6.4_
  - _Requirements: 9.2, 11.5, 11.6, 11.8, 11.9, 12.1, 12.2, 12.4, 12.5, 14.1, 14.3, 14.4_

- [ ] 7. 管理者側フロントエンドサーバー
- [ ] 7.1 (P) 管理者側のプロジェクト・ビルドと実行環境の設定・静的なファイルのヘッダーを作る
  - 6.1と同じ手順で、管理者側のWorker名・`AdminGateway`・管理者側の名前空間・アクセス解析のトークンを持たない変数で設定し、ブラウザテストの設定を置く。設定の単体テストを先に書く
  - 完了状態: 単体テストが成功し、ルートの一括検査に管理者側のアプリが参加して成功し、利用者側・api・eventと名前空間が重ならない
  - _Depends: 3.4_
  - _Boundary: admin AppBuildConfig_
  - _Requirements: 1.1, 1.2, 1.3, 4.4, 4.6, 5.1, 5.5, 13.9, 15.2_

- [ ] 7.2 管理者側のコード生成の設定と疎通確認の操作を作る
  - 前提: apiのスキーマファイルが生成済みであること
  - 6.2と同じ設定で、管理者側の疎通確認の操作を生成する
  - 完了状態: 生成と検査が成功し、管理者側の操作の一覧が利用者側の操作を含まず、apiの許可リストの生成が管理者側の操作を取り込む
  - _Requirements: 6.1, 6.2, 6.4_

- [ ] 7.3 管理者側のサーバーのエントリ・Startの設定・ルーター・登録箇所を作る
  - 管理者側のプロファイル(管理者のCookieの名前・常に検索除外・アクセス解析なし)、空のCSPの追加の許可先、GraphQLだけの中継の経路を登録し、6.3と同じ構成でエントリ・Startの設定・ルーターを置く。先に、登録箇所の既定値と、利用者側とCookieの名前が異なることを確かめる単体テストを書く
  - 完了状態: 単体テストと型検査が成功する
  - _Depends: 6.3, 7.1_
  - _Requirements: 1.6, 2.9, 4.3, 4.7, 13.7_

- [ ] 7.4 (P) 管理者側の基本レイアウトと区画の登録箇所を作る
  - サービス名と管理画面であることを示すヘッダー・ダークモードの切替・本文の領域と、メニューとログイン中の表示の区画を作る。初版の区画は空にする
  - 先に、ヘッダーの文言・切替ボタン・ランドマーク・区画へ差し込んだ部品の描画・検査の補助の違反0件を確かめるブラウザテストを書く
  - 完了状態: ブラウザテストが成功し、区画が空の時に空の領域を描画しない
  - _Depends: 5.8, 7.1_
  - _Boundary: AdminLayout_
  - _Requirements: 10.4, 11.4_

- [ ] 7.5 管理者側のルート・404とエラーの画面・仮のトップページ・疎通確認の画面を作る
  - 6.5と同じ構成で、管理者側の基本レイアウトの中に存在しないページ(トップページへの導線)・想定外のエラー・仮のトップページ・疎通確認の画面を置く。アクセス解析のスクリプトは置かない
  - 先に、404とエラーの画面の文言と導線を確かめるブラウザテストを書く
  - 完了状態: ブラウザテストが成功し、`vite build`が成功し、ページにアクセス解析のスクリプトが含まれず、ローカルの開発サーバーで存在しないページが404・疎通確認の画面が管理者側の操作で結果を表示する
  - _Depends: 7.2, 7.3, 7.4_
  - _Requirements: 11.5, 11.6, 11.8, 12.1, 12.4, 13.7_

- [ ] 8. 統合と検証
- [ ] 8.1 ローカル環境で、開発サーバーとビルド後のプレビューの両方の疎通を確かめる
  - APIを先に起動し、マイグレーションの適用と、利用者側・管理者側の生成の後の許可リストの再生成を行ってから、両アプリを開発サーバーで起動して疎通確認の画面と再確認を確かめる
  - 両アプリを`vite build`してプレビューで同じ確認を行い、デプロイ先の環境を指定したビルドの出力の設定がstagingの値(Worker名・APIの接続先・名前空間)になることを確かめる。確認のために起動したプロセスは終了後に止める
  - 完了状態: 両アプリの開発サーバーとプレビューの両方で、疎通確認の画面にAPIの時刻と「到達可能」が表示されて再確認が成功し、手順で見つかった注意点(起動の順序・ポートなど)が9.6で反映する項目として完了報告に列挙されている
  - _Depends: 6.5, 7.5_
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 6.1_

- [ ] 8.2 スモークテストを作る
  - 両アプリの疎通確認の画面で、応答のセキュリティヘッダーとnonce付きのCSP、HTMLの全スクリプトのnonce、APIの時刻と「到達可能」の表示、再確認の成功、CSPの違反が1件も起きないこと、存在しないページの404、クロスサイトを名乗る中継の要求の403、Sentry・アクセス解析・Turnstileのスクリプトが最初の描画を妨げない読み込み方であることを確かめるE2Eテストを書く。ヘッダーの検査とCSPの違反の記録の補助を両方で共用する
  - 完了状態: 8.1の起動状態でE2Eテストが成功し、対象のURLの環境変数を変えるだけでstagingに向けられる
  - _Depends: 8.1_
  - _Requirements: 2.1, 3.2, 4.1, 4.4, 4.5, 11.5, 12.6, 12.7, 14.1, 14.2_

- [ ] 8.3 カバレッジと一括検査を確かめる
  - 共通部品・利用者側・管理者側で、単体テストとブラウザテストをカバレッジ計測付きで実行し、80%に満たないファイルにテストを足す。ルートの一括検査と全種別の一括実行を実行する
  - 完了状態: 3つのアプリのカバレッジ計測付きの実行と、ルートの一括検査・一括実行がすべて成功する
  - _Depends: 8.2_
  - _Requirements: 15.1, 15.2_

- [ ] 9. 技術ドキュメント・サービスの文書・オンボーディング
- [ ] 9.1 (P) フロントエンドサーバーのセキュリティと起動の文書を書く
  - フロントエンドサーバーのセキュリティの文書(処理の順序、中継の経路と項目、Cookieの属性と名前の分け方、経路の追加規約、CSRFの範囲と状態を変えるサーバー関数の`POST`、nonce付きCSPと許可先の登録、セキュリティヘッダー・`no-store`・静的なファイルのヘッダー、検索除外、IP制限の適用、生のHTMLの禁止と例外)を追加する
  - TanStack Startの起動の文書に、独自のサーバーのエントリ、サーバー専用のファイルと同型の関数、別プロセスのWorkerへのService Bindings、デプロイ先の環境のビルド時の指定を追記し、共有ディレクトリの文書に自己完結の型検査設定の理由と検証の結果を追記する。索引の更新は9.6で行う
  - 完了状態: 3つの文書が更新され、プロジェクト名と固有値が含まれない
  - _Depends: 8.2_
  - _Boundary: FrontendSecurityDoc_
  - _Requirements: 15.3, 15.4_

- [ ] 9.2 (P) アクセシビリティ規則と共通化する部品の文書を書く
  - アクセシビリティ規則(キーボード・フォーカス・ランドマーク・スキップリンク・画面遷移の通知・コントラスト・エラーの関連付け・自動検査と手動の確認・視差効果の軽減・演出を持つspecが停止の手段を用意する義務)と、共通化する部品の文書(部品の一覧と使い方、1ファイル1コンポーネントとshadcn/uiの分割、カタログの書き方、翻訳への耐性)を追加する。索引の更新は9.6で行う
  - 完了状態: 2文書が追加され、演出の停止の義務がWCAG 2.2の達成基準2.2.2として明記され、プロジェクト名と固有値が含まれない
  - _Depends: 8.2_
  - _Boundary: AccessibilityDoc, ComponentsDoc_
  - _Requirements: 7.8, 9.9, 15.3, 15.4_

- [ ] 9.3 (P) データ取得とGraphQLのクライアント側と依存の版の文書を書く
  - データ取得の文書(操作の置き場所、取得の補助とloader、既定値と再試行、エラーの型と画面の分岐、Cookieの指示が反映される範囲、要求ごとのストア、サーバーのデータと画面の状態の使い分け、取得の遅い区画のストリーミング、1ページの描画あたりの呼び出し回数の目安)を追加し、GraphQL通信の文書のクライアント側の節を書く
  - 依存の版の文書に、Viteのプラグイン・Wrangler・Workers統合テストの版の組の一括更新と、3アプリで版をそろえるパッケージと、apiとそろえるGraphQLの版を追記する。索引の更新は9.6で行う
  - 完了状態: GraphQL通信の文書のクライアント側の節が見出しだけでなくなり、3つの文書にプロジェクト名と固有値が含まれない
  - _Depends: 8.2_
  - _Boundary: DataFetchingDoc_
  - _Requirements: 6.9, 14.3, 14.4, 15.3, 15.4_

- [ ] 9.4 (P) フロントエンドの観測の文書を書く
  - Sentryの初期化(サーバー・ブラウザの遅延読み込み)、除去の規則と逐次送信のスパンの注意、想定外の失敗の送信の入口、トレースの割合、アクセス解析、アクセスログの文書を追加する。索引の更新は9.6で行う
  - 完了状態: スパンの除去が必要な理由と確認の方法が書かれ、プロジェクト名と固有値が含まれない
  - _Depends: 8.2_
  - _Boundary: ObservabilityDoc_
  - _Requirements: 15.3, 15.4_

- [ ] 9.5 (P) 国際化方針とデザインガイドラインの修正を書く
  - 国際化方針(基準時刻の使いどころと画面に出さない規則、ユーザーのタイムゾーンとロケールでの表示、サーバー側の推定とブラウザでの置き換え、相対表現の併記、メールのUTC表記への参照、ブラウザ翻訳への耐性)を追加する
  - デザイン原則の日時の述語の欠けた箇条を直し、ページ構成の共通ヘッダーの項目にダークモードの切替ボタンと管理者側の基本レイアウトを加え、文言規則に想定外のエラーの画面とCSRFの拒否と中継先の障害の文言を加える。索引の更新は9.6で行う
  - 完了状態: デザイン原則と国際化方針の日時の記述が食い違わず、文言規則の文言が3.5の定数と一致する
  - _Depends: 8.2_
  - _Boundary: ServiceDocs_
  - _Requirements: 15.5, 15.6_

- [ ] 9.6 索引・オンボーディング・固有の値・CLAUDE.mdを更新し、tech-stack.mdの記載を確かめる
  - `frontend`・`coding`の技術ドキュメントの索引と、サービス文書の機能仕様の索引に、9.1〜9.5の文書を加える
  - オンボーディングに、起動の順序(API→利用者側・管理者側)、コード生成と許可リストの再生成、プレビュー、カタログ、スモークテストの手順と、8.1で列挙した注意点を反映する
  - 固有の値の文書に、Worker名・名前空間・Cookieの名前・中継の経路・疎通確認の経路・変数の環境ごとの値・CSPの許可先を記載する
  - CLAUDE.mdの技術規則の参照先に、画面・中継・CSPの登録・データ取得・アクセシビリティの文書を加え、ディレクトリ構成に共通部品のサーバーの部品・Startとの接続・スタイル・設定を加える
  - 本specで導入したパッケージがすべてtech-stack.mdに記載されていることを確かめ、漏れがあれば追記する
  - 完了状態: 索引から9.1〜9.5のすべての文書へ辿れ、手順のとおりに新しい作業ツリーで両アプリとカタログを起動でき、tech-stack.mdに設計のTechnology Stackの新規のパッケージがすべて載っている
  - _Depends: 9.1, 9.2, 9.3, 9.4, 9.5_
  - _Requirements: 15.3, 15.4, 15.7, 15.8_

## Implementation Notes

- 1.1(1.3・5.9・9.1への申し送り): `test:browser`は設定ファイルが無いとexit 1になるため、プリセット・ブラウザモード・Chromiumだけの最小の`vitest.browser.config.ts`を置いた。成果物の置き場所・共有Chromium(`browserOptionsPreset`・`resolveBrowserLaunchOptions`)・カバレッジの対象の絞り込みは1.3で加える。`@tanstack/react-router` 1.170.41を直接宣言した(`@tanstack/react-start` 1.168.60が完全固定する版と同じ)。`@tanstack/react-router-ssr-query`・`graphql`は未導入。`tsconfig.json`の`include`は`**/*.ts`・`**/*.tsx`で、TypeScriptの`**`はドットで始まるディレクトリに一致しないため、5.9で`.storybook/`を明示する。文書の相違: coding/001(59〜61行・94行)は全アプリの`tsconfig.json`が基底設定を`extends`すると定め、スクリプト契約の`test:browser`を「ブラウザテストを持つアプリ」に限るため、9.1で`coding/003`に加えて`coding/001`にも共通部品の例外を書く。
- 1.2(1.3・9.x・infra-deliveryへの申し送り): 設計との相違は次のとおり。規則名は5.23.5で`@eslint-react/dom-no-dangerously-set-innerhtml`(設計は`dom/`区切り)。設計の`Linter.Plugin`はeslintの型に無く、各プラグインの型は`ESLint.Plugin`へ代入できないため、構造的な型`PluginWithConfigs`で受けて推奨設定の形を実行時に検証する。整形のプラグインは文字列で書くとルートのPrettierが`/workspace`から解決して失敗するため、`import.meta.resolve`で共通部品の`node_modules`から解決したパスを渡す(9.xでfrontend/003・coding/001に書く。`apps/frontend-lib/node_modules`が無い環境ではルートの`format:check`が設定の読み込みで失敗するため、CIでは整形検査の前に共通部品の依存を入れる)。`tailwindStylesheet`は`styles/base.css`が無いため未指定で、1.3で`apps/frontend-lib/prettier.config.ts`に`tailwindStylesheet: './styles/base.css'`を加える。フックの規則の重複は、`@eslint-react`の推奨が有効にする同名規則だけ`react-hooks`側を止める(`reactHooksConflictsOf`)。`@eslint-react`のrefs・immutability・globalsは実験的で推奨に無いため`react-hooks`側が担う。purity・set-state-in-effect・exhaustive-depsは`@eslint-react`側でwarnになるが、ルートの一括検査は`--max-warnings=0`。生のHTMLの禁止は`insertAdjacentHTML`と`createElement`の第2引数の`dangerouslySetInnerHTML`も含める(計算したキーの代入・`Object.assign`は検出しない)。Dependency Directionから、共通部品から利用側アプリの`src`へのimportと、`src/composition`→`src/routes`も禁止した。動的`import()`と`start/**`内の別ディレクトリの`*.server.ts`の読み込みは検出しない。
- 1.3(5.x・6.x・7.x・9.xへの申し送り): `styles/base.css`が`@import './tokens.css'`する(設計は各アプリの`src/styles.css`が両方を読み込む)。Prettierの`tailwindStylesheet`がトークンのクラス(`bg-primary`・`xs:`など)を知るためで、各アプリの`src/styles.css`は`base.css`だけを読み込む。ダークの条件は`@custom-variant dark (&:where(.dark, .dark *))`で、`<html class="dark">`自身も一致する。視差効果を減らす設定では`animation-iteration-count: 1 !important`により`animate-spin`などの無限のアニメーションも1回で止まるため、ローディング・送信中の状態は動きに頼らず文言か`aria`属性で示す(5.x・9.2)。CSSのimportの型検査のため`tsconfig.json`の`types`に`vite/client`を加えた。トークンはモックアップの`:root`・`.dark`・`@theme inline`をそのまま移植し、`data-motion`の切替は移植していない。`runAxe`は`test/a11y.ts`にあり、ブラウザテストは共有Chromium(`CHROMIUM_PATH`)で動く。
- 2.1(2.4・3.x・4.x・9.xへの申し送り): `documentIdOf`・`graphqlQueryKey`は設計の`PersistedDocument<unknown, unknown>`ではなくジェネリック(`TypedDocumentNode`の`__apiType`が関数型の欄で、`strictFunctionTypes`の下では具体的な変数型の文書を代入できないため)。設計に無い追加は`DocumentId`型・`createNetworkError(cause)`(状態0の`network_error`、4.2のブラウザ側の通信で使う)・`parseGraphQLResponse`が文字列の本文も受けること。識別子は`^sha256:[0-9a-f]{64}$`で検証し、`data`と`errors`が両方ある応答は失敗、`extensions.code`の無いエラーは`invalid_response`、`Retry-After`は整数秒だけを読む。`expected`がfalseなのは、apiの`GATEWAY_ERROR_CODES`の写し(実行前の拒否10個と`internal_error`。api-gatewayのエラーコードを変えたら見直す)・`upstream_unavailable`・`upstream_timeout`・`network_error`・`invalid_response`で、中継の`csrf_rejected`・`not_found`・`method_not_allowed`・`unsupported_media_type`・`rate_limit_exceeded`とapiの`payload_too_large`はtrue(Error Categoriesの送信「しない」と要件13.1による)。`invalid_response`・`network_error`の文言(「現在ご利用いただけません。時間をおいて再度お試しください。」「通信に失敗しました。時間をおいて再度お試しください。」)は文言規則に無いため9.5で加える。共通部品は`graphql` 16.14.2を型の出どころとしてdevDependenciesに宣言した(宣言しないとBunがpeerとして17.0.2を入れる)。6.1・7.1でclient・adminも同じ版を宣言する。
- 2.2(3.8・5.5・9.5への申し送り): 設計のService Interfaceに無い`supportedTimeZoneOf`・`supportedLocaleOf`・`toDisplayPreferences`を`display-preferences.ts`で公開した(File Structure Planの「検証」に当たり、3.8で使い回す)。タイムゾーンは`Intl.DateTimeFormat`が解決した正規の表記で返す。代替はタイムゾーンとロケールで別々に行い、片方だけ不正ならその片方だけをUTCまたは`ja-JP`にする(3.8もこの解釈にそろえる)。書式と相対表現はモックアップの`lib/date-format.ts`・`lib/relative-time.ts`を文言と境目ごと移植し、30日以上前の経過は`null`(日付で表示する)。文書の相違: デザイン原則(`service/design/001`の15行・83行)は相対表現の例に「明日」を挙げるが、モックアップと設計の文言には無く実装していない(9.5で原則の記述を直すか判断する)。`formatDateTime`・`formatNumber`は呼ぶたびに`Intl`のオブジェクトを作る(5.5で一覧に多数並ぶなら(ロケール・タイムゾーン・書式)ごとの使い回しを検討)。不正な`Date`を渡すと`Intl`が`RangeError`を投げるため、5.5で文字列の入力を変換する時に扱いを決める。
- 2.3(3.1・5.x・9.xへの申し送り): 設計は`AppEnvironment`を`server/entry/app-profile.ts`に定義しつつ`utilities/system/system-status-availability.ts`でも使うが、静的解析は`utilities`→`server`のimportを型も含めて禁止するため、`AppEnvironment`(`'local' | 'staging' | 'prod'`)を`utilities/system/system-status-availability.ts`に定義した。3.1は再定義せずここから読み込む(`app-profile.ts`から再エクスポートしてよい)。設計の型の置き場所は9.xか設計の改訂で直す。`readThemePreference`・`setThemePreference`は`HTMLElement`ではなく構造的な`ThemeRoot`を、`applyServerFieldErrors`は`UseFormReturn<T>`ではなく`Pick<UseFormReturn<T>, 'getValues' | 'setError'>`(`ServerFieldErrorTarget`)を受ける(`useAppForm`の3つの型引数の戻り値も渡せる)。初回描画前のスクリプトは保存キー`ls-theme`を読み、`light`・`dark`以外の保存値と保存先の例外ではOSの設定に従う。サーバーの詳細が欄に対応するのは`form.getValues()`に経路が実在する時だけで、5.3の`useAppForm`は`defaultValues`に全欄を入れる。フォーカスは最初に対応した欄だけに移し(その欄に`ref`が無いと移らない)、同じ欄の2つ目以降の詳細は捨てる。APIの`field`は引数のパスを`.`でつなぐため、`input`を取るmutationでは`input.title`になり、接頭辞は呼び出し側(5.x・各spec)で外す(9.3の文書に書く)。
- 2.4(設計の欠落と3.9・3.10・4.3・9.4への申し送り): 設計のSentryScrubは消す項目の列挙だけで、要件13.3と`infra/004`の「個人情報と秘密情報の除去」(2層目)が求める値の形式の伏せ字が無かったため、親の判断で加えた(設計のSentryScrubの節とFile Structure Planの改訂候補)。伏せ字のパターンは`utilities/observability/redaction-patterns.ts`(`REDACTED`・`REDACTION_PATTERNS`・`redactText`・`redactDeep`)で、backend-libの`core/logging/redaction.ts`の写し(公開APIのキー・Bearer・JWT・メールアドレス・Luhnの検査を通るカード番号・IPv4・IPv6。正規表現に`u`フラグを付けた点だけ違う)。片方を変えたらもう片方も見直す。3.9の`FrontendLogging`は同じパターンを写さず、ここから読み込む。`scrubSentryEvent`はmessage・transaction・例外のtype/value・logentry(循環は`[Circular ~]`)・パンくずのmessageとdata・`request.url`・Refererを伏せ、`scrubSentrySpan`はnameと文字列の属性を伏せる。消すヘッダーは設計の9種にIPの取得に使う12種と`cf-connecting-ipv6`・`cf-pseudo-ipv4`を加えた19種、スパンは非推奨の`http.target`・`http.url`・`http.client_ip`・`net.peer.ip`・`net.sock.peer.addr`も消す。URLのフラグメントとRefererのクエリも除き、`SENTRY_DATA_COLLECTION`はガイドの表に合わせて`genAI`・`databaseQueryData`・`queues`・`stackFrameVariables`も無効にする。値の伏せ字は4組の数字のバージョン表記をIPv4として伏せる(`Chrome/130.0.0.0`のUAや4組の`sentry.release`。backend-libと同じ挙動)。`@logtape/redaction`はモジュールの最上位で`getLogger`を呼び木の揺さぶりで除けず、`redaction-patterns.ts`はブラウザ向けに約20.9KB(gzip約5.8KB)になるため、4.3の`browser-observability.ts`は`sentry-scrub.ts`を静的にimportせずSDKの動的読み込みと一緒に読み込む(要件14.2)。ページの404(`notFound()`)は`onError`を通らず、`/_bff/`の404は2.1で`expected: true`のため、`isExpectedFailure`は404を判定しない。`@sentry/core`は型だけのimportで未宣言(ロックファイルは11.4.0の1件)。設計の`ServerSentryOptions.sendDefaultPii`は11.4.0に無いとbackend-platform 2.6の申し送りにあるため、3.10で確かめる。
- 3.1(6.1・7.1・9.xへの申し送り): `SENTRY_TRACES_SAMPLE_RATE`は10進表記の文字列だけを受け付ける(infra/004・api・eventと同じ)ため、client・adminのWrangler設定でも`"0.1"`のように文字列で書く。`validateFrontendEnv`は欠落と不正を1つの`invalidKeys`(名前順・重複なし・凍結)で返し、環境がオブジェクトでなければ必要なキーをすべて返す(backend-libは欠落と不正を分ける)。設計に無い`FrontendLogLevel`型を公開した(3.9で使う)。バインディングの検証は`fetch`・`limit`が関数かだけで、種類の取り違えは6.1・7.1のWrangler設定の単体テストで確かめる。`IMAGES_ORIGIN`・`WEB_ANALYTICS_TOKEN`・`TURNSTILE_SITE_KEY`は9.6で`project-values.md`に載せる。
- 3.2(3.3・3.11・4.1・9.1への申し送り): `isServerFunctionCall`は、TanStack Startが要求の経路のパーセントエンコードを解除してから`/_serverFn/`を判定する(`/%5FserverFn/abc`もサーバー関数として実行する)のに合わせ、`router-core`の`decodePath`の手順を写した`decodePathname`で解除し、生の経路と解除後の経路のどちらかが接頭辞で始まれば真にする(安全側。解除しないとCSRFの検証を回避できた)。静的解析が`server/**`のテストから`@tanstack/`の実行時importを禁じるため、TanStackの`getNormalizedURL`との一致はリポジトリ外のスクリプトで確かめた(2万件と20万件で見逃し0件)。TanStackの版を上げる時は、`getNormalizedURL`の変換と`isServerFunctionCall`の判定を同様に比べ直す。接頭辞はルーターの`basepath`と`serverFns.base`が既定値である前提。`checkIpRateLimit`は設計に無い必須の第3引数`logger`(`{ warn(message, properties) }`)を受け、3.11は`[caller, 'http', 'rate-limit']`のロガーを渡し、超過時の`warning`ログは3.11で出す。文書の相違(9.1で書く): security/002の「ハッシュ化の対象」はレート制限のキーのIPアドレスを方式を問わずハッシュ化の対象とするが、backend/003のWorker単位のIP制限とbackend-libは生の`ip:<IP>`で、例外とは明記していない(本実装も生のキー)。backend/003はバインディングの例外を500にし`CF-Connecting-IP`を形式検証しないが、本実装は設計どおり例外時は通して警告し、IPv4・IPv6を検証して不正なら`ip:unknown`にする。
- 3.3(3.11・4.1への申し送り): `verifyCsrf`は`Sec-Fetch-Site`があればその値だけで判定し(`same-origin`以外は`cross_site_fetch`)、無ければ`Origin`を`new URL(request.url).origin`と正規化せず完全一致で比べ(`origin_mismatch`)、両方無ければ`missing_headers`。`Referer`は見ない。TanStackの`createCsrfMiddleware`の判定と同じため、4.1は`{ referer: false, filter }`で`origin`と`allowRequestsWithoutOriginCheck`を指定せず、`filter`では`ctx.request.url`から`URL`を作って`requiresCsrfCheck`を呼ぶ。3.11は拒否の理由と経路(クエリを除く)を`[caller, 'http', 'csrf']`の`warning`ログに出し、403 `csrf_rejected`で返す。Bunの`new Request`は大文字小文字の混ざったメソッドを正規化するため、小文字のメソッドの扱いは単体テストで試せない(判定は大文字の`GET`・`HEAD`・`OPTIONS`以外をすべて検証する側に倒れる)。
- 3.4(3.11・6.3・7.3・9.1と後続specへの申し送り): 許可先の形は`'self'`・`https://<小文字のホスト>`(ポート無し)・`http://localhost:<ポート>`だけで、検査は`mergeSecurityPolicySources`と`buildPageContentSecurityPolicy`・`buildPermissionsPolicy`の中で行う。Permissions-Policyの許可先はヘッダーの表記(`self`・`"https://…"`)で受け、未知の機能名は例外。nonceは16バイトのbase64で、形式が不正なら`buildPageContentSecurityPolicy`が例外。`runtimeSecurityPolicySources`は`Pick<ValidatedFrontendEnv, 'IMAGES_ORIGIN' | 'SENTRY_DSN'>`を受け、URLとして読めないDSNは加えない。設計に無い型`PermissionAllowlists`・`PageContentSecurityPolicyInput`を公開した。3.1の`isOrigin`はポート付きのhttpsや`localhost`以外のhttpも通し、`SENTRY_DSN`は文字列であることしか確かめないため、それらは環境の検証を通って許可先の合成で例外になる。3.11は許可先の合成を環境の検証の直後に1回だけ行い(失敗はキー名だけのログと500)、例外の時の応答ではページのCSPを組み立て直さない。3.11はローカルで`upgrade-insecure-requests`を偽にする(真だとローカルの`IMAGES_ORIGIN`の画像が格上げされて読めない)。`BASE_SECURITY_HEADERS`・Permissions-Policyの16機能・`NON_PAGE_CONTENT_SECURITY_POLICY`はbackend-libの`workers/http/security-headers.ts`の値の写しで、テストも写しと比べるため、backend-lib側を変えたらこちらも見直す。`worker-src`・`media-src`は`default-src 'self'`に落ち、`SecurityPolicySources`に`mediaSrc`・`workerSrc`の欄が無いため、`blob:`のワーカーや`IMAGES_ORIGIN`の動画が要るspecは型の変更(Revalidation Triggers)になる。Web Analyticsの2つのドメインは6.3の利用者側の登録箇所で加える。
- 3.5(3.7・3.11・9.5への申し送り): 文言の出どころが無い4コードは、`not_found`・`internal_error`がbackend-libの`core/errors/error-envelope.ts`の文言の写し、`method_not_allowed`・`unsupported_media_type`が`csrf_rejected`の文言(「この操作を受け付けられませんでした。ページを再読み込みして再度お試しください。」)の流用。9.5は作業項目に挙がった3つ(想定外のエラーの画面・CSRFの拒否・中継先の障害)に加え、これら4コードと2.1の`network_error`・`invalid_response`の文言も文言規則に加える。設計のIpRateLimitの節(729行)は`renderStaticErrorPage({ status: 429, message })`と書くがInterfaceに`message`は無く、Interfaceに従った(3.11は`{ status: 429, retryAfterSeconds: 10 }`で呼ぶ)。型は状態とコードの組・405だけ`allow`・429と503だけ`retryAfterSeconds`の共用体で、設計に無い`ERROR_MESSAGES`・`ErrorEnvelopeInput`・`StaticErrorPageInput`を公開した。`retryAfterSeconds`は省略できるため、503の`Retry-After: 5`(要件2.11)は3.7の中継が付ける。静的なエラー画面は`<style>`1つと`color-scheme`のmetaでOSのダークに従い(配色のスクリプトは動かせない)、ページ以外のCSPでは`<style>`が遮断されて既定の見た目になるため、どちらのCSPを付けるかは3.11で決める。色の値は`styles/tokens.css`の写し。設計のErrorResponsesの要件番号に8.12が無い(文書の不整合)。
- 3.6(3.7・4.2・9.xへの申し送り): `readSessionInstruction(upstream, logger)`・`toBrowserResponse(upstream, cookieName, logger)`に設計に無い必須の`logger`(`SessionCookieLogger`、`{ warn(message, properties) }`)を加えた。警告の属性は`reason`(`invalid_token`・`invalid_max_age`・`invalid_clear`・`conflicting_instructions`)だけ。Cookieの名前は`SessionCookieName`(`` `__Host-${string}` ``)で受ける。`relay-contract.ts`はapiの`gateway-headers.ts`・`session-verifier.ts`・`session-access.ts`の値の写しで、設計に無い`GATEWAY_CALLER_HEADERS`・`SESSION_CLEAR_VALUE`・`MAX_SESSION_MAX_AGE_SECONDS`・`RELAY_TRACE_HEADERS`を加えた(api側を変えたら見直す)。指示の解釈は、発行と削除が同時なら削除(警告)、削除は値`1`だけ(他は無視して警告。apiは`1`だけを付けるため、形式不正の指示を無視する規則を優先した)、有効期間は1〜34560000秒(400日)で範囲外は発行を無視する。apiの`assertIssuable`と006・004の表は上限を持たないため、9.1・9.3で006・004に上限を書くか、apiに同じ上限を入れるかを申し送る(要件の有効期間は利用者側90日・管理者側12時間で衝突しない)。同名のCookieは最初の値だけを使う。`buildRelayHeaders`はブラウザの`content-type`・`accept`・`cf-turnstile-response`→`extra`→トレース(`sentry-trace`・`baggage`)→IP・セッション識別子(最後に上書き)の順で、予約名を`extra`で渡すと項目名だけを含む`TypeError`。設計の署名に経路の追加の項目の引数が無いため、3.7は`extraForwardedHeaders`の値をブラウザの要求から取り出して`extra`で渡す。`toBrowserResponse`は新しい`Response`を作り、上流のすべての`Set-Cookie`と指示の3項目を除く。
- 3.7(3.11・6.3・7.3・9.1への申し送り): 設計に無い`defineRelayRoute`を公開し、経路(`/_bff/`の下の完全一致か末尾`/*`の接頭辞)・メソッド(POST・PUT・GET・DELETE)・待ち時間・受け付ける形式(POST・PUTは必須)・追加の項目(小文字、予約名不可)を定義時に検査して凍結する。後続のspecと6.3・7.3の`relay-routes.ts`は`defineRelayRoute`で定義し、`composition.unit.test.ts`で各経路が凍結されていることを確かめる(素のオブジェクトは検査を素通りする)。`findRelayRoute`は正規化済みの`url.pathname`を登録順に比べ、最初に一致した経路を返す(`/*`の経路を先に登録すると完全一致の経路を覆うため、9.1の経路の追加規約に書く)。`/*`の経路は接頭辞そのものに一致しない。`RelayDeps`に必須の`logger`(`[caller, 'relay']`)・`sessionLogger`(`[caller, 'relay', 'session']`)・`reportUnexpected`を加え、`cookieName`は`SessionCookieName`。中継の失敗は`logger.warn`に`{ code, route }`(登録した経路の形)だけを出して`reportUnexpected`で送り、503に`Retry-After: 5`(`UPSTREAM_RETRY_AFTER_SECONDS`)を付ける。本文を受け取るのはPOST・PUTだけ。上流のパスが不正なら上流を呼ぶ前に例外(3.11の500)。`AbortSignal.timeout`の合図は応答の本文の転送にも掛かるため、待ち時間を過ぎたストリームは切れる。テストの共通の偽物は`test/relay-route-fixtures.ts`。
