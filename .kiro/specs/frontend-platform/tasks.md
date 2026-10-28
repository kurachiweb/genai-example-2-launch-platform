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

- [x] 3. サーバーのエントリの部品
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

- [x] 3.8 (P) 要求から表示設定を推定する関数を作る
  - 先に、接続元のタイムゾーンの採用と不正値の除外、言語の設定の優先度順の解釈と対応していないタグの除外、どちらも得られない場合のUTCと`ja-JP`を確かめる単体テストを書く
  - 完了状態: 単体テストが成功し、推定の結果がいつも`Intl`で使えるタイムゾーンとロケールになる
  - _Depends: 2.2_
  - _Boundary: RequestDisplayPreferences_
  - _Requirements: 9.2, 9.5_

- [x] 3.9 (P) フロントエンドサーバーのログの設定・伏せ字・アクセスログを作る
  - 先に、テスト用の出力先で、ログがbackend-platformと同じ形式のJSONのオブジェクトになること、IPアドレス・メールアドレス・トークン・Cookieの値とフィールドが伏せられること、相関IDが処理の中のログに付くこと、アクセスログの属性(メソッド・クエリを除く経路・状態コード・処理時間・相関ID・結果)を確かめる単体テストを書く
  - 完了状態: 単体テストが成功し、アクセスログにクエリ・Cookie・IPの値が現れない
  - _Boundary: FrontendLogging_
  - _Requirements: 2.13, 3.6, 13.8_

- [x] 3.10 (P) サーバー側のSentryの初期化オプションを作る
  - 先に、送信先が無い・環境が不正な場合の無効化、環境とトレースの割合、個人情報の既定の送信の無効化、除去の関数と収集の設定の適用、画面操作の録画の統合を含めないことを確かめる単体テストを書く
  - 完了状態: 単体テストが成功し、オプションに録画とフィードバックの統合が含まれない
  - _Depends: 2.4, 3.1_
  - _Boundary: ServerSentryOptions_
  - _Requirements: 13.1, 13.4, 13.5_

- [x] 3.11 サーバーのエントリで処理の順序を合成する
  - 先に、偽のバインディングと偽のTanStackのハンドラーで、環境の不備の500とキー名だけのログ、IP制限の超過(ページはHTML・他は共通のエラー形式、CSRF・中継・描画を呼ばない)、CSRFの拒否の403と理由のログ、中継の経路への振り分けと未登録の中継の経路の404、描画へ渡す値(nonce・表示設定・公開設定・中継の文脈・Cookieの名前)、ページのCSPに要求のnonceが入ること、全応答のセキュリティヘッダーと`no-store`、stagingと管理者側の検索除外、例外時の500と送信、アクセスログの出力、モジュールの読み込みだけでは環境の検証もログの設定も行われないことを確かめる単体テストを書く
  - 処理の順序は設計の図の1箇所だけで定め、各段階の中身は3.1〜3.9の部品を呼ぶ。Sentryの送信とトレースの項目の取得は、アプリから渡す関数で行う
  - 完了状態: 単体テストが成功し、エントリのファイルが`cloudflare:*`・TanStack・Sentryのパッケージを読み込まない
  - _Depends: 3.1, 3.2, 3.3, 3.4, 3.5, 3.7, 3.8, 3.9_
  - _Requirements: 1.1, 1.4, 1.5, 1.6, 3.2, 3.3, 3.6, 4.1, 4.4, 4.5, 4.7, 5.3, 5.4, 5.6, 9.2, 13.8_

- [x] 4. TanStack Startとの接続
- [x] 4.1 TanStackのグローバルのミドルウェア・ルーターのcontext・QueryClientの既定値を作る
  - CSRFのミドルウェアを、サーバー関数の呼び出しまたは状態変更の要求に絞り、`Referer`の代替を無効にして登録し、Sentryのグローバルのミドルウェアを先頭に置く設定を作る
  - 要求ごとのQueryClient・Jotaiのストア・実行時の値(公開設定と表示設定)の入れ物を持つルーターのcontextと、dehydrate・hydrateでの受け渡しを、TanStack Startを読み込まない純粋なファイルに作る。サーバーでのnonceと実行時の値の読み取りは、同型の関数とサーバー専用のファイルに分ける
  - 先に、純粋なファイルについて、再試行の方針(通信の失敗と上流の一時的な障害だけ2回まで、429と想定内の失敗は再試行しない)と既定値(鮮度の保持・ウィンドウのフォーカスでの再取得なし・変更は再試行なし)、実行時の値の入れ物が1回だけ設定でき未設定の読み取りで例外になること、dehydrateとhydrateで同じ値が戻ることを確かめる単体テストを書く
  - 完了状態: 単体テストが成功し、contextを作る関数を2回呼ぶと別々のQueryClientとストアが返る
  - _Depends: 2.1, 3.11_
  - _Requirements: 1.5, 3.3, 3.4, 3.5, 4.1, 6.5, 6.7, 6.8, 9.2, 12.4_

- [x] 4.2 GraphQLの実行部品と取得の補助を作る
  - サーバー側はページの描画の文脈(中継の文脈とService Bindings)で、項目の組み立てをブラウザからの中継と共通にしてAPIの`POST /graphql`を呼び、Cookieの指示を送り始める前の応答へ反映し、送り始めた後の指示は警告ログを出して捨てる
  - ブラウザ側は`fetch`を注入する純粋な関数で、中継の経路へ識別子と変数だけを送り、bot判定のトークンを項目として付け、通信の失敗を通信の失敗のエラーにする
  - サーバー専用の処理はサーバー専用のファイルに置き、同型の関数のサーバーの分岐からだけ読み込む。取得の補助のキーは2.1の取得のキーを使う
  - 先に、ブラウザ側の送信の形(本文に操作の本文を含まず、トークンの項目が付く)・通信の失敗・応答の解析を、偽の`fetch`で確かめる単体テストを書く
  - 完了状態: 単体テストが成功し、6.5のビルドでTanStackのimport保護の違反が出ない(サーバー専用のimportがブラウザのバンドルに入らない)ことを確かめられる
  - _Depends: 3.6, 4.1_
  - _Requirements: 2.2, 2.5, 2.7, 2.8, 6.3, 6.6_

- [x] 4.3 想定外の失敗の送信とブラウザ側のSentryの初期化を作る
  - サーバー側はSentryのCloudflare版の送信とエラーログ、ブラウザ側は純粋な送信待ちの列に初期化前の送信を最大10件まで積み、初期化の後に送る。想定内の失敗と同じ例外の2回目は送らない
  - ブラウザ側のSentryは、ルートの部品のマウント後に、注入できる読み込み関数(既定は動的import)で読み込み、送信先・環境・トレースの割合・ルーターのトレース・中継の経路へのトレースの伝搬・除去の関数・収集の設定で初期化し、送信先が無ければ読み込まない。読み込みと送信の失敗は画面に影響させない
  - 先に、送信待ちの列の上限・重複の除外・想定内の除外・初期化後の直接の送信と、送信先が無い場合に読み込まないこと・初期化のオプションの内容を、偽の読み込み関数で確かめる単体テストを書く
  - 完了状態: 単体テストが成功し、6.5のビルドの出力でブラウザ側のSentryのコードがクライアントの主バンドルに含まれないことを確かめられる
  - _Depends: 2.4, 4.1_
  - _Requirements: 11.6, 13.1, 13.2, 13.4, 13.5, 13.10, 14.2_

- [x] 4.4 (P) アクセス解析の計測スクリプト・消えたスクリプトの再読み込み・ページのheadを作る
  - 先に、トークンがある場合だけ遅延読み込みの計測スクリプトの定義を返すこと、読み込みの失敗の通知で印が無ければ1回だけ再読み込みし印があれば何もしないこと、タイトル・正規のURL・検索除外の指示のhead定義を、偽のイベントと保存先で確かめる単体テストを書く
  - いずれもTanStack Startを読み込まない純粋なファイルにする
  - 完了状態: 単体テストが成功し、再読み込みが連続して2回起きない
  - _Boundary: WebAnalytics, PreloadRecovery, PageHead_
  - _Requirements: 1.7, 4.7, 11.9, 12.5, 13.6, 13.10, 14.2_

- [x] 5. 共通の画面部品
- [x] 5.1 shadcn/uiの基本の部品を部分ごとのファイルに分けて移植する
  - モックアップのボタン・入力欄・ラベル・複数行の入力欄・バッジ・スケルトン・スイッチ・ラジオボタンを、1ファイル1コンポーネントに分けて移植し、見た目の種類の定義は別のファイルに置く。固定幅を持たせない
  - 先に、各部品のキーボード操作・無効の状態・フォーカスの表示・検査の補助の違反0件を確かめるブラウザテストを書く
  - 完了状態: ブラウザテストが成功し、各ファイルがReactコンポーネントを1つだけエクスポートする
  - _Depends: 1.3, 2.3_
  - _Requirements: 7.1, 9.9, 10.1, 10.3_

- [x] 5.2 ダイアログ・シート・メニュー・ポップオーバー・ツールチップ・タブを移植する
  - モックアップの重ねて表示する部品とタブを、部分ごとのファイルに分けて移植する
  - 先に、開いた時のフォーカスの移動と閉じ込め、閉じた時の元の要素への戻り、Escapeで閉じること、タブの矢印キーの操作、検査の補助の違反0件を確かめるブラウザテストを書く
  - 完了状態: ブラウザテストが成功し、各ファイルがReactコンポーネントを1つだけエクスポートする
  - _Depends: 5.1_
  - _Requirements: 10.1, 10.2_

- [x] 5.3 (P) フォーム部品を作る
  - 検証規則をZodで定義するフォームの用意(最初にフォーカスを外した時に検証し、以降は入力ごとに検証する)、ラベル・説明・エラーを関連付ける欄、エラーの表示、送信ボタン(未入力の必須項目・検証エラー・送信中に無効、送信中の表示)を作る
  - サーバーが返す項目ごとの詳細を欄のエラーにし、最初のエラーの欄へフォーカスを移す
  - 先に、フォーカスを外した時のエラーの表示と入力ごとの再検証、送信ボタンの無効化、二重送信の防止、サーバーの詳細の表示とフォーカス、エラーの文言とアイコンと関連付け、検査の補助の違反0件を確かめるブラウザテストを書く
  - 完了状態: ブラウザテストが成功し、エラーの文言が「です・ます」調で末尾に「。」が付く
  - _Depends: 2.3, 5.1_
  - _Boundary: FormParts_
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.12, 10.6_

- [x] 5.4 (P) 状態表示・トースト・存在しないページと想定外のエラーの表示を作る
  - ローディング(スケルトン)・空(次の行動への導線)・エラー(再試行と問い合わせへの導線、技術的な詳細なし)・部分的なエラー・縮退運転中の表示と、トーストとその表示の関数、存在しないページと想定外のエラーの表示を作る
  - 先に、各表示の文言・導線・再試行の操作と、トーストの内容が支援技術へ伝わること、検査の補助の違反0件を確かめるブラウザテストを書く
  - 完了状態: ブラウザテストが成功し、文言が文言規則の表と一致する
  - _Depends: 5.1_
  - _Boundary: StateDisplays, Toaster, ErrorViews_
  - _Requirements: 8.6, 8.7, 8.10, 8.12, 11.7_

- [x] 5.5 (P) 表示設定の提供と、日時・相対表現・数値の部品を作る
  - 表示設定の提供はサーバー側の値で初期化し、マウント後にブラウザの値と異なる場合だけ切り替える。日時は`<time>`要素に`datetime`属性を付け、相対表現は日時と併記してマウント後に定期的に更新する
  - 先に、サーバーの値で描画した直後の表示、ブラウザの値への切り替え、`datetime`属性のUTCのISO形式、相対表現の併記と更新、ロケールの数値の形式を確かめるブラウザテストを書く
  - 完了状態: ブラウザテストが成功し、ブラウザのタイムゾーンがサーバーの値と異なる設定でもハイドレーションの不一致の警告が出ない
  - _Depends: 2.2_
  - _Boundary: DateTimeDisplay_
  - _Requirements: 9.1, 9.3, 9.4, 9.7, 9.8_

- [x] 5.6 (P) Turnstileのウィジェットとトークンの管理を作る
  - ルーターの実行時の値のサイトキーとnonceでウィジェットを描画し、スクリプトはマウント後に読み込む。成功・期限切れ・失敗の状態と、使ったトークンの再取得を管理する
  - 先に、ウィジェットの部品を差し替えて、成功時のトークンの受け取り、使用後と期限切れの再実行、失敗時の文言の表示を確かめるブラウザテストを書く
  - 完了状態: ブラウザテストが成功し、失敗時に「認証に失敗しました。ページを再読み込みして再度お試しください。」が警告として読み上げられる
  - _Depends: 4.1, 5.1_
  - _Boundary: TurnstileWidget_
  - _Requirements: 2.5, 8.8, 8.9, 14.2_

- [x] 5.7 疎通確認の結果の表示を作る
  - サーバー側の描画時とブラウザからの再確認の結果を区別し、APIサーバーの時刻・データベースの到達可否・APIサーバーへ到達できない場合を表示する。再確認の操作と処理中の状態を持つ
  - 先に、到達可能・データベースに到達できない・APIに到達できない・再確認中の各表示を確かめるブラウザテストを書く
  - 完了状態: ブラウザテストが成功し、3つの状態の文言が互いに異なる
  - _Depends: 2.1, 5.5_
  - _Requirements: 12.1, 12.2, 12.3_

- [x] 5.8 文書の外枠・スキップリンク・画面遷移の通知・ダークモードの切替ボタンを作る
  - 文書の外枠は言語を日本語にし、初回描画前の配色のスクリプトをheadに置き、属性の不一致の警告を抑え、スキップリンク・トースト(5.4)・画面遷移の通知・表示設定の提供(5.5)を含め、マウント後にブラウザ側のSentryの初期化と再読み込みの仕組みを呼ぶ
  - 先に、切替ボタンの操作で配色が切り替わり保存されること、保存が無い時にOSの設定に従うこと、ボタンの名前と押下の状態、スキップリンクで本文へ移動すること、画面遷移の後にタイトルが通知されることを確かめるブラウザテストを書く
  - 完了状態: ブラウザテストが成功し、検査の補助の違反が0件になる
  - _Depends: 4.3, 4.4, 5.4, 5.5_
  - _Requirements: 7.3, 7.4, 7.5, 10.1, 10.4, 10.5_

- [x] 5.9 部品のカタログを用意する
  - Storybookと、TanStackの部品のための枠組み・アクセシビリティの確認の追加機能を共通部品へ導入し、ライト・ダークの切替と固定の表示設定をカタログの全体に適用する
  - 5.1〜5.8の各部品に、主要な状態(既定・ローディング・エラー・無効など)のストーリーを置く
  - 新規採用の`@storybook/addon-a11y`を、導入と同じ変更でtech-stack.mdへ記載する
  - 完了状態: カタログのビルドが成功し、ローカルの起動で全部品のストーリーをライト・ダークで表示でき、カタログの静的解析の規則に違反が無い
  - _Depends: 5.2, 5.3, 5.6, 5.7, 5.8_
  - _Requirements: 8.11, 15.7_

- [x] 6. 利用者側フロントエンドサーバー
- [x] 6.1 利用者側のプロジェクト・ビルドと実行環境の設定・静的なファイルのヘッダーを作る
  - 前提: api-gatewayの全タスクが完了し、APIの名前付きエントリポイントが存在すること。無ければ止めて報告する
  - 利用者側のアプリに、スクリプト契約、共通部品と同じ版の実行時の依存、`@tanstack/react-router-ssr-query`・`@cloudflare/vite-plugin` 1.53.0・`wrangler` 4.124.0・Vite・Tailwind CSSのプラグインを導入し、共通部品の配置先を静的解析とテストから外して型検査に含める
  - 先に、Wrangler設定の3環境の実効値(Worker名・APIのService Bindingsと`ClientGateway`・IP制限のバインディングの名前空間と上限・呼び出しログの無効化・Workers Cacheの無効化・互換性日付・必須の変数・staging・prodのシークレット)と、静的なファイルのヘッダーが共通部品の定数と一致し`/assets/*`が長期キャッシュになることを確かめる単体テストを書く
  - Viteの設定でローカル状態の保存先を共通の場所にし、Wrangler設定と静的なファイルのヘッダーを置く。ブラウザテストの設定は、カバレッジの対象を利用者側の画面部品に絞り、共通部品の配置先を除外する
  - 完了状態: 単体テストが成功し、ルートの一括検査に利用者側のアプリが参加して成功する
  - _Requirements: 1.1, 1.2, 1.3, 4.4, 4.6, 5.1, 5.5, 13.9, 15.2_

- [x] 6.2 利用者側のコード生成の設定と疎通確認の操作を作る
  - 前提: apiのスキーマファイルが生成済みであること
  - `graphql`・GraphQL Code Generatorのcliとclient-presetをapiと同じ版で導入し、apiのスキーマファイルを入力にし、操作の本文を識別子に置き換えた生成物と操作の一覧を、api-gatewayの契約の場所へ出す設定と、生成・検査のスクリプトを置く。疎通確認の操作を定義して生成する
  - 完了状態: 生成の後に検査が成功し、操作を変えて生成しないと検査が失敗し、生成物に操作の本文が含まれず、操作の一覧の識別子が`sha256:`で始まり、apiの許可リストの生成が利用者側の操作を取り込む
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 6.3 利用者側のサーバーのエントリ・Startの設定・ルーター・登録箇所を作る
  - 利用者側のプロファイル(Cookieの名前・prodだけ検索を許す・アクセス解析あり)、CSPの許可先(Web Analytics)、中継の経路(GraphQLだけ)の登録箇所を置く。先に、登録箇所の既定値を確かめる単体テストを書く
  - サーバーのエントリはSentryのCloudflare版で包んだ共通部品のエントリに、プロファイル・TanStackのハンドラー・登録箇所・送信と伝搬の関数を渡す。Startの設定とルーター(nonce・context・SSR統合・dehydrate・描画の例外の送信・Jotaiの提供)を置く
  - 完了状態: 単体テストと型検査が成功する(ビルドの確認はルートを置く6.5で行う)
  - _Depends: 3.11, 4.1, 4.2, 4.3, 4.4, 6.1_
  - _Requirements: 1.6, 2.1, 2.9, 2.14, 4.2, 4.3, 13.6_

- [x] 6.4 (P) 利用者側の共通レイアウトと区画の登録箇所を作る
  - モックアップのヘッダー・狭い画面のメニュー・フッターを本番のURL体系で移植し、ヘッダーのログイン中の表示・「ローンチする」の導線・ヘッダー直下の帯・フッターの直前・フッターのヘルプのリンクの区画を登録箇所から描画する。初版は未ログインの導線(ログイン・登録)を置く
  - 先に、ヘッダー(ロゴ・ディレクトリ・ヘルプ・「ローンチする」・ダークモードの切替・ログインと登録)、768px未満のメニュー、フッターのリンク(ヘルプ・利用規約・プライバシーポリシー・法的通知・料金・問い合わせ)、ランドマークと名前付きのナビゲーション、区画へ差し込んだ部品の描画、幅320pxで横スクロールが出ないこと、検査の補助の違反0件を確かめるブラウザテストを書く
  - 完了状態: ブラウザテストが成功し、区画の登録箇所の型を変えずにテスト用の部品を差し込める
  - _Depends: 5.2, 5.8, 6.1_
  - _Boundary: SiteLayout_
  - _Requirements: 7.2, 10.4, 11.1, 11.2, 11.3_

- [x] 6.5 利用者側のルート・404とエラーの画面・仮のトップページ・疎通確認の画面を作る
  - ルートで実行時の値をloaderから表示設定と公開設定として渡し、headにタイトル・スタイル・アクセス解析のスクリプトを置き、存在しないページ・想定外のエラーの画面を共通レイアウトの中に出し、loaderの例外を送信する
  - トップページの経路に仮のページを置き、疎通確認の画面はloaderでサーバー側の取得を行い、「再確認」でブラウザから中継の経路を経て取得し、2.3の判定でprodでは存在しないページにし、検索除外の指示を付ける
  - 先に、404とエラーの画面の文言と導線を確かめるブラウザテストを書く
  - 完了状態: ブラウザテストが成功し、`vite build`がTanStackのimport保護の違反無く成功し、主バンドルにブラウザ側のSentryのコードが含まれず、ローカルの開発サーバーで存在しないページが404・疎通確認の画面がサーバー側の結果を表示する
  - _Depends: 5.7, 6.2, 6.3, 6.4_
  - _Requirements: 9.2, 11.5, 11.6, 11.8, 11.9, 12.1, 12.2, 12.4, 12.5, 14.1, 14.3, 14.4_

- [x] 7. 管理者側フロントエンドサーバー
- [x] 7.1 (P) 管理者側のプロジェクト・ビルドと実行環境の設定・静的なファイルのヘッダーを作る
  - 6.1と同じ手順で、管理者側のWorker名・`AdminGateway`・管理者側の名前空間・アクセス解析のトークンを持たない変数で設定し、ブラウザテストの設定を置く。設定の単体テストを先に書く
  - 完了状態: 単体テストが成功し、ルートの一括検査に管理者側のアプリが参加して成功し、利用者側・api・eventと名前空間が重ならない
  - _Depends: 3.4_
  - _Boundary: admin AppBuildConfig_
  - _Requirements: 1.1, 1.2, 1.3, 4.4, 4.6, 5.1, 5.5, 13.9, 15.2_

- [x] 7.2 管理者側のコード生成の設定と疎通確認の操作を作る
  - 前提: apiのスキーマファイルが生成済みであること
  - 6.2と同じ設定で、管理者側の疎通確認の操作を生成する
  - 完了状態: 生成と検査が成功し、管理者側の操作の一覧が利用者側の操作を含まず、apiの許可リストの生成が管理者側の操作を取り込む
  - _Requirements: 6.1, 6.2, 6.4_

- [x] 7.3 管理者側のサーバーのエントリ・Startの設定・ルーター・登録箇所を作る
  - 管理者側のプロファイル(管理者のCookieの名前・常に検索除外・アクセス解析なし)、空のCSPの追加の許可先、GraphQLだけの中継の経路を登録し、6.3と同じ構成でエントリ・Startの設定・ルーターを置く。先に、登録箇所の既定値と、利用者側とCookieの名前が異なることを確かめる単体テストを書く
  - 完了状態: 単体テストと型検査が成功する
  - _Depends: 6.3, 7.1_
  - _Requirements: 1.6, 2.9, 4.3, 4.7, 13.7_

- [x] 7.4 (P) 管理者側の基本レイアウトと区画の登録箇所を作る
  - サービス名と管理画面であることを示すヘッダー・ダークモードの切替・本文の領域と、メニューとログイン中の表示の区画を作る。初版の区画は空にする
  - 先に、ヘッダーの文言・切替ボタン・ランドマーク・区画へ差し込んだ部品の描画・検査の補助の違反0件を確かめるブラウザテストを書く
  - 完了状態: ブラウザテストが成功し、区画が空の時に空の領域を描画しない
  - _Depends: 5.8, 7.1_
  - _Boundary: AdminLayout_
  - _Requirements: 10.4, 11.4_

- [x] 7.5 管理者側のルート・404とエラーの画面・仮のトップページ・疎通確認の画面を作る
  - 6.5と同じ構成で、管理者側の基本レイアウトの中に存在しないページ(トップページへの導線)・想定外のエラー・仮のトップページ・疎通確認の画面を置く。アクセス解析のスクリプトは置かない
  - 先に、404とエラーの画面の文言と導線を確かめるブラウザテストを書く
  - 完了状態: ブラウザテストが成功し、`vite build`が成功し、ページにアクセス解析のスクリプトが含まれず、ローカルの開発サーバーで存在しないページが404・疎通確認の画面が管理者側の操作で結果を表示する
  - _Depends: 7.2, 7.3, 7.4_
  - _Requirements: 11.5, 11.6, 11.8, 12.1, 12.4, 13.7_

- [x] 8. 統合と検証
- [x] 8.1 ローカル環境で、開発サーバーとビルド後のプレビューの両方の疎通を確かめる
  - APIを先に起動し、マイグレーションの適用と、利用者側・管理者側の生成の後の許可リストの再生成を行ってから、両アプリを開発サーバーで起動して疎通確認の画面と再確認を確かめる
  - 両アプリを`vite build`してプレビューで同じ確認を行い、デプロイ先の環境を指定したビルドの出力の設定がstagingの値(Worker名・APIの接続先・名前空間)になることを確かめる。確認のために起動したプロセスは終了後に止める
  - 完了状態: 両アプリの開発サーバーとプレビューの両方で、疎通確認の画面にAPIの時刻と「到達可能」が表示されて再確認が成功し、手順で見つかった注意点(起動の順序・ポートなど)が9.6で反映する項目として完了報告に列挙されている
  - _Depends: 6.5, 7.5_
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 6.1_

- [x] 8.2 スモークテストを作る
  - 両アプリの疎通確認の画面で、応答のセキュリティヘッダーとnonce付きのCSP、HTMLの全スクリプトのnonce、APIの時刻と「到達可能」の表示、再確認の成功、CSPの違反が1件も起きないこと、存在しないページの404、クロスサイトを名乗る中継の要求の403、Sentry・アクセス解析・Turnstileのスクリプトが最初の描画を妨げない読み込み方であることを確かめるE2Eテストを書く。ヘッダーの検査とCSPの違反の記録の補助を両方で共用する
  - 完了状態: 8.1の起動状態でE2Eテストが成功し、対象のURLの環境変数を変えるだけでstagingに向けられる
  - _Depends: 8.1_
  - _Requirements: 2.1, 3.2, 4.1, 4.4, 4.5, 11.5, 12.6, 12.7, 14.1, 14.2_

- [x] 8.3 カバレッジと一括検査を確かめる
  - 共通部品・利用者側・管理者側で、単体テストとブラウザテストをカバレッジ計測付きで実行し、80%に満たないファイルにテストを足す。ルートの一括検査と全種別の一括実行を実行する
  - 完了状態: 3つのアプリのカバレッジ計測付きの実行と、ルートの一括検査・一括実行がすべて成功する
  - _Depends: 8.2_
  - _Requirements: 15.1, 15.2_

- [x] 9. 技術ドキュメント・サービスの文書・オンボーディング
- [x] 9.1 (P) フロントエンドサーバーのセキュリティと起動の文書を書く
  - フロントエンドサーバーのセキュリティの文書(処理の順序、中継の経路と項目、Cookieの属性と名前の分け方、経路の追加規約、CSRFの範囲と状態を変えるサーバー関数の`POST`、nonce付きCSPと許可先の登録、セキュリティヘッダー・`no-store`・静的なファイルのヘッダー、検索除外、IP制限の適用、生のHTMLの禁止と例外)を追加する
  - TanStack Startの起動の文書に、独自のサーバーのエントリ、サーバー専用のファイルと同型の関数、別プロセスのWorkerへのService Bindings、デプロイ先の環境のビルド時の指定を追記し、共有ディレクトリの文書に自己完結の型検査設定の理由と検証の結果を追記する。索引の更新は9.6で行う
  - 完了状態: 3つの文書が更新され、プロジェクト名と固有値が含まれない
  - _Depends: 8.2_
  - _Boundary: FrontendSecurityDoc_
  - _Requirements: 15.3, 15.4_

- [x] 9.2 (P) アクセシビリティ規則と共通化する部品の文書を書く
  - アクセシビリティ規則(キーボード・フォーカス・ランドマーク・スキップリンク・画面遷移の通知・コントラスト・エラーの関連付け・自動検査と手動の確認・視差効果の軽減・演出を持つspecが停止の手段を用意する義務)と、共通化する部品の文書(部品の一覧と使い方、1ファイル1コンポーネントとshadcn/uiの分割、カタログの書き方、翻訳への耐性)を追加する。索引の更新は9.6で行う
  - 完了状態: 2文書が追加され、演出の停止の義務がWCAG 2.2の達成基準2.2.2として明記され、プロジェクト名と固有値が含まれない
  - _Depends: 8.2_
  - _Boundary: AccessibilityDoc, ComponentsDoc_
  - _Requirements: 7.8, 9.9, 15.3, 15.4_

- [x] 9.3 (P) データ取得とGraphQLのクライアント側と依存の版の文書を書く
  - データ取得の文書(操作の置き場所、取得の補助とloader、既定値と再試行、エラーの型と画面の分岐、Cookieの指示が反映される範囲、要求ごとのストア、サーバーのデータと画面の状態の使い分け、取得の遅い区画のストリーミング、1ページの描画あたりの呼び出し回数の目安)を追加し、GraphQL通信の文書のクライアント側の節を書く
  - 依存の版の文書に、Viteのプラグイン・Wrangler・Workers統合テストの版の組の一括更新と、3アプリで版をそろえるパッケージと、apiとそろえるGraphQLの版を追記する。索引の更新は9.6で行う
  - 完了状態: GraphQL通信の文書のクライアント側の節が見出しだけでなくなり、3つの文書にプロジェクト名と固有値が含まれない
  - _Depends: 8.2_
  - _Boundary: DataFetchingDoc_
  - _Requirements: 6.9, 14.3, 14.4, 15.3, 15.4_

- [x] 9.4 (P) フロントエンドの観測の文書を書く
  - Sentryの初期化(サーバー・ブラウザの遅延読み込み)、除去の規則と逐次送信のスパンの注意、想定外の失敗の送信の入口、トレースの割合、アクセス解析、アクセスログの文書を追加する。索引の更新は9.6で行う
  - 完了状態: スパンの除去が必要な理由と確認の方法が書かれ、プロジェクト名と固有値が含まれない
  - _Depends: 8.2_
  - _Boundary: ObservabilityDoc_
  - _Requirements: 15.3, 15.4_

- [x] 9.5 (P) 国際化方針とデザインガイドラインの修正を書く
  - 国際化方針(基準時刻の使いどころと画面に出さない規則、ユーザーのタイムゾーンとロケールでの表示、サーバー側の推定とブラウザでの置き換え、相対表現の併記、メールのUTC表記への参照、ブラウザ翻訳への耐性)を追加する
  - デザイン原則の日時の述語の欠けた箇条を直し、ページ構成の共通ヘッダーの項目にダークモードの切替ボタンと管理者側の基本レイアウトを加え、文言規則に想定外のエラーの画面とCSRFの拒否と中継先の障害の文言を加える。索引の更新は9.6で行う
  - 完了状態: デザイン原則と国際化方針の日時の記述が食い違わず、文言規則の文言が3.5の定数と一致する
  - _Depends: 8.2_
  - _Boundary: ServiceDocs_
  - _Requirements: 15.5, 15.6_

- [x] 9.6 索引・オンボーディング・固有の値・CLAUDE.mdを更新し、tech-stack.mdの記載を確かめる
  - `frontend`・`coding`の技術ドキュメントの索引と、サービス文書の機能仕様の索引に、9.1〜9.5の文書を加える
  - オンボーディングに、起動の順序(API→利用者側・管理者側)、コード生成と許可リストの再生成、プレビュー、カタログ、スモークテストの手順と、8.1で列挙した注意点を反映する
  - 固有の値の文書に、Worker名・名前空間・Cookieの名前・中継の経路・疎通確認の経路・変数の環境ごとの値・CSPの許可先を記載する
  - CLAUDE.mdの技術規則の参照先に、画面・中継・CSPの登録・データ取得・アクセシビリティの文書を加え、ディレクトリ構成に共通部品のサーバーの部品・Startとの接続・スタイル・設定を加える
  - 本specで導入したパッケージがすべてtech-stack.mdに記載されていることを確かめ、漏れがあれば追記する
  - 完了状態: 索引から9.1〜9.5のすべての文書へ辿れ、手順のとおりに新しい作業ツリーで両アプリとカタログを起動でき、tech-stack.mdに設計のTechnology Stackの新規のパッケージがすべて載っている
  - _Depends: 9.1, 9.2, 9.3, 9.4, 9.5_
  - _Requirements: 15.3, 15.4, 15.7, 15.8_

- [x] 10. 最終検証後の判断の反映
- [x] 10.1 フロントエンドのIP制限のキーをハッシュ化する
  - 前提: backend-platformの11.1(Worker単位のIP制限のキーのハッシュ化)が完了し、backend-libの`ipRateLimit`がハッシュ化したキーで数えていること。完了していなければ止めて報告する
  - 先に、共通部品の新しい`server/http/rate-limit-key-hash.ts`の`hashRateLimitKey(pepper, ...parts)`が、`node:crypto`の`createHmac('sha512', <ペッパー>).update('rate-limit-key\u0000' + JSON.stringify(parts)).digest('base64url')`と同じ値を返すこと(backend-libの`hashRateLimitKey`と同じ計算)、部品が空なら値を含まない例外になることを確かめる単体テストを書く
  - 先に、`checkIpRateLimit`がバインディングへ渡すキーが`ip:<IP>`(不明なら`ip:unknown`)をハッシュ化した値で、生のIPアドレスを含まないこと、環境の検証が`HASH_PEPPER`の欠落と空をキー名だけで返すこと、エントリが検証済みのペッパーでIP制限を呼ぶことを確かめる単体テストを書き、実装する
  - 環境の検証スキーマに`HASH_PEPPER`(空でない文字列)を加え、ブラウザへ渡す設定値に含めない。client・adminのWrangler設定のルート・staging・prodの`secrets.required`に`HASH_PEPPER`を加え、`wrangler-config.unit.test.ts`の期待値を合わせる
  - `frontend/003`のIP制限の適用の節(キーのハッシュ化とbackend-libと同じ値になること)、`project-values.md`の`HASH_PEPPER`を使うアプリ、オンボーディングのシークレットの表と「client・adminはシークレットを必要としない」の記載を直す
  - 完了状態: 共通部品・client・adminの単体テストと一括検査が成功し、Infisicalの`dev`から注入して起動した両アプリの疎通確認の画面が表示され、IP制限のキーにIPアドレスが含まれないことを単体テストで確かめられる
  - _Depends: backend-platformの11.1_
  - _Boundary: IpRateLimit, RateLimitKeyHash, FrontendEnv, AppBuildConfig_
  - _Requirements: 1.4, 5.1, 5.2, 5.7, 15.3, 15.4, 15.8_

- [x] 10.2 Turnstileのウィジェットを非表示で描き、ローカルのサイトキーを非表示のテスト用に替える
  - 先に、ウィジェットのブラウザテストへ、ライブラリへ`size: 'invisible'`を渡すことと、失敗時の文言の表示が変わらないことを確かめる検査を足し、`TurnstileWidget`の`options`に`size: 'invisible'`を加える
  - client・adminのWrangler設定のルートの`vars`の`TURNSTILE_SITE_KEY`を`1x00000000000000000000BB`(常に成功し表示しないテスト用)にし、`wrangler-config.unit.test.ts`の期待値を合わせる。staging・prodの仮の値は変えない
  - 水平展開: 共通部品のテストとカタログが使うサイトキー(`.storybook/preview.tsx`、`test/start-request-fixtures.ts`、`server/env/frontend-env.unit.test.ts`・`server/observability/server-sentry-options.unit.test.ts`・`start/router-context.unit.test.ts`、`components/bot-protection/turnstile-widget.browser.test.tsx`・`components/app-shell/app-document.browser.test.tsx`)も`1x00000000000000000000BB`に揃える。揃えない箇所があれば、その理由をテストの定数の近くに書く
  - `backend/003`の「テスト用の鍵」の表に、サイトキー`1x00000000000000000000BB`(常に成功・ウィジェットを表示しない)の行を加える。`frontend/005`のウィジェットの節に、非表示で描き表示の枠と場所を画面に設けないことを書き、`project-values.md`のローカルのサイトキーを直す
  - 完了状態: 共通部品のブラウザテスト・単体テストとclient・adminの単体テストが成功し、`apps/frontend-lib`・`apps/client`・`apps/admin`(生成物の`dist`を除く)に`1x00000000000000000000AA`が理由の無いまま残らず、`backend/003`・`frontend/005`・`project-values.md`の記述がWrangler設定と一致する
  - _Boundary: TurnstileWidget, AppBuildConfig, StorybookCatalog_
  - _Requirements: 7.2, 8.8, 8.9, 15.3, 15.4_

- [x] 10.3 管理者側のエラーの表示と静的な500の画面の案内文を直し、通知メールの件名の例から相対表現を除き、型の生成を足さない理由を書く
  - 先に、`UnexpectedErrorView`が`contactHref`を受けない時は案内文が「時間をおいて再度お試しください。」だけで「解決しない場合はお問い合わせください。」を含まず、受けた時は両方と問い合わせのボタンを出すことを確かめるブラウザテストを書く。`state-messages.ts`に`RETRY_LATER_GUIDANCE`・`CONTACT_GUIDANCE`・`UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT`(新規)を置き、`RETRY_GUIDANCE`と`UNEXPECTED_ERROR_MESSAGE`をその連結にする
  - 先に、`ErrorState`が`contactHref`を受けない時は問い合わせのボタンを描かず、受けた時は描くことを確かめるブラウザテストを書き、`ErrorStateProps.contactHref`を任意にする
  - 先に、`errorMessageOf(error, contactAvailable)`(新規、`utilities/graphql/graphql-result.ts`)が`GraphQLClientError`には`message`を返し、それ以外の例外には`contactAvailable`の真偽で`UNEXPECTED_ERROR_MESSAGE`と`UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT`を返すこと、`network_error`・`invalid_response`の文言と`ERROR_MESSAGES`が問い合わせを促す文を含まないことを確かめる単体テストを書き、実装する。client・adminの`ErrorPage`など`GraphQLClientError`でない例外の文言を出す画面(`ErrorState`・`PartialErrorState`・`AppForm`の`onSubmitError`・トースト)は、プロファイルの`contactAvailable`を渡して`errorMessageOf`を使う。`AppForm`の`onSubmitError`の例の`FormMessage`と、`notify.error`で失敗を出す例に`errorMessageOf`を使うことを、部品のストーリー・ブラウザテストの例でも示す
  - 先に、`renderStaticErrorPage({ status: 500, contactAvailable })`が偽の時は「解決しない場合はお問い合わせください。」を含まない`UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT`を、真の時は`UNEXPECTED_ERROR_MESSAGE`を出すこと、サーバーのエントリが環境の不備・許可先の不正・例外の500でプロファイルの`contactAvailable`を渡すこと、client・adminのプロファイルの`contactAvailable`がそれぞれ真・偽であることを確かめる単体テストを書く。`FrontendAppProfile`に`contactAvailable`(新規)を加え、`StaticErrorPageInput`の500に必須の`contactAvailable`を加える
  - 文言規則(`service/design/003`)に、画面内の表示と静的な500の画面のそれぞれで2通りの案内文を書き、通知メールの件名の例を日付を基準にしない文言(「フルタイム: Pitch NotesがTactics Boardに勝利、次は準決勝」「Pitch Notesがキックオフします⚽️応援しましょう！」「フォローしているユーザーの3プロダクトがキックオフします⚽️応援しましょう！」)にする。国際化方針のメールの日時の節に、件名で日付を基準にした相対表現を使わないことを書く
  - `frontend/005`の`ErrorState`の`contactHref`を省略可にし、`AppForm`の`onSubmitError`とトーストで失敗を出す時も`errorMessageOf`で文言を選ぶことを書き、`frontend/006`のエラーの扱いの節の「`GraphQLClientError`でない例外は`UNEXPECTED_ERROR_MESSAGE`を表示する」を、`errorMessageOf`とプロファイルの`contactAvailable`による出し分け(問い合わせの導線が無い側は「時間をおいて再度お試しください。」で終える文言。`ErrorState`・`PartialErrorState`・`AppForm`の`onSubmitError`・トーストのどれにも適用する)に直す
  - `frontend/002`に、client・adminに型生成のスクリプトを置かない理由(環境の型は共通部品のZodのスキーマから作り、Wrangler設定との食い違いは`wrangler-config.unit.test.ts`が検出する)を書く
  - 判断待ちの記載を残さない: `frontend/006`の呼び出し回数の目安(3回以内)、オンボーディングのクイックスタートのAIエージェントの規則(手順1〜11は実行しない、12〜14は確認のため実行してよく、起動したプロセスは止める)、CLAUDE.mdの技術規則の参照先に足した3つ(frontend/005・coding/004・frontend/007)を確定した記述とし、文書・コメントに判断待ちの記載があれば消す
  - 完了状態: 共通部品の単体テスト・ブラウザテストとclient・adminの単体テスト・エラーの画面のテストが成功し、管理者側の画面内の想定外のエラーの表示・`ErrorState`・`GraphQLClientError`でない例外の文言(フォームの`onSubmitError`・トーストを含む)・静的な500の画面のどれにも問い合わせの導線と「解決しない場合はお問い合わせください。」が出ず、利用者側の文言は変わらず、文言規則の文言が`utilities/messages/*.ts`の定数と一致し、件名の例に「明日」「本日」が含まれない
  - _Boundary: ErrorViews, StateDisplays, GraphqlResult, FormParts, Toaster, ErrorResponses, AppProfile, FrontendServerEntry, 技術ドキュメント群_
  - _Requirements: 1.6, 8.6, 8.10, 8.12, 8.13, 11.6, 11.10, 15.3, 15.4, 15.5, 15.6_

- [x] 10.4 下流specの設計を確定した契約に合わせる
  - design.mdの「実装で確定した契約による発火と影響を受ける下流spec」の表の各行に挙げた下流spec(data-export・identity-auth・notifications・public-api・product-launch・content-reporting・help-center・ultras-subscription・sponsorship・legal-pages・tournament-week・tournament-year・inquiry-chat・user-profile-social・admin-foundation・directory-discovery・match-engine・payments・engagement・ugc-moderation・content-processing・media-pipeline・infra-delivery)のdesign.md(必要ならrequirements.md・tasks.md・research.md)を、表の確定した契約(操作の置き場所と生成物、Zodの値の読み込み元、フォーム部品の形、`RelayRoute`の形とJSONでない5xxの503、`SecurityPolicySources`と環境のキー、非表示のウィジェット、管理者側の画面シェル、`HASH_PEPPER`の共有、管理者側のエラーの案内文)に合わせる
  - ウィジェットを置くspecから、判定の枠の表示と場所の記述を除く。admin-foundationの管理者側のランドマーク(フッターを持たず、ナビゲーションは`navigation`の区画の`nav`で満たす)を合わせる
  - infra-delivery: Turnstileのウィジェットの種類(`design.md:587`の`mode: 'managed'`、`design.md:687`・`design.md:694`・`design.md:1502`の`mode = "managed"`)を`invisible`にし、stagingの`HASH_PEPPER`の登録先(`design.md:1517`・`design.md:1555`のapi・event)にclient・adminを加える。research.md・tasks.mdに同じ記述があれば合わせる
  - `apps/admin/src`の`routes`・`components`・`composition/admin-*`にファイルを加える設計のspec(admin-foundation・content-reporting・help-center・inquiry-chat・legal-pages・notifications・product-launch・sponsorship・tournament-year・ugc-moderation・ultras-subscription・media-pipeline、該当箇所は表の行)は、管理者側の`ErrorState`・`UnexpectedErrorView`に`contactHref`を渡さず、`GraphQLClientError`でない例外に代えて出す文言(`ErrorState`・`PartialErrorState`・`AppForm`の`onSubmitError`・トースト)を`errorMessageOf(error, ADMIN_PROFILE.contactAvailable)`で選ぶ記述にする
  - notificationsのrequirements.md・design.mdの件名から、日付を基準にした相対表現(「明日は準決勝」「本日キックオフ」)を除き、判断10の件名の例(「フルタイム: Pitch NotesがTactics Boardに勝利、次は準決勝」「Pitch Notesがキックオフします⚽️応援しましょう！」「フォローしているユーザーの3プロダクトがキックオフします⚽️応援しましょう！」)に合わせる
  - 改訂した下流specの該当箇所を、この表の「該当箇所」の列から消すか更新する
  - 完了状態: 表の各行の下流specの該当箇所が確定した契約と食い違わず、infra-deliveryのウィジェットの種類が`invisible`で`HASH_PEPPER`の登録先にclient・adminが含まれ、下流specの件名に日付を基準にした相対表現が無い
  - _Boundary: 下流specの設計_
  - _Requirements: 2.10, 2.14, 4.3, 5.7, 6.1, 6.3, 8.1, 8.6, 8.8, 8.13, 10.8, 11.4_

- [x] 10.5 セッションの有効期間の上限をAPIサーバーも検証することをフロントエンドの文書に書く
  - 前提: api-gatewayの11.1(`assertIssuable`の400日の上限)が完了していること。完了していなければ止めて報告する
  - `frontend/003`の「指示の解釈」に、APIサーバーも400日(34,560,000秒)を超える有効期間の発行を拒否し、フロントエンドの検査は契約に反する指示が届いた時の防御であることを書く
  - 完了状態: `frontend/003`の上限の記述が`MAX_SESSION_MAX_AGE_SECONDS`とapiの上限と一致し、プロジェクト名と固有値を含まない
  - _Depends: api-gatewayの11.1_
  - _Boundary: 技術ドキュメント群_
  - _Requirements: 2.7, 15.3, 15.4_

- [x] 10.6 Zodの設定をエントリの先頭で読み込む
  - 先に、client・adminの`test/config/entry-imports.unit.test.ts`(新規)で、ブラウザのエントリ`src/client.tsx`とサーバーのエントリ`src/server.ts`の最初のimportが`../lib/utilities/validation/zod.ts`の副作用の読み込み(束縛を持たない`import '…/zod.ts';`)で、他のどのモジュールの読み込みより先にあること、`vite.config.ts`の`tanstackStart()`がブラウザとサーバーのエントリ(`client.entry`・`server.entry`)を指定せず、Startの既定の名前で`src/client.tsx`・`src/server.ts`が使われることを確かめる単体テストを書く
  - `src/server.ts`の最初のimportに`import '../lib/utilities/validation/zod.ts';`を加える
  - TanStack Startの既定のブラウザのエントリには読み込みを足せないため、`src/client.tsx`(新規)を置き、最初のimportで`zod.ts`を読み込んだ後に、既定のエントリと同じく`startTransition`の中で`hydrateRoot(document, <StrictMode><StartClient /></StrictMode>)`を呼ぶ。Startが`src/client.tsx`をブラウザのエントリとして使うことをビルドの出力で確かめる
  - `frontend/003`のZodの節の「ESモジュールは依存を先に評価するため、この設定はすべてのスキーマより前に効く」を、`zod`を直接読むコード(共有ディレクトリなど)がある場合はブラウザとサーバーのエントリの最初のimportで設定の部品を読み込む規則に直す。`frontend/002`に、ブラウザのエントリの先頭に処理を加える場合は`src/client.tsx`を置き、既定のエントリと同じ描画の処理を書くこと、Startの版を上げる時は`src/client.tsx`をStartの既定のブラウザのエントリと見比べることを加える。プロジェクト名と固有値を含めない
  - 完了状態: client・adminのブラウザとサーバーのエントリで、`zod.ts`の読み込みが他のどのモジュールより先になることを確かめるテストが成功し、ビルド後のプレビューでCSPの違反(`securitypolicyviolation`)が出ず、両アプリの単体テストと一括検査が成功する
  - _Boundary: AppComposition, FrontendServerEntry, 技術ドキュメント群_
  - _Requirements: 4.2, 8.1, 12.6, 15.3, 15.4_

- [ ] 11. 最終検証後の第2回の判断の反映
- [x] 11.1 送信ボタンをサーバーの欄のエラーが残る間は無効にする
  - 先に、`form.browser.test.tsx`へ、サーバーの詳細が2つの欄に出た後に1欄だけ直してもボタンが`disabled`のままで、もう1欄も直すと有効になること、直した欄のサーバーのエラーの表示だけが消えること、利用側が`setError('root.<名前>')`で付けたエラーだけでは無効にならないことを確かめるブラウザテストを書き、失敗を確かめる
  - `SubmitButton`で`useFormState()`の`errors`も購読し、`root`を除く欄のエラーが1つでもある間(`hasFieldErrors`)を`(!isValid || hasFieldErrors) && !isSubmitting`の条件で`disabled`にする。送信中の`aria-disabled`・`aria-busy`は変えない。`AppForm`の処理(`applyServerFieldErrors`・`onSubmitError`の呼び出し)は変えない
  - `AppForm`のストーリーのサーバーのエラーの例と、`frontend/005`の`SubmitButton`の行(無効になる条件にサーバーの欄のエラーを加える)を直し、入力欄を描かない値(条件によって描かない欄を含む)をスキーマの入力(`TInput`)に含めず`onSubmit`で加えることを`frontend/005`のフォームの節に書く(`defaultValues`は型で全欄を求めるため、既定値から外すだけでは避けられない)
  - 水平展開: 下流specのdesign.mdに、入力欄を描かない値(条件によって描かない欄を含む)をスキーマの入力に含めるフォームの設計があれば、後続のタスクとして報告に挙げる(本タスクでは下流specを変えない)
  - 完了状態: 共通部品のブラウザテストと一括検査が成功し、サーバーの欄のエラーが1つでも表示されている間は送信ボタンが`disabled`で、`frontend/005`の`SubmitButton`の記述が実装と一致する
  - _Boundary: FormParts, 技術ドキュメント群_
  - _Requirements: 8.3, 8.5, 15.3, 15.4_

- [ ] 11.2 疎通確認の結果の見出しを実行した場所に合わせる
  - 先に、共通部品の`utilities/system/execution-site.unit.test.ts`(新規)で、`currentExecutionSite(scope)`が`document`を持たない値で`'server'`、持つ値で`'browser'`を返すことを確かめる単体テストを書き、`execution-site.ts`(`ExecutionSite`・`currentExecutionSite(scope = globalThis)`)を作る
  - 先に、`system-status-messages.unit.test.ts`へ`PAGE_LOAD_RESULT_HEADING`(「画面の読み込み時の結果」)と、3つの区画の見出しが互いに異なることを加え、`system-status-view.browser.test.tsx`へ、`initialExecutedOn`が`'server'`なら「サーバー側の描画時の結果」、`'browser'`なら「画面の読み込み時の結果」の区画に同じ中身(時刻・到達可否・失敗の文言)を出し、再確認の区画は変わらないことを確かめるブラウザテストを書く。`SystemStatusView`のpropsを`initial`・`initialExecutedOn`・`browser?`・`onRecheck`・`rechecking`にし、ストーリーにブラウザで実行した場合を加える
  - 先に、client・adminの`src/graphql/system-status.unit.test.ts`へ、`toSystemStatusLoaderData(result, executedOn)`が`{ executedOn, result }`(失敗はErrorを含まない形)を返し、`fromSystemStatusLoaderData`が実行した場所と`GraphQLClientError`を戻すことを、`system-status-page.browser.test.tsx`へ実行した場所の見出しを確かめる検査を書く。`routes/system/status.tsx`の`loader`が`currentExecutionSite()`を渡し、`SystemStatusPage`(`initial`・`initialExecutedOn`・`recheck`)が`SystemStatusView`へ渡すようにする
  - 文言規則(`service/design/003`)の「疎通確認の画面の文言」の区画の見出しに「画面の読み込み時の結果」を加え、`002-page-layouts.md`の疎通確認の節の「サーバー側の描画時の結果」の区画にブラウザの結果が出るとした箇条を、画面を表示した時の結果を実行した場所に合った見出しで示す記述に直す。`frontend/005`の疎通確認の節の`SystemStatusView`のprops(`server`を`initial`・`initialExecutedOn`にし、`browser`(省略可)・`onRecheck`・`rechecking`は残す)と、画面を表示した時の結果の区画の見出しを`initialExecutedOn`で切り替えることを直す
  - スモークテストはページを直接開くため、`e2e/support/system-status-page.ts`の区画の見出しは変えない。ビルド後のプレビューで、直接開いた時にサーバー側の見出しが出ることを確かめる
  - 完了状態: 共通部品の単体テスト・ブラウザテストとclient・adminの単体テスト・ブラウザテスト・スモークテストが成功し、文言規則と`002-page-layouts.md`の見出しが`system-status-messages.ts`の定数と一致し、`frontend/005`の`SystemStatusView`のpropsが実装と一致する
  - _Boundary: SystemStatusView, StatusRoute, 技術ドキュメント群_
  - _Requirements: 8.12, 12.1, 12.2, 12.3, 12.6, 15.3, 15.4_

- [ ] 11.3 Turnstileのスクリプトの読み込みの失敗をウィジェットの間で共有する
  - 先に、`turnstile-widget.browser.test.tsx`へ、偽物のウィジェットでスクリプトの読み込みの失敗を起こした後に、新しく置いたウィジェット・描き直した(`key`を変えた)ウィジェット・失敗の時に同じページに置いていた2つ目のウィジェットが、読み込みを待たずに失敗の文言を`role="alert"`で出し、`useTurnstileToken`の`status`が`'error'`になり、`Turnstile`の部品を描かないことと、判定の失敗(`error-callback`)は他のウィジェットへ広がらないことを確かめるブラウザテストを書き、失敗を確かめる。テストの間で記録が残らないよう、各テストの前に`resetTurnstileScriptFailure()`を呼ぶ
  - `components/bot-protection/turnstile-script-failure.ts`(新規、`recordTurnstileScriptFailure`・`hasTurnstileScriptFailed`・`subscribeTurnstileScriptFailure`・`resetTurnstileScriptFailure`)を作る。`TurnstileWidget`の`scriptOptions.onError`は記録だけを行い、`useSyncExternalStore`(サーバーの値は常に偽)で記録を読んで、記録がある間は`Turnstile`を描かず、記録を読んだ時に`onError()`を1回呼ぶ
  - 偽物(`test/fake-turnstile.tsx`)にスクリプトの読み込みの失敗を起こす手段が無ければ加え、Storybookのカタログの失敗の状態のストーリーが記録を消してから描くようにする
  - `frontend/005`のウィジェットの節の「スクリプトの読み込みの失敗を検知できるのは最初に描画したウィジェットだけ」の箇条を、失敗をページの中のすべてのウィジェットで共有し、後から置いた・描き直したウィジェットもすぐ失敗の文言を出す記述に直す
  - 完了状態: 共通部品のブラウザテスト・単体テストと一括検査が成功し、スクリプトの読み込みの失敗の後に`idle`のまま止まるウィジェットが無く、`frontend/005`の記述が実装と一致する
  - _Boundary: TurnstileWidget, StorybookCatalog, 技術ドキュメント群_
  - _Requirements: 8.8, 8.9, 8.11, 15.3, 15.4_

- [ ] 11.4 写しを元と照合する単体テストを足す
  - 先に、ルートの`config/contract-copies.unit.test.ts`(新規)を書き、元か写しの片方だけを変えると失敗することを、一時的に写しの値を1つ変えて確かめてから戻す。方式と対象は設計の「決定事項」の「写しの照合テスト」のとおりで、他のアプリのファイルを静的にも動的にもimportしない
    - 定数は既存の`config/inspector-ports.unit.test.ts`と同じく、`readFileSync`で読んだソースを`typescript`の`ts.createSourceFile`で構文解析し、名前で探した宣言の初期化子から値を取り出す。`Object.freeze(…)`・`as const`・`satisfies`を外し、オブジェクトリテラル・文字列リテラルの配列・数値リテラル(区切りの`_`を除く)・文字列リテラル・正規表現リテラル・文字列リテラルの配列の`.join(<区切り>)`を値にし、それ以外の形や宣言が見つからない場合は名前とファイルを示す例外で失敗させる
    - 中継の契約: `apps/frontend-lib/server/relay/relay-contract.ts`の`RELAY_REQUEST_HEADERS`・`GATEWAY_CALLER_HEADERS`(`apps/api/src/presentation/gateway/gateway-headers.ts`の`GATEWAY_HEADERS`の対応する項目)、`SESSION_INSTRUCTION_HEADERS`(`SESSION_RESPONSE_HEADERS`)、`SESSION_CLEAR_VALUE`(`apps/api/src/presentation/gateway/session-access.ts`の公開されていない`CLEAR_HEADER_VALUE`)、`SESSION_TOKEN_PATTERN`・`MAX_SESSION_MAX_AGE_SECONDS`(`apps/api/src/application/session/session-verifier.ts`の同名の値)
    - エラーコード: `apps/frontend-lib/utilities/graphql/graphql-result.ts`の想定外の失敗のコードのうちapiの写しの部分を、`GATEWAY_ERROR_CODES`という名前の文字列リテラルの配列の宣言に分け(公開しない)、想定外の失敗のコードをこの写しとフロントエンドだけの4つのコードから作る。`apps/api/src/presentation/graphql/error-codes.ts`の`GATEWAY_ERROR_CODES`と要素の集合で比べ、`graphql-result.unit.test.ts`の`expected`の検査が変わらず成功することを確かめる
    - セキュリティヘッダー: `apps/frontend-lib/server/http/security-headers.ts`の`BASE_SECURITY_HEADERS`を`apps/backend-lib/workers/http/security-headers.ts`の`SECURITY_HEADERS`のPermissions-Policy以外の項目と、`apps/frontend-lib/server/http/security-policy.ts`の`PERMISSION_FEATURES`を`SECURITY_HEADERS`のPermissions-Policyの配列の各要素から`=()`を除いた並びと、`NON_PAGE_CONTENT_SECURITY_POLICY`を`DEFAULT_CONTENT_SECURITY_POLICY`(配列の`.join('; ')`)と比べる
    - 伏せ字: `apps/frontend-lib/server/observability/logging.ts`の`REDACTED_FIELD_PATTERNS`、`apps/frontend-lib/utilities/observability/redaction-patterns.ts`の`REDACTED`・`REDACTION_PATTERNS`とパターンの宣言(`API_KEY_PATTERN`・`BEARER_TOKEN_PATTERN`・`IPV4_OCTET`・`IPV4_PATTERN`・`H`・`IPV6_PATTERN`・`LIBRARY_CREDIT_CARD_NUMBER_REPLACEMENT`・`libraryCreditCardReplacement`・`CREDIT_CARD_PATTERN`)を、`apps/backend-lib/core/logging/redaction.ts`の同名の宣言と、`ts.createPrinter`で出力し直した初期化子の文字列で比べる。正規表現リテラルのフラグと`new RegExp`の第2引数の`u`だけは除いて比べる
    - レート制限のキーのハッシュ化: 子プロセスの`bun --eval`(`process.execPath`)で、`apps/frontend-lib/server/http/rate-limit-key-hash.ts`の`hashRateLimitKey(pepper, ...parts)`と、`apps/backend-lib/core/rate-limit/rate-limit-key.ts`の`hashRateLimitKey(createKeyedHasher(pepper), ...parts)`(`apps/backend-lib/core/crypto/keyed-hasher.ts`)を、同じペッパーと複数の入力(`ip:<IPv4>`・`ip:<IPv6>`・`ip:unknown`・複数の部品・非ASCIIの部品)で実行し、標準出力のJSONを比べる。入力は環境の変数でJSONとして渡し、終了コードが0でなければ標準エラー出力を添えて失敗させる。評価するコードはテストの中の文字列にし、ルートの型検査の対象に入れない
  - 写しの側のコメント(`relay-contract.ts`・`rate-limit-key-hash.ts`・`logging.ts`の`REDACTED_FIELD_PATTERNS`・`redaction-patterns.ts`・`security-policy.ts`)を、元の場所と照合テストの名前を示す形に直す。`testing/001`に、アプリ間で値を写した箇所は写しと元のソースを構文解析で読んで照合する単体テスト(実行して求める値は子プロセスで両方を実行して比べる)をルートに置き、ルートの型検査とカバレッジの分母に他のアプリのファイルを入れないことを、プロジェクト名と固有値を含めずに書く
  - 完了状態: ルートの`bun run typecheck`・`bun run test:unit`・`bun run test:unit --coverage`と`bun run check`が成功し、ルートのカバレッジの出力に他のアプリのファイルが含まれず、5つの照合のどれも写しの値を1つ変えると失敗することを確かめられ、`testing/001`に照合テストの規則が載っている
  - _Boundary: ContractCopies(ルートの単体テスト), GraphqlResult, RelayCore, SecurityHeaders, FrontendLogging, SentryScrub, RateLimitKeyHash, 技術ドキュメント群_
  - _Requirements: 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 4.4, 5.7, 6.6, 13.3, 13.8, 15.2, 15.3, 15.4_

- [ ] 11.5 文書とモックアップを直す
  - 判断18: `002-page-layouts.md`の管理者側の基本レイアウトの節に、管理者側のページは検索の対象外のため正規のURLを出さないことを書く(要件・設計は本改訂で反映済み、実装は変えない)
  - 判断20: `mockups/src/styles.css`のダークの`--destructive`を`oklch(0.64 0.2 25)`にし、`mockups/src/components/ui/button.tsx`のdestructiveに`dark:hover:bg-destructive/50`、`badge.tsx`のdestructiveに`dark:[a&]:hover:bg-destructive/50`を加えて実装の`button-variants.ts`・`badge-variants.ts`とそろえる。`001-design-principles.md`の「デザイン案の`oklch(0.6 0.2 25)`より明るい`oklch(0.64 0.2 25)`とする」と「赤を明るくした分」の箇条を、デザイン案と実装がともに`oklch(0.64 0.2 25)`で、その理由(コントラスト比AA)とダークのホバーを不透明度50%にする理由を述べる形に書き換え、変更前の値と経緯を残さない
  - 判断22: 本specの`research.md`の「GraphQLのクライアント側のコード生成」の記述(137〜139行付近)を、操作とフラグメントを`src/graphql/operations/**/*.graphql`に置き`graphql()`を呼ばず、画面は`src/graphql/generated/graphql.ts`の`<操作名>Document`を読む現在の形に書き換える。research.mdの他の箇所にも`graphql()`で操作を書く古い形があれば同じく直す
  - `infra/004`のトレースの節と個人情報と秘密情報の除去の節に、バックエンドにも当てはまる注意として、Wrangler設定の`vars`に`SENTRY_TRACE_LIFECYCLE`を定義しないこと(`@sentry/cloudflare`は`traceLifecycle`を指定しなければこの変数を読む)と、`beforeSendSpan`が`null`を返しても例外を投げても元のスパンが除去されずに送られることを書く。`frontend/007`の「逐次送信のスパンの注意」と食い違わず、プロジェクト名と固有値を含めない
  - `project-values.md`の「記載している見出し」の列を、各プレースホルダーを`docs/GUIDES/tech`で検索して現れるすべての見出し(本spec以前からの漏れを含む)にする。見出しのアンカーは実在の見出しから作る
  - `docs/ai-prompts/008-create-mockup-client-directory.md`の`002-page-layouts.md#ディレクトリ`を、実在の見出し「ディレクトリ(`/p`)」のアンカー`#ディレクトリp`に直す
  - 完了状態: ルートの整形検査が成功し、モックアップと実装のダークの`--destructive`とdestructiveのホバーが一致し、`001-design-principles.md`に食い違いの記述が無く、research.mdに`graphql()`で操作を書く形が無く、`project-values.md`の各プレースホルダーの見出しの列に`docs/GUIDES/tech`の出現箇所の見出しがすべて載り、`docs/ai-prompts/008`のアンカーが実在の見出しを指す
  - _Boundary: 技術ドキュメント群, ServiceDocs, モックアップ_
  - _Requirements: 7.1, 10.3, 11.9, 15.3, 15.4, 15.6_

- [ ] 11.6 下流specを直す
  - 判断15(legal-pages): requirements.mdの要件10.5(文書への反映)に、公開前にプライバシーポリシーの本文がCloudflareのTurnstile Privacy Addendumを参照していることを確かめ、無ければプライバシーポリシー骨子のCloudflareの項に参照を加えることを足し、design.mdのModified Filesと文書の節、tasks.mdの文書のタスクに同じ項目を加える
  - 判断15(infra-delivery): `design.md:284`(Cloudflareの項のbot判定)・`tasks.md:250`(8.5のbot判定の箇条)・`research.md:147`(付随する記述)からTurnstile Privacy Addendumの記述を外す。ウィジェットの種類を`invisible`にすることと`HASH_PEPPER`の登録先にclient・adminを含めることは残す。research.mdの「変えた箇所」にModified Filesのプライバシーポリシー骨子の記述があれば合わせる
  - 判断21(ugc-moderation): `design.md:1208`の`adminProductCategories: [AdminCategoryRef!]!`を`adminModerationCategoryOptions: [AdminCategoryRef!]!`にし、`design.md:1285`(`ProductFilters`のカテゴリの選択肢)・`tasks.md:181`(Workers統合テストの照会の一覧)・`research.md:220`の照会名、管理者側の操作名(`Admin`の接頭辞の操作)と生成物の型の名前、照会の表の行・使用箇所を同じ名前に合わせる。product-launchの`adminProductCategories: [ProductCategory!]!`(`design.md:1912`・`design.md:1941`)は変えない
  - 本specのdesign.mdの「実装で確定した契約による発火と影響を受ける下流spec」の表の第2回の2行の「該当箇所」を、改訂後の位置に更新し、表の前置きの「末尾の2行は11.6で合わせるまで食い違いが残る」の文を消す
  - 完了状態: infra-deliveryのdesign.md・tasks.md・research.mdにAddendumの記述が無く、legal-pagesの要件・設計・タスクにAddendumの参照を確かめる項目があり、ugc-moderationに`adminProductCategories`の照会の定義と使用が無く、`adminModerationCategoryOptions`の名前・型・使用箇所がそろっている
  - _Boundary: 下流specの設計_
  - _Requirements: 6.1, 6.4, 8.8_

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
- 3.8(3.11・5.5への申し送り): `resolveRequestDisplayPreferences({ cfTimeZone, acceptLanguage })`は入力の`cfTimeZone`を`unknown`で受けるため、`request.cf?.timezone`の構造的な読み取りは3.11で行う。`Accept-Language`は最初の1024文字・32要素(設計に無い公開の定数`MAX_ACCEPT_LANGUAGE_LENGTH`・`MAX_ACCEPT_LANGUAGE_ENTRIES`)までを読み、上限で切れた要素は使わない。q値の降順(同値はヘッダー順)で`supportedLocaleOf`が通す最初のタグを使い、`q=0`・`*`・不正な要素・不正なq値・q以外の引数を持つ要素は除く(RFC 9110の文法による解釈)。`ja-JP-u-ca-japanese`(和暦)や`en-US-u-nu-arab`(アラビア数字)のようなUnicode拡張・私用の部分は通るため、拡張を落とすかは5.5で判断する(送った本人の画面に限られ、ブラウザの`resolvedOptions().locale`と食い違うとマウント後に整形し直す)。
- 3.9(3.10・3.11・9.4・9.6への申し送り): 設計からの相違は、`FrontendLoggingOptions.sink?: Sink`を`console?: Console`に(Sinkを差し替えると整形と値の伏せ字を飛ばすため。backend-libと同じ。3.11の`FrontendServerEntryOptions`も`console?: Console`にする)、`logAccess(record)`を`logAccess(caller, record)`に、設計に無い`withCorrelationId(correlationId, callback)`を追加、`REDACTED_FIELD_PATTERNS`の型を凍結した`readonly FieldPattern[]`に。`REDACTED_FIELD_PATTERNS`・`toLogObject`・`serializeError`はbackend-libの`core/logging/redaction.ts`・`log-record.ts`の写しで、片方を変えたらもう片方も見直す。`node:async_hooks`は互換性日付2026-08-04から`nodejs_compat`が既定で有効になるため`compatibility_flags`無しで使える(wrangler 4.124.0の`NODEJS_COMPAT_DEFAULT_ON_DATE`)。3.11は`withCorrelationId`より前に`ensureFrontendLoggingConfigured`を呼び(設定前は文脈が付かない)、プロファイルの`caller`を設定と`logAccess`の両方に使う(違う`caller`のログは捨てられる)。不正なレベルは`info`として扱う。アクセスログは`info`のため、`LOG_LEVEL`を`warning`以上にすると要件13.8の「要求ごとに」を満たさない(設計の環境の表はstaging・prodを`info`に固定)。9.4・9.6で「`LOG_LEVEL`は`info`以下にする」と書く。アクセスログの属性`outcome`はinfra/004の処理単位の終わりのログの表に無いため9.4で加える。
- 3.10(3.11・4.3・6.3・7.3への申し送り): Sentry 11.4.0に`sendDefaultPii`は無く、`withSentry`の戻り値の型`StrictCloudflareOptions`は未知のキーを`never`にするため、設計の`ServerSentryOptions.sendDefaultPii: false`(1125行)は型検査を通らない。個人情報を既定で送らないことは`dataCollection: SENTRY_DATA_COLLECTION`で満たす(`userInfo: false`でIPアドレスの自動収集も止まる)。設計の改訂候補で、4.3のブラウザ側(`@sentry/tanstackstart-react`、設計1376行)も同様に確かめる。設計616行の`buildServerSentryOptions(env, PROFILE)`はInterfaceの`(env)`と食い違い、Interfaceに従った。6.3・7.3は`withSentry((env) => buildServerSentryOptions(env), ...)`で渡す。環境の検証に失敗するとDSNがあっても`enabled: false`(`environment: 'unknown'`・`tracesSampleRate: 0`)で、環境の不備の500はSentryへ送られずキー名のログだけが残る(backend-libは環境を検証せず送る)。
- 3.11(4.1・4.2・6.3・7.3・9.xへの申し送り): 順序は`createFrontendServerEntry`の`fetch`(ログの設定→`withCorrelationId`→`handleSafely`→`applySecurityHeaders`→`logAccess`)と`handle`(環境の検証→許可先の合成1回→IP制限→CSRF→`/_bff/`の振り分け→描画)の1箇所。設計との相違は、`FrontendServerEntryOptions`が`console?: Console`を受ける、`FrontendRequestContext.sessionCookieName`が`SessionCookieName`型、設計のMonitoringに無い`[caller, 'http', 'error']`の`error`ログ(想定外の例外と、送信の失敗の`errorName`だけのログ)、`LOG_LEVEL`は環境の検証より前に生の環境から読む、`ctx`(`waitUntil`)は未使用、Sentryのタグ`correlation_id`は付けない(手段が無い)。`reportUnexpected`は`guardReporter`で包み、送信が例外を投げても500・503とヘッダー・アクセスログを返す(送り直さない)。CSPは描画の応答の`Content-Type`が`text/html`の時だけページのCSPで、それ以外とJSON(中継・403・404・429)はページ以外のCSP。429の静的な画面はページのCSP(`<style>`が効く)、環境の不備・許可先の不正・例外の500はページ以外のCSP(`<style>`は遮断)とすべて拒否のPermissions-Policyで、prodの利用者側でも`X-Robots-Tag`を付ける。環境の不備でも`reportUnexpected`を呼ぶが、3.10のとおり環境が不正だとSentryは無効なので実際には送られない。`outcome`はIP制限・CSRF・未登録の`/_bff/`が`rejected`、中継が`relay`、描画が`page`、500が`static_error`。ストリームの応答の`durationMs`はヘッダーを返すまでの時間。4.1は描画の文脈の`relay`(セッション識別子)と`api`を`AppRuntime`やdehydrateされる値へ入れず、テストで確かめる。6.3・7.3の`composition.unit.test.ts`は`mergeSecurityPolicySources(BASE_SECURITY_POLICY_SOURCES, securityPolicy)`が通ることを確かめる(不正なら全要求が500)。テストの共通の偽物は`test/server-entry-fixtures.ts`。
- 4.1(設計の相違と4.2・4.3・5.x・6.3・7.3への申し送り): 親の判断で、サーバーでは取得を再試行しない(`createAppQueryClient({ isServer })`、省略時は`environmentManager.isServer()`)。設計のQueryDefaults(1316行)は`retry: shouldRetryQuery`だけだが、描画中に中継の15秒の時間切れを2回再試行すると最悪で約48秒遅れ、要件14(FCP 1.6秒)に反するため(TanStack Queryもサーバーでは既定で再試行しない)。ブラウザでは`shouldRetryQuery`の方針のまま。`dehydrateAppRuntime`は中でも`toAppRuntime`を通し`{ publicConfig, display }`だけを返す(HTMLへの書き出しのエスケープはTanStack Routerのseroval)。`createFrontendStartOptions`の戻り値は推論の型(設計の`Parameters<typeof createStart>[0]`だとミドルウェアのタプルの型が失われる)。設計に無い`toAppRuntime`・`DehydratedAppRuntime`・`QUERY_STALE_TIME_MS`・`MAX_QUERY_RETRIES`・`AppQueryClientOptions`を公開した。`request-context.server.ts`は`getGlobalStartContext`の型が未登録で`undefined`のため型の無い値として読み、nonceの形を実行時に確かめる。6.3(または共通部品)で`declare module '@tanstack/react-start' { interface Register { server: { requestContext: FrontendRequestContext } } }`を登録すると型が付く(登録したら`request-context.server.ts`のコメントと読み方を直す)。TanStack側のCSRFの拒否は素の`Forbidden`(403)だが、エントリが先に`csrf_rejected`で拒否するため通常は届かない。TanStackのViteプラグインの無い環境(Vitestのブラウザテスト)では`createIsomorphicFn`がサーバーの分岐を実行するため、5.xの部品のテストから`start/request-context.ts`を読み込まない。`@tanstack/react-router-ssr-query`は未導入(6.1で入れる)。`.server.ts`の単体テストは無く、6.5のビルドとスモークで確かめる。
- 4.2(設計の相違と4.3・5.x・6.x・8.3・9.xへの申し送り): サーバー側の`executeGraphQLOnServer`は、ブラウザと同じ要求(`buildGraphQLRequest`)を組み立てて3.7の`relayToApi`へ渡す(項目・待ち時間・503・Cookieの指示の解釈を共通化)。Cookieの指示は設計(1282行)の`setCookie`・`deleteCookie`ではなく、中継の`Set-Cookie`を`getResponseHeaders().getSetCookie()`と合成して`setResponseHeader`で付ける(属性の組み立てを`buildSessionSetCookie`の1か所に保つ。他のCookieは残し、セッションの指示は最後の1件)。h3は描画の処理が戻った後に応答の項目を合成し、それ以降の書き込みは黙って消えるため、設計に無い`start/response-commit.ts`の`responseCommitMiddleware`(`WeakSet`で要求ごと)を`start-options.ts`の3つ目の要求のミドルウェアに加え、印の後に届いた指示は`[caller, 'relay', 'session']`の警告(`reason: 'response_committed'`)で捨てる。1回の描画の中で先の取得がセッションを発行・削除しても、後の取得は古い`context.relay.sessionToken`を送る(最後の指示が勝つ。9.3に書く)。`FrontendRequestContext`に設計(598行)に無い`caller`・`reportUnexpected`を加えた(dehydrateされない)。`relay-contract.ts`に`GRAPHQL_RELAY_PATH`・`GRAPHQL_UPSTREAM_PATH`を加え、3.7もこれを使う(ブラウザのバンドルに中継の処理を入れないため)。ブラウザ側は`browser-transport.ts`(`executeGraphQLInBrowser`・`executeGraphQLWithGlobalFetch`)で、呼び出し元の中断は`network_error`にせず中断の理由で失敗させる。サーバー側は`signal`を使わず中継の15秒に任せる。`execute-graphql.ts`の同型の関数は型引数を持てないため型を外して分岐する。設計に無い公開: `buildGraphQLRequest`・`FetchFunction`・`AnyPersistedDocument`・`GRAPHQL_REQUEST_CONTENT_TYPE`・`GRAPHQL_REQUEST_ACCEPT`・`graphqlMutationOptions`(`mutationKey: [documentId]`)・`GraphQLMutationInput`・`mergeSessionSetCookies`・`readFrontendRequestContext`。`start/graphql/execute-graphql.server.ts`は別のディレクトリの`start/request-context.server.ts`を読み込み、設計のDependency Direction(134行)の「同じディレクトリから」と文言が合わない(サーバー専用同士で害は無い。9.xか設計で直す)。4.3への申し送り: サーバー側の送信は中継と同じ上流に届かなかった失敗だけで、`requireData`の`GraphQLClientError`(`upstream_unavailable`)が`defaultOnCatch`などから別に送られると二重になるため、4.3で送信元を一方に絞る。サーバー側はBun上の`requestHandler`と`runWithStartContext`で単体テストする(共通の偽物`test/start-request-fixtures.ts`)。`runWithStartContext`は未宣言の`@tanstack/start-storage-context`(1.167.36、`@tanstack/react-start`が完全固定で依存)をテストの補助からだけ読み込む。`start/**`・`test/**`のテストは`@tanstack/`を実行時に読める。
- 4.3(設計の相違と5.8・6.3・7.3・後続spec・9.4への申し送り): `reportRenderError(router: RenderErrorRouter, error)`は`router.state.matches`のどれかの`error`と同一の例外を送らない(ハイドレーションで`ShallowErrorPlugin`がメッセージだけの`new Error`に復元したloaderの失敗が、二重・想定内でも送られるのを防ぐため。設計1212行の`defaultOnCatch: reportRenderError`と1343行の署名からの相違)。6.3・7.3は`createRouter({ ..., defaultOnCatch: (error) => { reportRenderError(router, error); } })`(ブロック本体で循環推論を避ける)。ルーター全体の`defaultOnError`は無く`onError`は子に継承されないため、`loader`・`beforeLoad`を持つすべてのルート(6.x・7.x・後続spec)に`onError: (error) => { reportUnexpectedError(error, 'loader'); }`を付け、6.3・7.3は`router.routesById`を走査するテストか`router.tsx`の1か所で補う仕組みで強制する(無いとGraphQL以外のloaderの失敗がどこからも送られない)。5.8のAppDocumentはマウント後に`initBrowserObservability({ router, config: runtime.publicConfig.sentry, queue: browserErrorQueue })`を呼ぶ。`loadBrowserSentryModules`は`createClientOnlyFn`で包み、サーバーのビルドでは例外を投げる関数に置き換わって`@sentry/node`の動的importが落ちる(6.5のビルドでWorkerに`@sentry/node`が入らないことを確かめる)。読み込みは`load?: () => Promise<{ sdk, scrub }>`(設計の`loadSdk`)で、`sentry-scrub.ts`もSDKと一緒に遅延で読む。`isExpectedFailure`は`graphql-result.ts`へ移し`sentry-scrub.ts`から再エクスポート(主バンドルに伏せ字のパターンを入れないため。設計の改訂候補)。ブラウザ側も`sendDefaultPii`は無く`dataCollection`で代替。`upstream_*`の失敗は中継だけが送り、サーバー・ブラウザの`isReportableFailure`は除く。同じオブジェクトの2回目は`WeakSet`で除く。`executeGraphQL`(4.2)は想定外の失敗を送るようになりasync。ブラウザは`network_error`を最大2回再試行するため1つの取得で最大3件送られ得る(9.4に書く)。サーバー側の送信は描画の文脈の`reportUnexpected`(`guardReporter`で包まれた関数)と`[caller, 'http', 'error']`のerrorログ(属性`source`)。読み込み・初期化の失敗は再試行せず`console`にも出さない。テストは未宣言の`seroval`・`@tanstack/router-core/ssr/client`を直接読む(Routerの版を上げたら見直す)。
- 4.4(設計の相違と5.8・6.3・6.5・7.5への申し送り): `buildPageHead`の`canonicalUrl`は`/`で始まる同じオリジンのパスだけを受け、クエリとフラグメントを除き、絶対URLや外部を指し得る値ではcanonicalを付けない(設定にサイトのオリジンが無いため。設計の引数名からは絶対URLも受けると読めるため相違として記録し、サイトのオリジンが設定に入った時に見直す)。戻り値は設計どおり`readonly`の配列で、TanStack Routerの`head`へはそのまま返すとTS2322になるため`{ meta: [...h.meta], links: [...h.links] }`のように広げて渡す(`webAnalyticsHeadScript`は`scripts: [s]`でそのまま通る)。タイトルは`<ページ名> | <サイト名>`で、ページ名が空ならサイト名だけ。`robots`のmetaの値`NO_INDEX_ROBOTS_CONTENT`は3.4の`X-Robots-Tag`の値の写し。`installPreloadRecovery`の印は`sessionStorage`のキー`ls-preload-reloaded`(設計1721行)で、タブを開いている間残るため、同じタブで後の別のデプロイの失敗はこの仕組みでは復旧しない(経路の部品はTanStackの`lazyRouteComponent`のメッセージごとの印で補われる)。`preventDefault`しないため、エラー画面と`reportRenderError`にも読み込みの失敗が届き得る。5.8は`window.sessionStorage`の参照自体を`try`で包み、例外なら`storage: undefined`を渡す。6.3はWeb Analyticsの`script-src https://static.cloudflareinsights.com`・`connect-src https://cloudflareinsights.com`を登録箇所に加える。
- 5.1(5.x・6.x・7.x・9.2への申し送り): 部品は`components/ui/<部品>/<部分>.tsx`(1ファイル1コンポーネント、他は型だけ)、見た目の種類は`*-variants.ts`。モックアップから`outline-none`を外した(Tailwind v4の`outline-none`はユーティリティ層で`base.css`の`:focus-visible`の輪郭を打ち消すため)。フォーカス時は半透明のリングと実線の輪郭が重なる。9.2の文書に「部品で`outline-none`を付けない」と書く。`vitest.browser.config.ts`に`optimizeDeps.include`(react・react-dom/client・vitest-browser-react・radix-ui・lucide-reactなど)を加えた(無いと最初の実行で事前バンドルがやり直されReactが二重に読み込まれる)。6.1・7.1のブラウザテストの設定にも同じ指定が要る。Radixのラジオ・タブ・メニューの矢印キーは押している間に移ったフォーカスで選ぶため、テストは`{ArrowDown>}`で押したままフォーカスの移動を待つ補助を使う。ボタン・バッジはモックアップどおり`whitespace-nowrap`で、9.9は伸長で満たす(320pxで極端に長い訳文は親からはみ出し得るため、6.4の320pxのテストと9.2で長文には`whitespace-normal h-auto`を付ける使い方を案内する)。Skeletonは`aria`を持たず、読み込み中の通知は5.4の`LoadingSkeleton`が担う。props型は名前付きのinterface。`test/computed-style.ts`は`styles/base.browser.test.ts`の関数と重複する。設計の部品の表(500行)はUiPrimitivesを7.1・9.9・10.1・10.2に対応させる(tasksは10.3、10.2は5.2の役目)。
- 5.2(設計・モックアップの相違と5.x・6.x・7.x・9.2への申し送り): 親の判断で、ダーク配色の`--destructive`をモックアップの`oklch(0.6 0.2 25)`から`oklch(0.64 0.2 25)`に変えた(ダークの削除用メニュー項目の文字が4.09:1でAA未達だったため。1.3の「モックアップの値をそのまま移植」からの相違で、9.2・9.5に理由とともに書く。モックアップ側も合わせるかは開発者の判断)。明るくした結果のホバーの後退は、Button・Badge(リンク)のdestructiveにダーク専用の`dark:hover:bg-destructive/50`を加えて直した。フォーカス中の削除用メニュー項目は文字色を`text-popover-foreground`にし(着色の背景と輪郭は残す)、破壊的な操作であることは文言で示す(色だけに頼らない)。実測(ライト/ダーク): メニュー削除 通常4.76/4.84・フォーカス15.02/13.05、Button destructive 通常4.76/7.82・ホバー4.53/9.58(ライトのホバーは5.1から不変で余裕が小さい)。非選択のタブの文字色を`text-foreground/60`から`text-muted-foreground`に(ライトでAA未達)。5.1の申し送りを広げ、輪郭を消す・上書きするクラス(`outline-none`・`outline-hidden`・`focus-visible:outline-1`など)をすべて付けない(9.2に書く)。テストの補助は`test/keyboard.ts`の`pressKeyUntilFocusMoves`(Radixの矢印キー)、`test/reduced-motion.ts`の`emulateReducedMotion`、`runAxe`は終わりのある動きの終了を待ってから検査する(止まった有限の動きがあるとテストのタイムアウトまで待つ)。視差効果を減らす設定の真似は検査のテストではしない(Chromiumで配色の切り替えの途中の色が残るため)。モーダルなメニューを開くと外側の`aria-hidden`の要素を`aria-hidden-focus`として数えるため、メニューのaxeは閉じた状態の`container`と開いたメニューごと(`runAxeOnOpenMenus`、0件なら失敗)に検査する。Radixのシートの自動フォーカスはリンクを飛ばす。ポップオーバーは`modal`の指定が無いと閉じ込めない。モックアップの`PopoverTitle`の型を`'div'`に合わせた。
- 5.3(設計の相違と5.1・4.3・9.2・9.3・9.5への申し送り): `useAppForm`の型引数は設計の`<TSchema>`ではなく`<TInput, TOutput>`(`z.input<TSchema>`が型検査を通らないため。呼び出し方は同じ)で、`defaultValues`は全欄必須(サーバーの詳細は既定値に経路がある欄にだけ対応するため)。規則に文言の無いZodのエラーは「入力内容を確認してください。」(Zodの英語の既定を見せない)。`AppForm`に設計に無い必須の`onSubmitError`(欄に対応しない詳細と想定外の失敗を受ける。想定外の失敗をSentryへ送るかは利用側の責任で、9.3に書く)と`serverFieldPrefix`(`input.`などの接頭辞を外す)を加えた。`onSubmitError`自体の例外は`globalThis.reportError`へ渡す(Sentryの初期化前の失敗は失われる。確実に送るなら4.3の`ReportSource`の追加を検討)。送信ボタンは未入力・検証エラーの間は`disabled`、送信中は`aria-disabled`・`aria-busy`・「送信中」(Chromiumは送信中に`disabled`になったボタンのフォーカスを`<body>`へ移して戻さないため)。重ねての送信は`submittingRef`で止める。このため5.1の`button-variants.ts`に`aria-disabled:pointer-events-none aria-disabled:opacity-50`を加えた(全Buttonに効く。`aria-disabled`のButtonを直接`TooltipTrigger asChild`にするとホバーでツールチップが開かない、`asChild`のリンクに`aria-disabled`を付けるとクリックは止まるがEnterでは移動する。9.2で案内する)。設計どおり`!isValid`で無効化するため、サーバーのエラーが複数の欄に出た後に1欄だけ直すと残りの欄のエラーを表示したままボタンが有効に戻り得る(9.3に書く)。必須の印は自動で付けず、必須の欄はラベルか説明の文言で示し`aria-required`を渡すよう9.2で案内する。新しい文言「入力内容を確認してください。」「送信中」を9.5で文言規則に加える。`vitest.browser.config.ts`の事前バンドルに`react-hook-form`・`@hookform/resolvers/zod`・`zod`を加えた(6.1・7.1も同じ)。`app-form.tsx`の分岐カバレッジは78.57%(行・関数は100%)。
- 5.4(設計の相違と5.8・6.x・9.2・9.5への申し送り): 固定の文言は設計に無い`utilities/messages/state-messages.ts`に置き、`server/http/error-responses.ts`は`UNEXPECTED_ERROR_MESSAGE`をそこから読み込んで再エクスポートする(`components/**`は`server/**`の値を読めないため。静的なエラー画面と画面内の表示で同じ定数)。文言規則の表に無い「ページを表示できませんでした。…」(`UNEXPECTED_ERROR_MESSAGE`)・「読み込み中」・「再試行」・「お問い合わせ」・トーストの領域の名前「通知」を9.5で加える。問い合わせと404の導線は通常の`<a href>`(設計の`contactHref`が文字列のため。クライアント側の遷移はしない)。`NotFoundView({ links: { href, label }[] })`の型、`LoadingSkeleton`の`label`と形状、`EmptyState`の`description`・`action`の省略と`headingLevel?: 2〜6`(指定時は`section`+見出し+`aria-labelledby`)は設計に無い追加。sonnerはトーストに`role`を付けずエラーも丁寧な通知(要件8.7・設計どおり。急ぐ失敗は`ErrorState`・フォームの`role="alert"`で示し、トーストは結果の通知に使う使い分けを9.2に書く)。sonnerはどのレイヤーにも属さないCSS(`[data-sonner-toast]{outline:0}`)を差し込み`base.css`の輪郭を打ち消すため、`toastOptions.classNames.toast`に`!important`付きの`focus-visible:`の輪郭を付けた(Tailwindで上書きするには`!important`が要る。9.2に書く)。`vitest.browser.config.ts`の事前バンドルに`sonner`を加えた(6.1・7.1も同じ)。
- 5.5(設計の相違と2.2・3.8・5.8・5.9・6.x・9.3・9.5への申し送り): `DisplayPreferencesProvider`はReact Context(Jotaiのatomは定義しない)と`useSyncExternalStore`で、SSRとハイドレーションはサーバーの値、ハイドレーションの後にブラウザの値が違う時だけ切り替える。ブラウザで新しく描画する時は最初からブラウザの値を使う(アプリのルートは常にハイドレーションされるため動作は同じ。5.9のStorybookで固定の表示設定を渡してもブラウザの値で上書きされるため、5.9で扱いを決める)。ブラウザの値は`initial`のオブジェクトをキーにしたモジュール単位の`WeakMap`で保持する(表示中にOSのタイムゾーンを変えても再読み込みまで反映しない)。ストリーミングの描画でまだハイドレーションしていないSuspenseの区画があると、切り替えでその区画がクライアントでの描画に変わる可能性があるため、6.xのE2Eで確かめる。`RelativeTime`は共有の時計(タイマー1つ、最後のアンマウントで停止、初期値0で読み取り時に進める)で、相対表現はハイドレーションの後に現れるためその分レイアウトがずれる。`NumberText`は`<span>`で包む。設計に無い`toDateTimeValue`(`utilities/datetime/date-time-value.ts`)は時差付きのISO文字列か有効な`Date`だけを受け、時差の無い文字列などは`RangeError`(描画中の例外として近くのエラー境界へ。9.3に書く。frontend/001の「日時の表示」は入力の制約に触れていない)。2.2の`supportedLocaleOf`はUnicode拡張と私用の部分を落とすようにした(`ja-JP-u-ca-japanese`は`ja-JP`。3.8のサーバー側の推定にも効く)。`formatDateTime`・`formatNumber`は表示設定のオブジェクトごとに`WeakMap`で`Intl`を使い回す。テストの補助は`test/display-emulation.ts`(CDPの`Emulation.setTimezoneOverride`・`setLocaleOverride`)、テスト内で`act`を直接呼ぶ時は`IS_REACT_ACT_ENVIRONMENT`を設定し直す(`vitest-browser-react`の`render`が`false`に戻すため)。`vitest.browser.config.ts`の事前バンドルに`react-dom/server`を加えた。
- 5.6(設計の相違と5.8・5.9・6.4・8.x・9.x・開発者への確認事項): 使い方は`const t = useTurnstileToken(); <TurnstileWidget {...t.widgetProps} action="..." />`、送信時に`t.consume()`を`ExecuteOptions.turnstileToken`へ渡す(`consume()`は1回だけ返して`reset()`、期限切れも`reset()`、`refreshExpired: 'never'`)。設計(1514〜1527行)に無い`TurnstileWidgetProps`の必須の`status`・`widgetRef`と型`TurnstileStatus`・`TurnstileTokenController`を加えた。サイトキーは`router.options.context.runtime.get().publicConfig`、nonceは`router.options.ssr?.nonce`(ブラウザでは`hydrate`で`csp-nonce`のmetaから設定し直される)から読むため、`RouterProvider`の下に置く(5.9のStorybookにルーターの枠組みが要る)。ルーターの文脈は型が未登録のため実行時に確かめる。失敗時は5.3の`FormMessage`を`role="alert"`で(文言は`utilities/messages/bot-protection-messages.ts`の`BOT_CHECK_FAILED_MESSAGE`、文言規則とbackend-libの`turnstile-verifier.ts`の写し)。【5.8へ】Turnstileの`theme`は既定の`auto`(OSの設定)で、アプリのダークモードの切替に追従しない(7.3)。5.8で`use-theme`の解決済みの配色を`options.theme`へ渡す(`theme`が変わるとウィジェットが作り直されるため、トークンの状態を`idle`へ戻すか検討)。【6.4・8.x・開発者への確認】`size`未指定の実物は幅300pxの固定のiframe(`flexible`も最小300px)で、幅320pxで左右16pxの余白なら横スクロールが出る見込み(7.2)。常に`compact`にするか、マウント後に画面幅で`size`を決めるか(SSRの`style`に出るため工夫が要る)を開発者に確認する。【8.x・9.x】スクリプトの読み込みの失敗を検知できるのは最初のインスタンスだけで、2つ目のウィジェットや失敗後の再マウントは`idle`で止まる。実際のスクリプトの差し込みは8.xのE2Eで確かめる。`vitest.browser.config.ts`の事前バンドルに`@tanstack/react-router`・`@marsidev/react-turnstile`を加えた(6.1・7.1も同じ)。
- 5.7(設計の欠陥と6.5・7.5・9.5への申し送り): `SystemStatusView({ server, browser?, onRecheck, rechecking })`の結果の型は設計に無い`SystemStatusResult = GraphQLResult<SystemStatusSnapshot>`(`utilities/system/system-status-result.ts`、`{ serverTime: string; databaseReachable: boolean }`はapiのスキーマと一致)で、`isApiUnreachable`(`upstream_unavailable`・`upstream_timeout`・`network_error`)で「APIサーバーへ到達できません。」を出し、到達後の失敗は`error.message`。部品が`h1`(「疎通確認」)と2つの区画を持つため、6.5・7.5のルートは`h1`を足さない。【設計の欠陥】設計のStatusRoute(1613〜1615行)のloaderは`ensureQueryData(graphqlQueryOptions(...))`だが、`queryFn`の`requireData`が失敗を投げるため、APIに到達できないとエラー画面(500)になり要件12.3と同じ節の記述に反する。6.5・7.5のloaderは`executeGraphQL`を直接呼んで`GraphQLResult`を返す(または例外を`{ ok: false, error }`へ変換)し、生成物の`{ systemStatus }`から取り出して渡す。SSRのdehydrateで`GraphQLClientError`の`code`が自身の項目として残ることも確かめる。新しい文言(「疎通確認」「サーバー側の描画時の結果」「ブラウザからの再確認の結果」「APIサーバーへ到達できません。」「再確認」「再確認中」と案内文)は`utilities/messages/system-status-messages.ts`にあり、9.5で文言規則に加える(「APIサーバー」「データベース」は開発者向けの画面のため技術用語の例外として書く)。
- 5.8(設計の相違と5.9・6.x・7.x・9.2・9.5への申し送り): `AppDocument`は`<html lang="ja" suppressHydrationWarning>`の`<head>`内で`<HeadContent />`の前に`<ScriptOnce>{THEME_BOOTSTRAP_SCRIPT}</ScriptOnce>`を置く(サーバーでだけnonce付きで出力し実行後に自分を消すため、ハイドレーションの不一致も差し込み直しによる再実行も無い。6.3・7.3のルートの`head.scripts`に配色のスクリプトを入れない)。中身はスキップリンク・表示設定の提供・`TooltipProvider`(200ms、設計に無い)・トースト・画面遷移の通知で、マウント後に`initBrowserObservability`・`installPreloadRecovery`を呼ぶ。親の判断で、`ThemeToggle`は設計1407・1811行の`aria-pressed`をやめ、切り替え先を示す名前(「ダークモードに切り替え」「ライトモードに切り替え」)だけにし、名前・アイコン・ツールチップを`dark:`クラスで出し分けてSSRの時点から正しくした(状態で名前を変えるトグルに`aria-pressed`を併用すると矛盾した読み上げになるため。設計の改訂候補)。ツールチップの説明は名前と同じ文言になり重ねて読み上げられ得る。保存が無い時のOSの設定は読み込み時だけ反映し、表示中の変更には追従しない。Turnstileは`useTheme()`の配色を受け、配色の変更でウィジェットを作り直すがトークンの状態は保持する。設計に無い`appRuntimeOf`(`start/router-context.ts`、Turnstileも使う)・`MAIN_CONTENT_ID`(`main`)・`runAxeOnDocument`を加えた。6.4・7.4のレイアウトは本文の`<main>`に`id={MAIN_CONTENT_ID}`を付けテストで確かめる(本文の`tabindex="-1"`による輪郭の出方も確かめる)。同じタイトルが続く遷移は再通知されない。部品のテスト・5.9のストーリーで`AppDocument`を使う時は`report-error.ts`・`browser-observability.ts`を差し替える(`node:async_hooks`の読み込みで失敗するため)。6.5のビルドでブラウザのバンドルに`report-error.server.ts`・`node:async_hooks`が入らないことを確かめる。テストの事前バンドルに`@tanstack/react-query`・`jotai/vanilla`を加えた(6.1・7.1も同じ)。ハイドレーションのテストは`renderToReadableStream`とハイドレーション側のルーターの`router.ssr = { manifest: undefined }`で本番の`hydrate`を模す。新しい文言「本文へ移動」「ダークモードに切り替え」「ライトモードに切り替え」を9.5で文言規則に加える。
- 5.9(設計の相違と6.1・7.1・9.2への申し送り): カタログは`storybook:dev`・`storybook:build`(ポートは起動時に`--port 48046`)。`.storybook/main.ts`はTailwindとTurnstileの偽物(`test/fake-turnstile.tsx`への`resolve.alias`、Cloudflareへ通信しない)、`core.disableTelemetry: true`。`.storybook/preview.tsx`は配色のツールバー(`<html>`の`dark`クラス、保存しない)、東京・`ja-JP`の固定の表示設定、`TooltipProvider`、ルーターの実行時の値、a11yをWCAG 2.2 AAのタグ(`test/a11y.ts`の`WCAG_22_AA_TAGS`を共有)に絞る。固定の表示設定は設計1551行の`DisplayPreferencesProvider`ではなく`DisplayPreferencesContext`へ直接渡す(プロバイダーはブラウザの値で上書きするため。設計の改訂候補)。`AppDocument`(`<html>`を描画しカタログの枠を壊す)と`DisplayPreferencesProvider`はストーリーを持たない。開いたドロップダウンのストーリーはa11yの`context`を開いたメニューに絞る(モーダルなメニューの開いた元のボタンをaxeが`aria-hidden-focus`と誤判定するため)。網羅性は`config/storybook-catalog.unit.test.ts`が「同じディレクトリのストーリーか`preview.tsx`が直接importする部品」で判定し(推移的な到達性や別のディレクトリのストーリーでは数えない。設計の併置の規約に合う)、親の中でだけ描画される部品は理由付きの`INTERNAL_COMPONENTS`で扱う。`@storybook/addon-a11y`は自身の`axe-core`(4.14.0)を使い、ブラウザテストの4.13.0と版が異なる。`@storybook/tanstack-react`が要求する`@tanstack/router-core`は直接宣言しない。6.1・7.1は配置先`lib`の`node_modules`が空のため、アプリの型検査から`lib/**/*.stories.tsx`を除外する。
- 5.9(コミット時の検査の修正、6.x・7.xへの申し送り): `storybook/no-uninstalled-addons`は作業ディレクトリ(`process.cwd()`)から`package.json`を探すため、ルートから起動するlint-stagedで共通部品のアドオンを未導入と誤判定した。共通部品の`eslint.config.ts`で`.storybook/main.ts`に`packageJsonLocation`の絶対パスを渡し、`config/eslint-config.unit.test.ts`がルートを作業ディレクトリにしてESLintを起動して確かめる。アプリの`eslint.config.ts`で作業ディレクトリに依存する規則を使う時も同じ扱いにする。
- 6.1(7.1・6.3・6.5・9.6への申し送り): `apps/client`は検査担当でないアプリとして、単体テストを`bunfig.unit.toml`(ルートの書き写し+`lib/**`の除外)で動かし、ESLintの`ignores`とVitestの`exclude`に`lib/`を入れ、型検査は`lib/**`を含めて`lib/*.ts`(配置先で相対パスが解決できない共通部品の設定ファイル)と`lib/**/*.stories.tsx`だけを除く。共通部品の型検査のため`graphql`(16.14.2)・`axe-core`・`vitest-browser-react`・`eslint-plugin-storybook`(`createFrontendLintConfig`の必須の引数)を開発依存に宣言した(Storybook本体は入れない)。`wrangler.jsonc`は3環境で`API`→`genai-example-2-api(-staging|-prod)`の`ClientGateway`、`IP_RATE_LIMITER`の名前空間1003/2003/3003(api 1001〜3001・event 1002〜3002と重ならない)、`compatibility_flags`無し、`invocation_logs: false`、`cache.enabled: false`、staging・prodの`secrets.required`に`SENTRY_DSN`。staging・prodの`TURNSTILE_SITE_KEY`(`0x0000000000000000000000`)・`WEB_ANALYTICS_TOKEN`(0の32桁)は形式の検証を通る仮の値(infra-deliveryが置き換える)。`public/_headers`の`/*`はページ以外のCSPとすべて拒否のPermissions-Policy、`/assets/*`は`public, max-age=31536000, immutable`(共通部品の定数とテストで照合)。7.1は`wrangler-config.unit.test.ts`で`service`名をapiの`wrangler.jsonc`の実効の`name`から読んで比べ、実効の`vars`・バインディングを`validateFrontendEnv`に通すテストを加えるとよい(clientにも同じ改善の余地)。`vite build`・`vite dev`は6.3・6.5で確かめる。`project-values.md`の`API`の行と、`vite`・`wrangler`のtech-stack.mdの扱いは9.6で判断する。
- 6.2(設計の欠陥と7.2・6.5・7.5・9.3・9.6への申し送り): 要件6.3は「ブラウザへ配信するスクリプトにも操作の本文を含めない」と求めるが、設計(139・267・273行、`codegen.config.ts`の`documents`は1655行付近)とresearch.md 137〜139行の`graphql()`の呼び出しでは、呼び出しの引数とclient-preset 6.2.3が条件なしで出力する`gql.ts`の対応表のキーに本文が残る(回避策の`babelOptimizerPlugin`はVite 8で未導入の`@rolldown/plugin-babel`が要る)。このため操作は`.graphql`ファイル(`src/graphql/operations/system-status.graphql`、`documents: ['src/**/*.graphql']`)に書き、画面は`generated/graphql.ts`の本文を持たない文書(`ClientSystemStatusDocument`、`{"__meta__":{"hash":"sha256:…"}}`)を読み、`gql.ts`・`index.ts`は読み込まない(`test/config/codegen.unit.test.ts`の正規表現で検査。`.js`の指定や動的`import()`は検出しないため、ESLintの`no-restricted-imports`や`skipIndexFile: true`で強める余地がある)。7.2も同じ構成にする。操作名は呼び出し元の接頭辞(`Client`・`Admin`)で始める規則をテストで強制し、9.3の`coding/004`に書く。`codegen.config.ts`は`persistedDocuments: { mode: 'replaceDocumentWithHash' }`・`fragmentMasking: false`・`scalars: { DateTime: 'string' }`。生成物は`src/graphql/generated/{graphql.ts,gql.ts,index.ts,persisted-documents.json}`。apiの`allowlist.json`にclientの`ClientSystemStatus`(`sha256:090cc17c…`)が入った。ルートの`bun run check`はアプリの`graphql:check`を段階に含む(api-gatewayの申し送り(4)は解消済み)。6.5の`vite build`の後に、クライアントのバンドルに操作の本文(`query ClientSystemStatus`など)が入らないことを確かめる。9.3・9.6で、操作を変えたら`graphql:generate`→apiの`graphql:allowlist`を実行する手順と、`project-values.md`の生成物の表にclientの生成物を加える。`coding/002`の一括更新の一覧に`@graphql-codegen/client-preset`を加える。
- 6.3(設計の相違と6.5・7.1・7.3・9.xへの申し送り): 登録箇所は`src/composition/`の`CLIENT_PROFILE`(`client`・`__Host-ls_session`・prodだけ検索を許す・`webAnalytics: true`)・`CLIENT_SECURITY_POLICY`(Web Analyticsの2つの許可先)・`RELAY_ROUTES`(`[GRAPHQL_RELAY_ROUTE]`)で、`test/config/composition.unit.test.ts`が値・凍結・`mergeSecurityPolicySources`の成功を確かめる。`src/server.ts`は`withSentry((env) => buildServerSentryOptions(env), createFrontendServerEntry({...}))`で、TanStackのハンドラーは`@sentry/tanstackstart-react`の`wrapFetchWithSentry`で包んだ別のオブジェクト(設計616行は`@sentry/cloudflare`から読むように書くが、`wrapFetchWithSentry`は`@sentry/tanstackstart-react`にだけある)。`Register`の`server.requestContext`(`FrontendRequestContext`)は`server.ts`で登録し、共通部品の`request-context.server.ts`は単独の型検査のため型の無い値として読むまま。ルーターの型の登録は生成物`routeTree.gen.ts`が行う。アプリのルーターの型の登録で共通部品のテスト(`to: '/p'`など)が型検査を通らないため、`apps/client/tsconfig.json`で`lib/**/*.test.ts(x)`も除外した(7.1・7.3も同じ。6.1の申し送りの除外の一覧はこれを含めて9.xで書く)。4.3の申し送りの`onError`の強制は、共通部品に加えた`installRouteErrorReporting`(`start/observability/route-error-reporting.ts`)を`router.tsx`が全ルートに掛ける形で行う(`loader`・`beforeLoad`の失敗を`'loader'`で送ってからルート自身の`onError`を呼ぶ。ルートが`onError`で想定内の失敗を`notFound`などに変えても元の例外は送られ、`SearchParamError`も送られる。7.3も同じ関数を使う)。`src/routes/__root.tsx`は`shellComponent: AppDocument`だけの最小のもの(6.5で拡げる)。`traceHeaders`は`getTraceData()`の`baggage`が`undefined`になり得るため、値が文字列の項目だけを残す形にすると安全。【上流の欠陥、6.5の前に4.1として直す】4.1の`start-options.ts`が`@sentry/tanstackstart-react`を静的にimportするため、4.3の動的importが効かずブラウザのSentryのSDKが主バンドル(958kB)に入る(`INEFFECTIVE_DYNAMIC_IMPORT`)。Workerのバンドルに`@sentry/node`のモジュールは入らない(`@sentry/core`の1つの実体に解決される)。
- 4.1(追加の修正、6.3のレビューで発見。6.5・7.x・9.xへの申し送り): `start-options.ts`が`@sentry/tanstackstart-react`を静的にimportし、クライアントのバンドルで4.3の動的importが効かずSentryのSDKが主バンドルに入っていた(958kB)。Sentryのミドルウェアの再エクスポートを`start/sentry-middleware.server.ts`(設計のFile Structure Planに無い)に置き、`readSentryMiddleware = createIsomorphicFn().server(...).client(() => ({ request: [], fn: [] }))`から読む形にした(主バンドル509kB・`SDK_VERSION`0件、SDKは遅延のチャンク、Workerにはミドルウェアが残る)。ブラウザ側の`requestMiddleware`・`functionMiddleware`はSentryの分を持たない(ブラウザ版は空の実装)。サーバー関数を初めて置くspecか6.5のスモークで呼び出しが通ることを確かめる。再発防止の静的解析の規則`BROWSER_SENTRY_RESTRICTION`(`components/**`・`start/**`・`src/**`のうち`*.server.ts`・`src/server.ts`・テスト以外から`@sentry/tanstackstart-react`の実行時の静的importを禁止。型だけは可、動的importは検出しない)を加えた(9.xの静的解析の文書に書く)。`FrontendServerEntryOptions.traceHeaders`の型は`() => TraceData`(値が`undefined`の項目を許す)に広げ、`createRelayContext`が値が文字列の項目だけを残す(設計の`Record<string, string>`からの相違)。
- 6.4(設計の改訂候補と6.5・identity-auth・help-center・9.xへの申し送り): `SiteLayout({ slots, children })`はヘッダー→`belowHeader`→`<main id="main">`(`flex-1`だけ)→`beforeFooter`→フッターの順で、既定の`SITE_LAYOUT_SLOTS`(`src/composition/layout-slots.ts`、凍結)は未ログインの導線(ログイン`/auth/login`・登録`/auth/register`)と「ローンチする」(`/auth/login`)。6.5で`routes/__root.tsx`に`SITE_LAYOUT_SLOTS`を渡して組み込む。リンクは行き先の経路がまだ無く`Link`の型検査が通らないため素の`<a href>`(画面内の遷移が全ページの読み込みになり現在地の表示も無い。`Link`への移行は全経路がそろう段階の設計の改訂候補で、6.5ではロゴだけ`Link to="/"`にできる)。768px未満では`headerLaunchAction`・`headerAccount`をSheetの中だけに出す(設計どおり、モックアップのドロップダウンと相違)。Sheetを開いている間、区画の部品は`hidden md:flex`の中とSheetの中の2か所にマウントされるため、identity-authの区画の部品は固定の`id`を持たない(`layout-slots.ts`に記載)。`footerHelpLinks`の部品はフッターの`<ul>`の直下に置かれ、包む要素を持たない0個以上の`<li>`を描く(help-centerの`PinnedHelpLinks`と一致)。`composition`→`components`の参照は設計が既定の部品の置き場所として求めるもので、Dependency Directionの矢印の文言は「`composition`は`routes`を読み込まない」に合わせて直す改訂候補。区画の`key`は`slot-key.ts`の部品ごとの固定値(同じ配列に同じ部品を2回登録しない)。320pxの検査はヘッダー・フッターの要素ごとのはみ出しも見る(`belowHeader`・`beforeFooter`・`main`は文書の`scrollWidth`だけ)。文言規則に無い文言(ディレクトリ・ヘルプ・ローンチする・ログイン・登録・メニュー・利用規約・プライバシーポリシー・法的通知・料金・お問い合わせ、ナビゲーションの名前「メイン」「ヘルプ」「規約・問い合わせ」、フッターの説明)は9.5で扱うか判断する。
- 6.5(設計の相違と7.5・8.x・9.xへの申し送り): 共通レイアウトはルートの`component`ではなく`shellComponent`の`ClientDocument`(`AppDocument`の中に`SiteLayout`)に置く(ルートの`errorComponent`・`notFoundComponent`は`component`と差し替わるため)。ルートは`loader: ({ context }) => context.runtime.get()`、`head`は`src/head/page-heads.ts`の`buildRootHead`(文字コード・表示領域・タイトル・スタイルシート・アクセス解析)。疎通確認の`loader`は5.7の欠陥への対処として`executeGraphQL`を直接呼び、`toSystemStatusLoaderData`でErrorを含まない`{ code, message, status }`にして返す(`ShallowErrorPlugin`がErrorをメッセージだけにするため)。画面側で`GraphQLClientError`に戻す。この`loader`は同型の関数のため、ブラウザ内の遷移・`ErrorPage`の再試行(`router.invalidate()`)・先読みではブラウザで実行され、ブラウザの結果が「サーバー側の描画時の結果」の欄に出る(今はリンクが無く実害は小さい。サーバー関数を置く段階で直すか9.5に注記)。`throw notFound()`のため`frontend-lint.ts`に`frontend/router-throwables`(`@typescript-eslint/only-throw-error`で`NotFoundError`・`Redirect`だけ許可)を加えた。`test/page-router.tsx`は`__root.tsx`の構成を写しており、本物の`Route`とずれても検出できない(7.5で同じ形を作るなら本物の`Route.options`と同じ部品かを確かめる)。ロゴの`Link`化は見送り。404・エラーの画面のタイトルはサイト名だけ。描画・loaderの失敗のHTTP 500はソースで確認(`load-server.js`)、サーバー関数の呼び出しはまだ無く未確認。開発サーバーとプレビューで404・疎通確認のサーバー側の結果・再確認・prodビルドの404・アクセス解析のスクリプト(nonce・`defer`)を確認。`vite build`で主バンドル(624kB)に`SDK_VERSION`・操作の本文・`node:async_hooks`が無く、WorkerにSentryのミドルウェアが残る。新しい文言「トップページへ」「ディレクトリを見る」「トップページは準備中です。」は9.5の対象。【上流の追加の修正を予定】Zod v4がブラウザでJITの判定に`Function('')`を試し、ページごとにCSPの違反(`script-src eval`)が1件出る(要件12.6・8.2が失敗する)。ローカルでAPIを止めるとWranglerの`503 text/plain`を中継がそのまま渡し、画面が要件12.3の文言にならない。どちらも7.xより前に直す。
- 2.1・3.7(追加の修正、6.5のレビューで発見。7.x・8.2・9.xへの申し送り): Zod 4.6.5は`z.object()`を作る時点でJITの可否を判定し、ブラウザで`new Function('')`を試してCSPの`script-src eval`の違反を出していた(要件12.6)。共通部品の`utilities/validation/zod.ts`(設計に無い)が`z.config({ jitless: true })`の後に`z`を再エクスポートし、Zodの値は必ずここから読む(ESモジュールは依存を先に評価するため、全スキーマより前に効く。設定は`globalThis`に置かれ、複製されても共有される)。静的解析の`ZOD_VALUE_RESTRICTION`(`^zod(?:/.*)?$`の値のimportをこの部品以外で禁止。型だけと`@hookform/resolvers/zod`は可)を加え、ESLintは同じ規則の設定を合成しないため、`@typescript-eslint/no-restricted-imports`を持つ設定は`restrictValueImports`で組み立てる(後から設定を足す時も同じ)。Bunの単体テストとサーバーもjitlessで動く(workerdは元々試行しない)。`vite build`+`vite preview`で3ページの`securitypolicyviolation`が0件。7.xのアプリも`zod`の値をこの部品から読む。中継(3.7)は上流の5xxで`Content-Type`の媒体の種類が`application/json`・`application/*+json`でない(または無い)応答を実行基盤の失敗とみなし、本文を捨てて(取り消しの失敗も捨てる)503`upstream_unavailable`・`Retry-After: 5`・警告・送信(報告には状態コードだけ)にする(ローカルでAPIを止めた時のWranglerの`503 text/plain`も要件12.3の文言になる)。設計1008行・要件2.10の「状態と本文をそのまま返す」はJSONでない5xxでは成り立たず、9.1の中継の経路の追加規約に「上流は5xxを必ずJSONで返す」を書く。`+json`を含めるのは、APIのGraphQLの500`internal_error`が`application/graphql-response+json`で返るため。
- 7.1(7.2〜7.5・9.6への申し送り): `apps/admin`は6.1時点のclientの構成を写し、違いはWorker名`genai-example-2-admin(-staging|-prod)`・`API`→`AdminGateway`・`IP_RATE_LIMITER`の名前空間1004/2004/3004・`WEB_ANALYTICS_TOKEN`無し。`bun.lock`はclientのロックを種にし、根の名前を`admin`に直した(Bunが正規に生成するものと同等で`--frozen-lockfile`は差分無し)。型検査は`lib/*.ts`・`lib/**/*.stories.tsx`・`lib/**/*.test.ts(x)`を除外済み。`wrangler-config.unit.test.ts`は6.1の改善を取り入れ、`service`名をapiの実効の`name`と比べ、実効の変数と偽のバインディングを`validateFrontendEnv`に通し、4アプリ12個の名前空間が一意であることを確かめる(clientのテストには未適用)。コード生成は7.2、エントリ・登録箇所は7.3。
- 7.2(9.3・9.6への申し送り): 管理者側のコード生成は6.2のclientの構成をそのまま写し、操作は`src/graphql/operations/system-status.graphql`の`AdminSystemStatus`(画面は`generated/graphql.ts`の`AdminSystemStatusDocument`を読む)。apiの`allowlist.json`の`admin`に`sha256:cfd1cd38…`の1件が入った。`test/config/codegen.unit.test.ts`は`Admin`の接頭辞と、clientの`persisted-documents.json`と識別子を共有しないこと(相対パスで読む)を確かめる(clientのテストには逆向きの検査は無い)。
- 7.3(7.5・9.xへの申し送り): 管理者側の登録箇所は`ADMIN_PROFILE`(`admin`・`__Host-ls_admin_session`・`indexable: () => false`・`webAnalytics: false`)・空の`ADMIN_SECURITY_POLICY`・`RELAY_ROUTES`(`[GRAPHQL_RELAY_ROUTE]`)。`server.ts`はclientと同じ構成で値だけが違い、`start.ts`・`router.tsx`はclientと同一(設計のFile Structure Planどおり各アプリに置く)。最小の`__root.tsx`(`shellComponent: AppDocument`)と生成物`routeTree.gen.ts`は7.5で拡げる。`test/config/composition.unit.test.ts`はCookieの名前の違いを確かめるためclientの`src/composition/app-profile.ts`を静的にimportする(型の登録は混ざらないが、clientの`app-profile.ts`が型の登録を持つモジュールを読むようになると混入し得る。9.xで触れる)。`vite build`で主バンドルに`SDK_VERSION`無し・警告無し。
- 7.4(要件と設計の不整合、7.5・admin-foundation・9.xへの申し送り): `AdminLayout`はヘッダー(「⚽️ Launch Stadium管理」のトップへのリンク、絵文字は`aria-hidden`・`ThemeToggle`・`headerAccount`)→`navigation`の区画(包む要素無し、768px以上で左の列・未満で本文の上)→`<main id="main">`で、`ADMIN_LAYOUT_SLOTS`は`navigation`・`headerAccount`とも`null`(凍結)。空の区画は入れ物ごと描画しない。【不整合】要件10.4は画面シェルに「ヘッダー・ナビゲーション・本文・フッターのランドマーク」を求めるが、設計1595行の管理者側の構成とFile Structure Planにフッターが無く(1596行のランドマークは利用者側と区別していない)、初版は区画が空のためナビゲーションのランドマークも無い。設計1596行を「管理者側は`header`・`nav`(admin-foundationが追加)・`main`」と明記するか、要件10.4の対象範囲を明確にする(設計の改訂候補)。【admin-foundationへ】`AdminNavigation`は自身で名前付きの`nav`を描き、768px未満のSheetの開閉ボタンはヘッダーと本文の間に出る(ヘッダーに置くなら`AdminLayoutSlots`に区画を加える契約の変更)。7.5は`__root.tsx`の`shellComponent`で`AdminLayout`(`ADMIN_LAYOUT_SLOTS`)を組み込む。設計に無い`admin-site.ts`(サービス名と`/`)を加えた。「Launch Stadium管理」は9.5の文言規則の対象。
- 7.5(設計の改訂候補と8.x・9.x・admin-foundationへの申し送り): 管理者側のルートは6.5と同じ構成(`shellComponent: AdminDocument`=`AppDocument`の中に`AdminLayout slots={ADMIN_LAYOUT_SLOTS}`、疎通確認のloaderは`executeGraphQL(AdminSystemStatusDocument)`を直接呼び`{ code, message, status }`で返す、prodは`notFound()`、`noIndex`)。違いは、`head`にアクセス解析が無くルートのloaderも無い(実行時の値は`AppDocument`がルーターの文脈から読む)、404の導線はトップページだけ。共通部品の`UnexpectedErrorView`の`contactHref`を省略可能にし、管理者側のエラー画面は問い合わせのボタンを描かない(管理者側に問い合わせの画面もclientのオリジンの設定も無いため。要件8.10は共通部品が導線を提供できることを求め、管理者側の11.6は求めない。設計1539行の`contactHref`を任意と明記する改訂候補。型の上ではclientの渡し忘れを検出せず、clientのブラウザテストで守る)。管理者側のエラー画面は共通の案内文「…解決しない場合はお問い合わせください。」を導線無しで出すため、9.5かadmin-foundationで管理者側の案内文を見直す。`test/root-route.browser.test.tsx`は本物の`Route.options`の`notFoundComponent`・`errorComponent`が同じ部品かを確かめる(`AppDocument`を`vi.mock`)が、`shellComponent`の構成は検査しない(clientには未適用)。`system-status-page.tsx`・`graphql/system-status.ts`はclientの写し。開発サーバーとビルドで404・疎通確認と再確認・`X-Robots-Tag`・CSPの違反0件・アクセス解析無し・主バンドルに`SDK_VERSION`・本文無しを確認。prodのビルドで疎通確認が404になることは8.1・8.2で確かめる。
- 8.1(2026-10-28の結果と9.6への申し送り): マイグレーションの適用(適用無し)→client・adminの`graphql:generate`→apiの`graphql:allowlist`(差分無し)→apiを`infisical --telemetry=false run --env dev -- bun run dev`で起動→client(48044)・admin(48045)の開発サーバーとビルド後のプレビューの4つの組み合わせすべてで、`/system/status`のサーバー側の区画にAPIの時刻と「到達可能」、「再確認」で`POST /_bff/graphql 200`とブラウザ側の区画に同じ表示、存在しないページは404、CSPの違反0件(レビュー担当も独立に再現)。`CLOUDFLARE_ENV=staging`のビルドの`dist/server/wrangler.json`はclient `genai-example-2-client-staging`・`genai-example-2-api-staging`(ClientGateway)・2003、admin `genai-example-2-admin-staging`・同(AdminGateway)・2004。adminの`CLOUDFLARE_ENV=prod`のビルドで`/system/status`は404。9.6でオンボーディングに反映する注意点: (a)起動はapi→(必要ならevent)→client→adminの順に、前のサーバーの応答を待ってから次を起動する(APIが起動していないと「到達可能」にならない)。(b)`@cloudflare/vite-plugin`のインスペクターのポートは既定9229から空きを探すため、api(9229)・event(9230固定)と衝突し得た(clientとadminのプレビューの同時起動でadminが`EADDRINUSE`、フロントエンドの後のeventの起動がexit 1)。`vite.config.ts`で固定した値(下記の追加の修正)と、README.mdの「eventは9229と重ならない9230」の説明にフロントエンドのポートを書き足す。(c)開発サーバーとプレビューは同じHTTPポートを使うため同時に動かさない。(d)プレビューも`infisical run --env dev`経由で起動する(経由しないとWranglerが`SENTRY_DSN`の不足を警告し`.dev.vars`の作成を促すが、作らない)。stagingのビルドの同じ警告も無視してよい(出力にシークレットの値は入らない)。(e)`CLOUDFLARE_ENV`付きのビルドはローカル向けの`dist`を上書きするため、ローカルでプレビューする前に環境を指定せずビルドし直す。ビルドでGit管理外の`apps/{client,admin}/.wrangler/deploy/config.json`ができる。(f)ビルドの500kBを超えるチャンクの警告、Vite pluginのAIエージェントの検出の案内、404のページのconsoleの読み込み失敗は想定どおり(8.2のスモークは404の読み込み失敗を除外する)。(g)client・adminのローカルの設定にシークレットは無く`infisical run`は必須ではないが、オンボーディングに従って付けるか9.6で統一する。(h)オンボーディングのクイックスタートの「AIエージェントはこのセクションのコマンドを実行しないこと」と、本タスクでの実行の扱いを9.6で見直す。(i)疎通確認の時刻は分の単位のため、再確認で更新されたことは時刻からは見分けられない。
- 6.1・7.1(追加の修正、8.1で発見): client・adminの`vite.config.ts`の`cloudflare()`に`inspectorPort`をclient 9231・admin 9232で固定した(api 9229(Wranglerの既定)・event 9230(固定)と同時に起動しても重ならない)。ルートの`config/inspector-ports.unit.test.ts`が構文木から4つのポートを読み、互いに異なることを確かめる(読み取れなければ失敗)。api・event・client・adminの同時起動で衝突しないことを再現の手順で確かめた。9.6でREADME.mdのポートの説明に9231・9232を加える。
- 8.2(9.x・infra-deliveryへの申し送り): スモークテストは`e2e/client/system-status.e2e.test.ts`・`e2e/admin/system-status.e2e.test.ts`の20件で、共用の補助は`e2e/support/security-assertions.ts`(ヘッダーの検査は`page`・`non-page`・`static-file`(長期キャッシュのため`no-store`を求めない)、nonce・描画を妨げるスクリプト・CSPの違反の記録)と設計に無い`e2e/support/system-status-page.ts`(経路・結果の検査・再確認・`annotateSkippedCheck`)。テストは`apps/frontend-lib`の文言の定数をimportする。対象のURLは`E2E_CLIENT_URL`・`E2E_ADMIN_URL`だけで切り替わり、staging固有・localhost固有の値を持たない。開発サーバーとプレビューの両方で成功(レビュー担当も繰り返しの実行で確認)。ローカルではアクセス解析のトークン・SentryのDSN・Turnstileのウィジェットが無いため、14.2はアクセス解析のスクリプトがある時だけ`defer`とnonceを個別に確かめ(無ければ記録を残す)、Sentryの静的な取り込みと静的なファイルのセキュリティヘッダーの検査はビルド後の対象(プレビュー・staging)でのみ有効(開発サーバーでは記録を残して飛ぶ)。開発サーバーではハイドレーションの完了の合図が無く最初の再確認のクリックが無視されるため、再確認は再クリックで行い、テストの上限60秒・`toPass`40秒で明示した。開発サーバーは`--port 48044/48045`を付けて起動する(付けないとViteの既定のポートでE2Eの既定のURLに届かない)。9.xで`docs/GUIDES/tech/testing/001-test-strategy.md`の共用の補助の表とCLAUDE.mdの`e2e/support/`の説明に2つの補助を加える。
- 8.3(2026-10-28の結果と9.2・9.3への申し送り): カバレッジの閾値は行と関数のファイルごと80%(分岐は判定外のため`app-form.tsx`の分岐78.57%は失敗しない)。frontend-lib 単体1147件(最小は`start/start-options.ts`の関数83.33%)・ブラウザ312件(最小は`app-document.tsx`の関数80%で閾値ちょうど、未網羅は`reloadPage`)、client 単体62件・ブラウザ49件、admin 単体67件・ブラウザ41件(client・adminは全ファイル100%)、`bun run check`成功20、`test:all:unit/browser/worker --coverage`すべて成功(レビュー担当も独立に確認)。E2Eは一括実行に含まれない(8.2で確認)。adminの単体テストがclientの`src/composition/app-profile.ts`を読み込むため、そのファイルはadminの単体テストの分母にも入り(`bunfig.unit.toml`の除外はルートの単体テストが厳密に検査するため設定では外せない)、関数0%で失敗したので`CLIENT_PROFILE.indexable('prod')`と`ADMIN_PROFILE.indexable('prod')`を対比するテストを足した。clientの`app-profile.ts`に関数を加えたら、adminの`composition.unit.test.ts`でも呼ぶ。9.2・9.3で`docs/GUIDES/tech/testing/001-test-strategy.md`の「分母からの除外」に「Bunの単体テストは、テストが読み込んだ他アプリのソースを分母に数え、`bunfig.unit.toml`では外せない。他アプリのソースを読み込むテストは、そのファイルの関数をすべて呼ぶか、読み込みを避ける」と一般化して書く。frontend-libのブラウザテストの`Detected multiple renderers`の警告は`app-document.browser.test.tsx`の同じページでのサーバー側の描画とハイドレーションによるもので、テストは前方一致でこの警告だけを除外しており無害。
- 9.1(9.6への申し送りと判断待ち): `docs/GUIDES/tech/frontend/003-frontend-server-security.md`を新設し、frontend/002・coding/001・coding/003を実装に合わせた。新設したプレースホルダー`<中継の接頭辞>`・`<インスペクターのポート>`・`<共通部品の配置先>`・`<利用者側のセッションのCookieの名前>`・`<管理者側のセッションのCookieの名前>`・`<セッションのCookieの名前>`・`<画像配信のオリジンの変数>`は9.6で`project-values.md`に載せる。8.2(testing/001の補助の表・CLAUDE.mdの`e2e/support`)・8.3(カバレッジの分母の注記)・7.3(アプリ間のimport)の文書化は9.1〜9.5に割り当てが無いため9.6で扱う。IP制限のキーのハッシュ化(security/002とbackend/003の食い違い、3.2)とCookieの有効期間の400日の上限(3.6)は開発者の判断待ちで、決まったらfrontend/003の「Rate Limitingバインディングの規約に合わせている」の理由も見直す。importの保護は開発サーバーでは警告だけで、`vite build`だけがエラーにする
- 9.2(9.5・9.6への申し送り): `docs/GUIDES/tech/frontend/004-accessibility-rules.md`・`005-shared-components.md`を新設した。技術文書には一般の規則(直したトークンと理由はデザインの文書に記す)だけを書いたため、ダークの`--destructive`をデザイン案より明るくしたことと、破壊的な操作のボタンのダークのホバーを`dark:hover:bg-destructive/50`(バッジはリンクのときだけ`dark:[a&]:hover:bg-destructive/50`)にしたことは9.5でデザインガイドラインに記す。新設したプレースホルダー`<カタログのポート>`と2文書の索引への追加は9.6で行う。1ファイル1コンポーネントは静的解析で強制しておらず、コードレビューで確かめる
- 9.3(9.6への申し送りと判断待ち): `docs/GUIDES/tech/frontend/006-data-fetching.md`を新設し、coding/004のクライアント側の節とcoding/002の版の組・版をそろえるパッケージを書いた。新設したプレースホルダー`<利用者側の操作名の接頭辞>`・`<管理者側の操作名の接頭辞>`は9.6で`project-values.md`に載せ、観測の文書(9.4)との相互リンクも9.6で検討する。1ページの描画あたりの呼び出し回数の目安「3回以内」は要件・設計・researchに数値が無く文書で決めた値のため、開発者の確認が要る。ストリーミングと区画のエラーの境界の形はまだ実装で使っておらず、ハイドレーションでのエラーの変化はライブラリのソースで確かめただけのため、最初に使うspecで動かして確かめる。Markdownのコード例が`loader:`で始まる断片だとPrettierがラベル文として整形し崩すため、コード例は完全な式で書く
- 9.4(9.6への申し送りと文書の相違): `docs/GUIDES/tech/frontend/007-frontend-observability.md`を新設した。新設したプレースホルダー`<アクセス解析のトークンの変数>`と、既存の`<呼び出し元の種類>`の参照先への007の追加、006の「観測の文書で扱う」からのリンク、索引への追加は9.6で行う。`infra/004`との相違(環境の不備のログのカテゴリがフロントエンドは`[caller,'env']`で`infra/004`は`[<アプリ名>,'http','env']`、アクセスログの`outcome`が`infra/004`の表に無い、収集するヘッダーの扱い)は007に違いとして書き、`infra/004`は変えていない。`SENTRY_TRACE_LIFECYCLE`をWrangler設定に定義しない注意と、`beforeSendSpan`が`null`を返しても例外を投げても元のスパンが除去されずに送られる注意はバックエンドにも当てはまるが`infra/004`に無い。`__SENTRY_DEBUG__`を置き換えていないため、逐次送信の形が合わないとき通常のバンドルでも初期化時に警告が出る
- 9.5(9.6への申し送りと判断待ち): `docs/GUIDES/service/features/003-internationalization.md`を新設し、service/design/001〜003を実装に合わせた(文言は定数との照合スクリプトで全件一致)。画面の相対表現は残りの時間と経過した時間だけで暦の「明日」を出さないため、デザイン原則の用語の表の例を時間による表現に直した。日付だけの値(ローンチ日・週)は換算せず基準時刻の暦のまま扱い、共通の`DateTime`には渡さない。判断待ち: 通知メール件名「明日は準決勝」とメールのUTC表記の読み違いの可能性、ダークの`--destructive`の実装(`oklch(0.64 0.2 25)`)とデザイン案(`oklch(0.6 0.2 25)`)の相違、管理者側の想定外のエラーの画面の案内文(admin-foundationで見直す)。索引(`features/README.md`・`service/README.md`)への追加は9.6で行う
- 9.6(開発者の確認待ち): 8.1(h)の見直しとして、オンボーディングのクイックスタートのAIエージェントの規則を「手順1〜11は実行しない。手順12〜14は動作確認のために実行してよく、起動したプロセスは止める」に変えた。新しい作業ツリーでは依存の導入→共有ディレクトリの配置→両アプリのビルド→カタログのビルド→利用者側の開発サーバーの起動までを確かめ、APIを起動した状態の疎通確認とスモークテストは現在の作業ツリーで確かめた。`project-values.md`の「記載している見出し」の列には、本spec以前からの漏れと`<呼び出し元の種類>`(007の一部の節)・`<IP制限のバインディング名>`(frontend/003の前提と用語)の漏れが残る
- 2026-10-28(開発者の判断、10.1〜10.5の起点): 要件2.10にJSONでない5xxを503`upstream_unavailable`にする例外を加え、要件10.4を利用者側に限って管理者側を10.8とし、Turnstileのウィジェットを非表示(ローカルのサイトキー`1x00000000000000000000BB`)にし、apiの`assertIssuable`にも400日の上限を加え(api-gatewayの11.1、本specの文書は10.5)、全WorkerのIP制限のキーを`HASH_PEPPER`のHMACでハッシュ化し(backend-platformの11.1・本specの10.1、要件5.7)、管理者側では画面内の想定外のエラーの表示・`ErrorState`・`GraphQLClientError`でない例外の文言・静的な500の画面のどれにも問い合わせの導線と問い合わせを促す文を出さないとし(判断9とその追加、要件8.6・8.13・11.10)、通知メールの件名から日付を基準にした相対表現を除き、下流specの設計(infra-deliveryのウィジェットの種類と`HASH_PEPPER`の登録先を含む)を確定した契約へ合わせ(10.4)、client・adminに`cf-typegen`を足さないと決めた。1ページの呼び出し回数の目安3回以内・オンボーディングのAIエージェントの緩めた規則・CLAUDE.mdの参照先の3つは現状のまま確定した。staging・prodのTurnstileのサイトキーとアクセス解析のトークンの仮の値はinfra-deliveryの担当として残す。設計は「決定事項」に記した。
- 10.2(結果): Turnstileのウィジェットは外側の要素を持たず、ライブラリの非表示の入れ物(幅0・高さ0)に`position: absolute`を渡して通常の流れから外し、親の`gap`・`space-y`を消費しない。失敗時は`FormMessage`だけが流れに入る。偽物のTurnstileも非表示の大きさを真似て描き、結果のボタンは`body`の直下に描く。5.6の「幅320pxで横スクロールの見込み」は非表示のウィジェットにしたことで解消した。`space-y`の親の最後の子に置くと、平常時に親の末尾へ余白が1つ残る
- 10.3(結果と申し送り): 問い合わせの導線の有無はプロファイルの`contactAvailable`(利用者側は真・管理者側は偽)で決まり、`UnexpectedErrorView`・`ErrorState`は`contactHref`の有無で、`GraphQLClientError`でない例外の文言は`errorMessageOf(error, contactAvailable)`で、静的な500の画面は`renderStaticErrorPage({ status: 500, contactAvailable })`で出し分ける。利用者側の`ErrorPage`は`CONTACT_HREF`を常に渡し、プロファイルとの一致は`composition.unit.test.ts`と`ErrorPage`のブラウザテストで確かめる。`docs/onboardings/project-values.md`のプロファイルの表に`contactAvailable`の行を足すのは10.1の文書の更新で行う
- 10.4(結果と開発者への確認): 下流23specを確定した契約に合わせ(1282d37)、design.mdの影響の表の該当箇所を合わせた後の位置にした。派生した契約として、admin-foundationの`ConfirmActionDialogProps`・`CategoryMasterEditorProps`の必須の`failureMessageOf`と、media-pipelineのアップロード部品の必須の`contactAvailable`が加わった。infra-deliveryに、非表示のTurnstileを使う条件としてプライバシーポリシーでCloudflareのTurnstile Privacy Addendumを参照する記述を足した(開発者の確認待ち)。product-launchとugc-moderationが同じ照会`adminProductCategories`を違う型で定義している(10.4より前からの食い違い)
- 10.1(結果): フロントエンドは`server/http/rate-limit-key-hash.ts`でbackend-libと同じHMAC-SHA512を計算し(乱数の入力で不一致0)、要求ごとに鍵を読み込む。`HASH_PEPPER`はclient・adminのルート・staging・prodの`secrets.required`にあり、ローカルでもInfisicalの`dev`からの注入が要る。エントリの単体テストは800行の上限のため`create-frontend-server-entry.env-rate-limit.unit.test.ts`に環境の不備とIP制限の検査を分けた
- 10.6(結果): client・adminのブラウザのエントリ`src/client.tsx`(Startの既定のエントリと同じ描画の処理)とサーバーのエントリ`src/server.ts`は、最初のimportで`../lib/utilities/validation/zod.ts`を副作用として読み込む。`test/config/entry-imports.unit.test.ts`(client・adminで同じ中身の写し)が最初の読み込み・Startの既定の名前での解決・`tanstackStart()`がエントリを指定しないことを確かめる。開発サーバーとビルド後のプレビューの両方でCSPの違反は0件。Startの版を上げる時は`src/client.tsx`を既定のエントリと見比べる
- 11.1(結果と申し送り): `SubmitButton`は`(!isValid || hasFieldErrors) && !isSubmitting`で無効にし、`hasFieldErrors`は`root`以外の欄のエラー(サーバーのエラーと利用側が`setError`で欄に付けたエラー)を数える。サーバーの詳細がオブジェクトの値を持つ親の経路(例: `input.address`)に付くと、画面に出ないエラーで送信ボタンが無効のまま戻らない(開発者の判断待ち)。条件によって描かない欄をスキーマの入力に含める下流のフォーム(content-reportingの連絡先の欄など)は後続で直す
