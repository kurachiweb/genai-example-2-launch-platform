# ローンチプラットフォーム「Launch Stadium」

## このサービスについて

作った製品を投稿し、他のユーザーと投票数を競い合うローンチプラットフォーム。要件定義は[ソフトウェア要件定義書](docs/requirements/README.md)を参照すること。

## 技術選定

主な技術選定の一覧は[tech-stack.md](docs/onboardings/tech-stack.md)を参照すること。

## 本プロジェクト規則

### コーディングAI思考プロセスの規則

- 機能追加や大規模改修で数十行以上のコードを変更する場合は、必ず[cc-sddフレームワーク](docs/ai-extensions/cc-sdd.md)に従って実装開始前に開発者が`/cc-sdd:kiro-discovery`または`/cc-sdd:kiro-spec-init`を実行し、生成されたspecに従ってClaudeが実装する。
- 新規ビジネスロジックが無い軽微な変更であっても、影響範囲が広いものと考えて水平展開を行うこと。
- 複数の選択肢があって判断に迷うタスクや、既存のドキュメントを調べても実施方法が不明なタスクを進める場合は、都度質問をすること。
- 既存のドキュメントとコードに相違点があれば一旦コードの書き方に従い、最後の返答で見つけた相違点を全て挙げること。
- アプリケーション実装中に新しいパッケージが必要と分かった時、workerd環境で動作しメンテナンスが継続的に行われているパッケージをいくつか候補として質問すること。そして回答に基づきインストールしたツールを[tech-stack.md](docs/onboardings/tech-stack.md)に記載すること。
- コマンドでパスを指定する場合は、必ず絶対パスで表記すること。
- 必ず実行すべきコマンドやファイル編集がClaude設定のdenyにより拒否されてしまった場合は、開発者が後ほど手動で実行できるように報告すること。
- フロントエンド側でTanStack系ツールが使われる処理を作成・改修・調査・コードレビューしたい場合は[TanStack Agent Guidelines](docs/ai-extensions/tanstack-agent-guidelines.md)を参照すること。ただしそのガイドラインの「Repository Structure」セクションとは異なり、TanStack関連スキル群は`.claude/skills/tanstack-agent-skills/skills`ディレクトリ内にある。
- [要件定義書](docs/requirements/README.md)を`grep`コマンドで読み取る際は必ず`--text`オプションを付けること。96KiB超えの巨大テキストファイルがバイナリと判定されてしまうのを防ぐため。

### コード・ドキュメントの規則

- 各種ドキュメント、コードコメント、Gitコミットメッセージにおいて、外部リポジトリ由来を除く全ての文章は日本語で記述すること。
- ドキュメントやコードコメントにおいて、日本語と英数字の間、そして日本語とインラインコードの間には半角スペースを入れないこと。例:「テストは Bun の `bun test` により 10% でも速くする」ではなく「テストはBunの`bun test`により10%でも速くする」
- マークダウンドキュメント内で図が必要ならmermaid形式で記述すること。
- テスト駆動開発(TDD)の実施を徹底すること。
- HonoはInversifyによる依存性注入を活用し、クリーンアーキテクチャに基づく実装を徹底すること。
- コード内にコメントは原則書かないこと。ただし難易度の高いロジックには理解を早めるための「何をする処理か」コメントを添える。コードを読むだけでは分からない「なぜその処理が必要か」のコメントは書く。
- コードコメントは新規追加・既存修正を問わず常にゼロベースで、現在のコードが成立するために必要な情報のみを記載すること。「以前は〜だったが」「〜をやめて」「〜を削除し」のように変更前の実装や修正の経緯を残してはならない。
- appsディレクトリ内を編集した際は、docsディレクトリ内の関連する内容も必ず更新すること。
- `docs/GUIDES/tech`ディレクトリ内では本プロジェクト名を記載したり、サービス特有の仕様に言及してはならず、同じ技術選定による他のプロジェクトにも丸写しできる内容にすること。
- BunのWorkspaces機能は使用しないこと。
- シードデータやドキュメント内のサンプルデータにおいて、URLのgTLD部やメールアドレスのドメイン部は`.example`のみを使用すること。ただし[本プロジェクトのドメイン](README.md#配信url一覧)は例外とする。
- 1つのコンポーネントファイル内でエクスポートするReactコンポーネントは必ず1つだけにすること。

### 技術規則の参照先

- 設定ファイル(ESLint・Viteなど)を作る前に: [設定ファイルの記述形式](docs/GUIDES/tech/coding/001-javascript-typescript-conventions.md#設定ファイルの記述形式)
- JavaScript・TypeScriptのコードを書く前に: [新しい記法の選択](docs/GUIDES/tech/coding/001-javascript-typescript-conventions.md#新しい記法の選択)
- HTML要素で日時を表示する前に: [日時の表示](docs/GUIDES/tech/frontend/001-markup-conventions.md#日時の表示)
- `wrangler dev`などWranglerを起動する前に: [Wranglerを動かす実行環境](docs/GUIDES/tech/infra/001-wrangler-conventions.md#wranglerを動かす実行環境)
- Wranglerのコマンドの実行やD1・R2のバインディングの定義の前に: [ローカル状態の永続化と共有](docs/GUIDES/tech/infra/001-wrangler-conventions.md#ローカル状態の永続化と共有)
- TanStack Startアプリを起動・ビルドする前に: [開発時とデプロイ前の起動](docs/GUIDES/tech/frontend/002-tanstack-start-on-workers.md#開発時とデプロイ前の起動)
- 画面のルートや部品からサーバーだけで動かす処理を使う前に: [サーバー専用のファイルと同型の関数](docs/GUIDES/tech/frontend/002-tanstack-start-on-workers.md#サーバー専用のファイルと同型の関数)
- 画面の部品を作る・共通部品へ移す前に: [共通化の対象](docs/GUIDES/tech/frontend/005-shared-components.md#共通化の対象)
- 画面の部品やページを作る・改修する前に: [アクセシビリティ規則の前提と用語](docs/GUIDES/tech/frontend/004-accessibility-rules.md#前提と用語)
- フロントエンドサーバーに中継の経路を追加する前に: [中継の経路の追加規約](docs/GUIDES/tech/frontend/003-frontend-server-security.md#中継の経路の追加規約)
- 画面で外部のスクリプト・画像・接続先・埋め込みを使う前に: [許可先の登録](docs/GUIDES/tech/frontend/003-frontend-server-security.md#許可先の登録)
- 画面でAPIサーバーのデータを取得・変更する処理を書く前に: [取得の補助とloader](docs/GUIDES/tech/frontend/006-data-fetching.md#取得の補助とloader)
- 表示中の画面のデータを定期的に取り直す処理を書く前に: [表示中の画面の定期再取得の使う場面](docs/GUIDES/tech/frontend/010-live-refresh-queries.md#使う場面)
- 業務日付をカレンダーで選ばせる画面や、表示中に業務時刻の境界で取り直す画面を作る前に: [業務日付のカレンダーの前提と用語](docs/GUIDES/tech/frontend/012-business-date-calendar.md#前提と用語)
- 集計値や残り時間を表示し続ける画面や、区画を登録口から並べてページ全体で自動更新を切り替える画面を作る前に: [集計値と残り時間を表示し続ける画面の前提と用語](docs/GUIDES/tech/frontend/013-live-scoreboard.md#前提と用語)
- 検索・絞り込み・並び順・ページ番号をURLのクエリで持つ一覧の画面を作る前に: [URLのクエリで条件を持つ一覧の前提と用語](docs/GUIDES/tech/frontend/014-url-state-listing.md#前提と用語)
- フロントエンドのGraphQLの操作を追加・変更する前に: [操作の置き場所と名前](docs/GUIDES/tech/coding/004-graphql-communication.md#操作の置き場所と名前)
- 利用者の入力の検証規則を画面のフォームやAPIサーバーに書く前に: [規則の置き場所](docs/GUIDES/tech/coding/005-input-validation.md#規則の置き場所)
- フロントエンドで想定外の失敗をエラートラッキングへ送る処理を書く前に: [送信の入口](docs/GUIDES/tech/frontend/007-frontend-observability.md#送信の入口)
- シークレット・環境変数を使うコマンドの実行や設定の前に: [シークレットの注入](docs/GUIDES/tech/security/001-secret-management.md#シークレットの注入)
- Wrangler設定やコマンドでデプロイ先を指定する前に: [デプロイ先の環境種別](docs/GUIDES/tech/infra/002-environments.md#デプロイ先の環境種別)
- Infisicalの環境を指定する前に: [シークレット管理の環境種別](docs/GUIDES/tech/infra/002-environments.md#シークレット管理の環境種別)
- Workerのシークレットを宣言・追加・削除する前に: [シークレットの登録の規則](docs/GUIDES/tech/operations/001-deployment.md#シークレットの登録の規則)
- IaC定義に資源を追加・変更する前に: [資源の追加手順](docs/GUIDES/tech/infra/006-iac-with-opentofu.md#資源の追加手順)
- GitHub Actionsのワークフローや複合アクションを作成・変更する前に: [ワークフローの規則](docs/GUIDES/tech/infra/007-ci-cd-pipelines.md#ワークフローの規則)
- CIでシークレットを取り出す処理やリポジトリ保護の設定を変更する前に: [CIのシークレットの供給経路](docs/GUIDES/tech/security/003-ci-secrets-and-repository-protection.md#ciのシークレットの供給経路)
- Inversifyで注入するクラスを書く前に: [コンストラクタ引数の注入](docs/GUIDES/tech/backend/001-dependency-injection-on-workers.md#コンストラクタ引数の注入)
- Wrangler設定を作成・変更する前に: [互換性日付](docs/GUIDES/tech/infra/001-wrangler-conventions.md#互換性日付)
- テストファイルの作成やテストの実行の前に: [テストの種別と命名](docs/GUIDES/tech/testing/001-test-strategy.md#テストの種別と命名)
- カバレッジの計測やCIのテストの設定の前に: [カバレッジ](docs/GUIDES/tech/testing/001-test-strategy.md#カバレッジ)
- DBスキーマの変更やマイグレーションの作成・適用の前に: [マイグレーション・大文字小文字を区別しないカラム](docs/GUIDES/tech/db/001-drizzle-migrations-on-d1.md#マイグレーション大文字小文字を区別しないカラム)
- テーブルを新しく定義する前に: [命名規則](docs/GUIDES/tech/db/001-drizzle-migrations-on-d1.md#命名規則)
- ハンドル(URLの識別子)を持つテーブルを定義する前に: [新しい対象を足す手順](docs/GUIDES/tech/backend/011-handle-namespaces.md#新しい対象を足す手順)
- D1へのクエリ・全文検索・バックアップを設計する前に: [D1の制約と対処](docs/GUIDES/tech/db/002-d1-constraints.md#d1の制約と対処)
- Playwright・ブラウザ操作MCPサーバーの版を更新する前に: [同期すべき4箇所](docs/GUIDES/tech/testing/002-browser-tool-versions.md#同期すべき4箇所)
- バックエンドに経路・ユースケース・リポジトリ・モジュールを追加する前に: [層構成と合成ルート](docs/GUIDES/tech/backend/002-layered-architecture-on-workers.md#層構成と合成ルート)
- バックエンドのファイル間でimportを書く前に: [依存方向と静的解析](docs/GUIDES/tech/backend/002-layered-architecture-on-workers.md#依存方向と静的解析)
- GraphQLのスキーマモジュールを追加・変更する前に: [スキーマモジュールの規約](docs/GUIDES/tech/backend/004-graphql-server.md#スキーマモジュールの規約)
- 公開REST APIの経路を追加する前に: [経路の登録](docs/GUIDES/tech/backend/005-public-rest-api.md#経路の登録)
- 内部RESTの経路を追加する前に: [内部RESTの追加規約](docs/GUIDES/tech/backend/006-internal-gateway.md#内部restの追加規約)
- バックエンドで想定内の失敗を返す処理やエラーコードを書く前に: [共通エラーと共通のエラー形式](docs/GUIDES/tech/backend/002-layered-architecture-on-workers.md#共通エラーと共通のエラー形式)
- 経路にレート制限を掛ける前に: [制限の方式の選び方](docs/GUIDES/tech/backend/003-rate-limiting-and-bot-verification.md#制限の方式の選び方)
- 経路やフォームの送信にbot判定を掛ける前に: [bot判定の検証](docs/GUIDES/tech/backend/003-rate-limiting-and-bot-verification.md#bot判定の検証)
- ログインせずに送れる投稿を受け付ける経路を書く前に: [未ログインの投稿の保護の構成](docs/GUIDES/tech/security/008-anonymous-submission-protection.md#保護の構成)
- テーブル定義のファイルを追加する前に: [テーブル定義の配置](docs/GUIDES/tech/db/003-schema-conventions.md#テーブル定義の配置)
- テーブルの主キーを定義する前に: [主キー](docs/GUIDES/tech/db/003-schema-conventions.md#主キー)
- テーブルに作成日時・更新日時・論理削除のカラムを定義する前に: [共通カラム](docs/GUIDES/tech/db/003-schema-conventions.md#共通カラム)
- 初期データをマイグレーションで入れる前に: [初期データ](docs/GUIDES/tech/db/003-schema-conventions.md#初期データ)
- 全文検索の検索対象・索引文書のテーブル・検索のクエリを追加・変更する前に: [全文検索の索引の前提と用語](docs/GUIDES/tech/db/004-full-text-search.md#前提と用語)
- 下書きと公開した版を持つデータを設計する前に: [下書きと公開した版の管理の前提と用語](docs/GUIDES/tech/db/005-draft-and-published-versions.md#前提と用語)
- グループごとの最新の行で並べる一覧を作る前に: [グループごとの最新の行で並べる一覧の前提と用語](docs/GUIDES/tech/db/007-latest-row-per-group-listing.md#前提と用語)
- キーワード抽出の外部APIへ送る項目や呼び出し方を変える前に: [キーワード抽出の送る情報の範囲](docs/GUIDES/tech/external/002-natural-language-keyword-extraction.md#送る情報の範囲)
- マークダウンの入力欄・表示部品・検索語の強調を画面に置く前に: [マークダウンの入力欄と表示部品の前提と用語](docs/GUIDES/tech/frontend/008-markdown-editor-and-content.md#前提と用語)
- マークダウンの描画・サニタイズの許可リスト・サニタイズの後の変換を変える前に: [マークダウンのサニタイズの処理の順序](docs/GUIDES/tech/security/004-markdown-sanitization.md#処理の順序)
- アップロードを受け付ける処理やアップロードの用途を追加・変更する前に: [アップロードの安全対策の受付の順序](docs/GUIDES/tech/security/005-file-upload-security.md#受付の順序)
- 画像を配信する処理や、画面で画像を表示する部品を作る・変える前に: [画像の変換配信とエッジキャッシュの前提と用語](docs/GUIDES/tech/infra/008-image-delivery.md#前提と用語)
- 画像判定サービスを呼ぶ処理や判定の設定を変える前に: [画像判定サービスの前提と用語](docs/GUIDES/tech/external/003-image-moderation.md#前提と用語)
- 共有ディレクトリから別の共有ディレクトリ(共用部品など)を読み込む前に: [別の共有ディレクトリの参照](docs/GUIDES/tech/coding/003-shared-directories.md#別の共有ディレクトリの参照)
- 定期実行のジョブを追加する前に: [定期実行](docs/GUIDES/tech/infra/003-async-processing.md#定期実行)
- 非同期メッセージを送る処理や受信する処理を書く前に: [非同期メッセージ](docs/GUIDES/tech/infra/003-async-processing.md#非同期メッセージ)
- 定期実行のジョブやメッセージの処理で書き込みを行う前に: [重複配信と冪等性](docs/GUIDES/tech/infra/003-async-processing.md#重複配信と冪等性)
- メールを送る処理やメール種別・テンプレートを書く前に: [メールを送る](docs/GUIDES/tech/external/001-email-sending.md#メールを送る)
- バックエンドでログを出す前に: [ログの出力](docs/GUIDES/tech/infra/004-logging-and-error-tracking.md#ログの出力)
- ログの属性やエラーレポートに利用者の入力・秘密情報が入り得る処理を書く前に: [伏せ字の規則](docs/GUIDES/tech/infra/004-logging-and-error-tracking.md#伏せ字の規則)
- バックエンドで例外を投げる・エラートラッキングへ送る処理を書く前に: [エラートラッキング](docs/GUIDES/tech/infra/004-logging-and-error-tracking.md#エラートラッキング)
- トークンなどの秘密情報やレート制限のキーを保存・照合する前に: [ハッシュ化の対象](docs/GUIDES/tech/security/002-keyed-hashing.md#ハッシュ化の対象)
- メールのリンクで受け渡す認証系トークンを発行・照合する処理を書く前に: [認証系トークン](docs/GUIDES/tech/security/006-authentication.md#認証系トークン)
- ログインを要する重要な操作に本人確認を求める処理や、セッションを発行し直す処理を書く前に: [本人確認とセッションの入れ替え](docs/GUIDES/tech/security/006-authentication.md#本人確認とセッションの入れ替え)
- ユーザーの退会・停止・停止解除・物理削除に合わせて自分のデータを変える波及処理を書く前に: [ユーザーライフサイクルイベントの前提と用語](docs/GUIDES/tech/backend/007-user-lifecycle-events.md#前提と用語)
- ユーザー以外の集約の状態の変化を他の機能へ伝える処理を作る前に: [集約のライフサイクルイベントの前提と用語](docs/GUIDES/tech/backend/012-aggregate-lifecycle-events.md#前提と用語)
- 他の機能が判定の条件・表示の要約・保存の文を加える登録口を作る、またはその登録口に登録する前に: [判定の供給元と保存の処理の登録口の前提と用語](docs/GUIDES/tech/backend/013-pluggable-decision-sources.md#前提と用語)
- 期間を限った投票を作る前に: [期間を限った投票の前提と用語](docs/GUIDES/tech/backend/014-time-boxed-voting.md#前提と用語)
- 管理者側の操作に必要なロールを宣言する、または画面で操作をロールで出し分ける前に: [操作の認可](docs/GUIDES/tech/security/007-admin-authorization.md#操作の認可)
- 管理者のロールの変更や管理者の削除の書き込みを書く前に: [最後の最上位管理者の保護](docs/GUIDES/tech/security/007-admin-authorization.md#最後の最上位管理者の保護)
- 管理操作を監査ログに記録する処理を書く前に: [記録の規約](docs/GUIDES/tech/backend/008-audit-logging.md#記録の規約)
- 監査ログの操作種別を追加・変更する前に: [操作種別の登録](docs/GUIDES/tech/backend/008-audit-logging.md#操作種別の登録)
- 対象と操作種別から最新の監査ログの日時を照会する処理を書く前に: [最新の日時の照会](docs/GUIDES/tech/backend/008-audit-logging.md#最新の日時の照会)
- 上記の文書のプレースホルダーを本プロジェクトの値に読み替える前に: [本プロジェクト固有の値](docs/onboardings/project-values.md)

### Claude拡張ファイル間の矛盾、あるいは本プロジェクト規則との不一致について

Claude拡張ファイル(エージェント・スキル・ルール・コマンド)と本プロジェクト規則に矛盾がある場合、後者を優先する。

- Claude拡張ファイルが参照する別の拡張ファイルが存在しない場合は無視する。
- Claude拡張ファイル内でNext.jsやNestJS特有の記述が含まれている場合があり、無視するかTanStack StartやHonoでの記述に変換して判断する。
- Claude拡張ファイル内ではnpmやpnpm関連のコマンドが記載されているが、本プロジェクトでは全て代わりのbunコマンドを実行すること。
- npmパッケージの`framer-motion`は`motion`にリネームされているため、`motion/react`をインポートして利用する。`ecc:frontend-patterns`スキルが`framer-motion`を使ったサンプルコードを掲載しているが、それは古い情報である。
- APIレスポンス形式やバリデーションエラー時ステータスコードは`ecc:api-design`スキルの内容をベストプラクティスとして採用する。`ecc:coding-standards`のAPIレスポンス形式や、`rules/common/patterns.md`のAPIレスポンスフォーマット説明、`rules/typescript/patterns.md`の`ApiResponse<T>`型は採用しない。
- workerd環境では環境シークレット及び環境変数をWrangler設定に記載`env`バインディング経由で取得するため、多数のエージェント・スキル・ルールに記載されている`process.env`指定は採用しない。ただしViteやWranglerがビルド時に静的置換する`process.env.NODE_ENV`参照はこの方針の対象外である。
- `.claude/rules/typescript/hooks.md`がPostToolUseフックを`~/.claude/settings.json`に設定すべきと記載しているが、本プロジェクトでは`.claude/settings.json`に設定する。
- Stripe Payment Elementを使うためにはCheckout Sessions APIにて`ui_mode: 'elements'`オプションを使うこと。`stripe:stripe-best-practices`スキル内では`ui_mode: 'custom'`を使うよう案内しているが、それはリネーム前の古い情報である。
- `cloudflare:wrangler`スキルはローカル開発シークレットの管理に`.dev.vars`ファイルを作成するよう案内しているが、本プロジェクトでは`.dev.vars`や`.env`を使わず、Infisicalで一元管理する。
- `.claude/rules/common/development-workflow.md`が「Library docs second: Use Context7」と必須手順に定めているが、今回Context7 MCPは利用しない。
- テストについて
  - E2Eテストツールとして`ecc:e2e-runner`エージェントではVercel Agent Browserが先に挙げられているが、フォールバック扱いされているPlaywrightを本プロジェクトでは採用する。
  - Claude拡張ファイル内でJest関連のコマンドが記載されていても、Jestは使用しないこと。
  - `ecc:react-testing`スキルはコンポーネントレンダリングにReact Testing Libraryを使う前提で書かれているが、本プロジェクトでは代わりに採用する`vitest-browser-react`のAPIへ読み替える。

## Git運用方針

GitワークフローはGitLab Flow(環境ブランチ)を採用する。開発のトランクは`main`ブランチとし、featureブランチは`main`から分岐して短命に保ち、PRレビューを経て`main`にマージする。
mainブランチにpushした際、staging環境に自動でデプロイする。
prod環境には、`main`ブランチから`prod`ブランチへのPRマージ(push)をトリガーとしてデプロイが実行される。
`main`及び`prod`ブランチへのプルリクエストでは、GitHubのブランチ保護ルールにより各種チェック・テストが失敗した場合にマージをブロックする。
`prod`ブランチへのマージは、ブランチ保護ルールにより人間のレビュー承認を必須とし、AIエージェントによるprod環境へのデプロイを禁止する。
緊急のホットフィックスは`prod`から分岐した短命ブランチで行い、`prod`へ直接マージした後、`prod → main`へバックマージして両ブランチを同期する。
`main`及び`prod`ブランチはブランチ保護ルールにより削除を技術的に禁止する一方、featureやhotfixブランチはタスクを終えてマージした後に削除する。

## ディレクトリ構成

```
/
├── .claude/                    # Claude拡張設定 ... 詳細はClaude拡張ファイル解説(docs/onboardings/claude-extensions.md)を参照
├── .github/                    # GitHub ActionsによるCI/CD全般(検査・OpenTofu適用を含むデプロイ・リリースのプルリクエストの作成)を担当
│   ├── workflows/              # 起動条件ごとのワークフロー(pull-request・delivery・release-pr)と、検査(checks)・デプロイ(deploy)の再利用ワークフロー
│   ├── actions/                # 複合アクション ... 開発コンテナと同じ版のツールをジョブへ導入(setup-toolchain)
│   ├── CODEOWNERS              # 全ファイルのコードオーナー ... prodへのマージに人間の承認を求める
│   └── trufflehog-exclude-paths.txt # CIのシークレット検出(TruffleHog)の誤検知の除外 ... コミット前の検出の`.betterleaksignore`とは別に管理
├── .husky/                     # Huskyトリガー定義
├── .kiro/                      # cc-sddのプロジェクトメモリとspec状態
├── .wrangler/                  # WranglerのD1・R2ローカルモードの実データ(Git管理に含めない) ... `apps/api`や`apps/event`の`wrangler dev --persist-to /workspace/.wrangler/state`が生成
├── apps/                       # アプリケーション実装
│   ├── infra/                  # インフラ構成定義 ... OpenTofuを使用、Cloudflareを主としてインフラを設計
│   │   ├── environments/       # 環境(staging・prod)ごとの資源一覧 ... 資源の名前・管轄・ホスト名・stateの保管先・Infisicalの主体
│   │   ├── backends/           # 環境ごとのstateの保管先(R2)の部分設定
│   │   ├── live/               # ルートモジュール ... 資源一覧を読み、providerとstateの保管先・暗号化を設定して子モジュールを呼ぶ(両環境の結線のテストを含む)
│   │   └── modules/            # 子モジュール(storage・messaging・edge-services・worker-routing)とそのテスト
│   ├── db/                     # DBへの接続処理を含む
│   │   ├── migrations/         # DBマイグレーション履歴
│   │   ├── schema/             # DBスキーマ定義(旧ハンドルの列の共通の定義(`handles/`)、プロダクト(`product/`)、プロフィール(`profile/`)、フォロー(`follow/`)、マッチ(`match/`)、ヘルプ(`help/`)など)
│   │   ├── search/             # 全文検索の索引の定義と検証・SQLのひな形・検索のSQL断片・索引の定義の集約点・マイグレーションとの突き合わせ
│   │   └── scripts/            # 索引の定義からカスタムマイグレーションに貼る全文検索のSQLを出力するスクリプト
│   ├── email/                  # ローカル開発時のメールボックス(Git管理に含めない) ... Mailpitを使用
│   ├── backend-lib/            # バックエンド共通ファイル(node_modulesディレクトリは無し)
│   │   ├── core/               # 実行環境に依存しない部品 ... 検索対象の型・索引文書の組み立て・更新の計画・自然言語APIの要求と応答の解釈・キーワードの選別(`search/`)、アップロードの用途と受付の検証(`media/`)、管理者の照会口のポートと識別子(`admin/`)、問い合わせのデータエクスポートの契約と識別子(`inquiry/`)、決済の契約(購入種別の口・Stripeとの通信・反映・返金・通知のポート)と識別子・状態の前進と期限と返金の規則・Stripeの通知の正規化・返金のメッセージの契約・API版の固定(`payments/`)、定期課金の加入の契約と識別子・特典の継続期間と加入状態の規則・定期課金の状態の変化の解釈・加入が有効になった知らせの契約とメッセージと再試行の規則(`ultras/`)、ローンチの状態の導出・ライフサイクルの契約と登録の検証・要約と受賞のまとめ・照会と記録のポートと識別子(`product/`)、利用者のプロフィールの照会・エクスポート・フォローの契約と識別子(`profile/`)、マッチの状態の導出・開始時点と終了時の決着・予選のペアリングと偏りの無い乱数・マッチイベントの契約と登録の検証と再試行の方針・照会と予定の作成とイベントの記録と送信とエクスポートのポートと識別子(`match/`)などを含む
│   │   └── workers/            # workerdのAPI・バインディング・Honoに依存する部品 ... 検索対象の定義と集約点・索引の保存・更新の要求・共通の束縛(`search/`)、ファイルの記録と保存・アップロードの受付・隔離と削除・共通の束縛(`media/`)、管理者の照会口の実装と共通の束縛(`admin/`)、問い合わせのデータエクスポートの実装(`inquiry/`)、Stripeとの通信と署名の検証・決済のストアと版の検査付きの一括の書き込み・決済と請求と返金とチャージバックと定期課金の反映・返金の依頼・未完了の決済の失効・購入確認と自動返金の通知・価格の照会・純収益の照会・購入種別の登録箇所・共通の束縛(`payments/`)、定期課金の加入のストアと文の契約・特典の判定とエクスポート・購入の可否と権利の付与と定期課金の受け取り口の実装・知らせの送り出しとメールの依頼・共通の束縛(`ultras/`)、ハンドルの名前空間・旧ハンドルの文・解決(`handles/`)、ハンドルの名前空間・表示用とカテゴリの照会・予定のローンチと結果の記録・エクスポート・ライフサイクルの記録のストア・管理画面の検索・共通の束縛(`product/`)、プロフィールとフォローのストアと照会口の実装と共通の束縛(`profile/`)、マッチとサポーターの照会・予定の作成・イベントの記録とQueueへの送信・エクスポートの実装と共通の束縛(`match/`)、ヘルプ記事のハンドルの名前空間(`help/`)などを含む
│   ├── common-lib/             # フロントエンドとバックエンドの共用部品 ... マークダウンの描画とサニタイズ・書記素の文字数と禁止文字・入力の検証規則・検索語の正規化と検索式・強調表示の範囲・メディアの形式とアップロードのプロトコル・画像バリアントと配信のURL・管理者のロールと入力規則・監査ログの操作種別・法務文書の種類と名前と版の呼び名と利用者側のパスと入力規則・問い合わせの入力規則と違反の文言と添付の上限とステータスと標準カテゴリ・決済の購入種別と決済履歴の値と状態の値と金額と同意の文言と返金ポリシーの要旨と返金の理由の文と入力の規則、ハンドルの文字種と同一視と予約語(`handles/`)・プロダクトの入力規則と上限・画像の用途・標準カテゴリ(`product/`)・プロフィールの入力の上限と画像の用途(`profile/`)・対戦の側の配色の番号(`match/`)・ヘルプの入力規則と検索語の規則・記事のステータス・標準カテゴリ・並び順(`help/`)・外部Webサイトの絶対URLの検査(`url/`)・ディレクトリのURLのクエリの規則と期間のプリセット(`directory/`)・業務日付の表示の書式(`time/`)、攻撃パターン集
│   ├── api/                    # APIサーバー ... Honoを利用、フロントエンド向け内部API(GraphQL)と公開API(REST・OpenAPI仕様書)を提供
│   │   ├── db/                 # DBスキーマ定義(`apps/db`ディレクトリ)のバインド先、Dockerコンテナ内で利用可能
│   │   ├── lib/                # バックエンド共通ファイル(`apps/backend-lib`ディレクトリ)のバインド先、Dockerコンテナ内で利用可能
│   │   └── common-lib/         # 共用部品(`apps/common-lib`ディレクトリ)のバインド先、Dockerコンテナ内で利用可能
│   ├── event/                  # イベントサーバー ... Honoを利用、Stripe Webhookの受信と決済の反映・返金の実行・RFC 8058メール配信停止・Queuesのconsumer・画像配信ドメイン(SW-012)での画像の変換配信とエッジキャッシュ・画像判定と隔離・全文検索の索引の更新とキーワード抽出を担当
│   │   ├── scripts/            # 実際の外部API(キーワード抽出)への疎通確認のスクリプト
│   │   ├── db/                 # DBスキーマ定義(`apps/db`ディレクトリ)のバインド先、Dockerコンテナ内で利用可能
│   │   ├── lib/                # バックエンド共通ファイル(`apps/backend-lib`ディレクトリ)のバインド先、Dockerコンテナ内で利用可能
│   │   └── common-lib/         # 共用部品(`apps/common-lib`ディレクトリ)のバインド先、Dockerコンテナ内で利用可能
│   ├── frontend-lib/           # フロントエンド共通ファイル
│   │   ├── .storybook/         # Storybookの設定 ... Tailwind CSS・bot判定の偽物・配色の切替・固定の表示設定・アクセシビリティ検査の対象の絞り込み
│   │   ├── components/         # コンポーネント定義 ... Storybookによるプレビュー付き
│   │   ├── config/             # 画面を持つアプリが使う静的解析の規則とGraphQLのコード生成の検査、Viteのビルドのプラグイン(ビルドの出力からローカルのシークレットのファイルを除く)、設定ファイルとカタログの網羅性の検査、生のHTMLの例外の検査、エディタの事前バンドルの一覧とVueの機能フラグ
│   │   ├── scripts/            # マークダウンの入力欄の編集領域がページの最初の読み込みとサーバー側の描画に含まれないことの検査(`check:editor-chunks`)
│   │   ├── server/             # サーバーの部品 ... Workerの入口と処理の順序、環境の検証、CSRF・CSP・セキュリティヘッダー・IP制限、APIサーバーへの中継とセッションのCookie、ログとエラートラッキング
│   │   ├── start/              # TanStack Startとの接続 ... グローバルのミドルウェア、サーバーからブラウザへの例外の受け渡し、ルーターの文脈、GraphQLの実行、ページのhead、ブラウザ側のエラートラッキングの初期化
│   │   ├── styles/             # スタイル ... 配色のトークン、フォーカスの輪郭と視差効果を減らす設定での動きの抑制
│   │   ├── test/               # テストの補助 ... アクセシビリティの自動検査、キーボード操作・表示設定・配色の再現、テストの偽物
│   │   └── utilities/          # ユーティリティ
│   ├── client/                 # Webサーバー兼フロントエンド(利用者側) ... TanStack Startを利用、公開API向けSwagger UIページも含む
│   │   ├── lib/                # フロントエンド共通ファイル(`apps/frontend-lib`ディレクトリ)のバインド先、Dockerコンテナ内で利用可能
│   │   └── common-lib/         # 共用部品(`apps/common-lib`ディレクトリ)のバインド先、Dockerコンテナ内で利用可能
│   └── admin/                  # Webサーバー兼フロントエンド(管理者側) ... TanStack Startを利用
│       ├── lib/                # フロントエンド共通ファイル(`apps/frontend-lib`ディレクトリ)のバインド先、Dockerコンテナ内で利用可能
│       └── common-lib/         # 共用部品(`apps/common-lib`ディレクトリ)のバインド先、Dockerコンテナ内で利用可能
├── mockups/src/routes/         # 画面デザイン案 ... TanStack Start・Tailwind CSS・shadcn/uiを利用、フロントエンド共通ファイルは不使用
│   ├── client/                 # 利用者側画面のモックアップ
│   └── admin/                  # 管理者側画面のモックアップ
├── docs/                       # ドキュメント ... 全てマークダウン形式
│   ├── requirements/           # ソフトウェア要件定義書(IEEE 29148準拠、SSoT)
│   ├── onboardings/            # オンボーディングガイド ... ローカル環境の構築手順及びポート番号、技術選定、技術ドキュメントから除いた本プロジェクト固有の値
│   ├── ai-extensions/          # 外部由来のAIエージェント向けガイドライン(原文のまま配置)
│   ├── ai-prompts/             # 開発中に使用した主なプロンプトの記録
│   ├── adr/                    # ecc:architecture-decision-recordsスキルによる自動生成ADR
│   ├── tdd/                    # ecc:tdd-workflowスキルのステップ8によるTDDエビデンスレポート
│   ├── CODEMAPS/               # ecc:doc-updaterエージェントによる自動生成コードマップ
│   └── GUIDES/                 # 要件定義書を元にした開発者ドキュメント、ecc:doc-updaterエージェントにより都度更新
│       ├── tech/               # 本プロジェクトに限らず同じ技術選定のプロジェクトにコピーできる、技術的な資料
│       │   ├── infra/          # インフラ・ネットワーク構成図、IaC定義の構成と資源の追加方法、検査とデプロイのパイプライン、実行環境の設定規約と環境種別、ログ管理方針、非同期処理設計、画像の変換配信とエッジキャッシュ
│       │   ├── external/       # 各種外部APIの仕様(自然言語APIによるキーワード抽出・画像判定を含む)、料金、リクエスト制限、認証方式、エラーハンドリング及びリトライ戦略
│       │   ├── db/             # データベース設計原則、テーブル・カラムの命名規則、マイグレーションの生成と適用の手順、データベース固有の制約と対処、全文検索の索引の設計と同期・照合・再構築、下書きと公開した版の管理、利用者間の関係の保存と一覧、グループごとの最新の行で並べる一覧
│       │   ├── backend/        # バックエンドのコーディングルール ... アーキテクチャ設計(依存性注入を含む)、API設計、ユーザーライフサイクルイベント、監査ログの記録、外部の通知の冪等な反映、定期課金の加入状態と特典の判定、ハンドル(URLの識別子)の名前空間、集約のライフサイクルイベント、判定の供給元と保存の処理の登録口、期間を限った投票
│       │   ├── frontend/       # フロントエンドのコーディングルール ... アクセシビリティ規則、マークアップ規約、コンポーネント共通化対象、開発時とデプロイ前の起動方法、フロントエンドサーバーのセキュリティ、データ取得、フロントエンドの観測、マークダウンの入力欄と表示部品、管理画面のシェルと区画、表示中の画面の定期再取得、業務日付のカレンダー、集計値と残り時間を表示し続ける画面、URLのクエリで条件を持つ一覧
│       │   ├── coding/         # バックエンド/フロントエンド共通のコーディングルール ... JavaScript・TypeScriptの記法、設定ファイルの記述規約と基底設定の継承、整形検査・静的解析・型検査のコマンド、依存パッケージの版管理、共有ディレクトリの配置方式、GraphQL通信、入力値バリデーション
│       │   ├── testing/        # テスト方針(テストの種別と命名規約、実行コマンド)、カバレッジ設定、IaC定義のテストとCIでのE2Eテストの実行方法、デプロイ後のスモークテスト、TDDの進め方、E2Eテストツールの版の更新手順
│       │   ├── operations/     # 運用ガイド ... デプロイ手順(初回の準備・stagingへのデプロイ・prodへのリリース・hotfix)、障害対応、ロールバックと復旧、決済データ操作
│       │   └── security/       # 包括的なセキュリティガイド、認証認可設計、シークレット管理、CIのシークレットの供給経路とリポジトリ保護、マークダウンのサニタイズ、アップロードの安全対策、未ログインの投稿の保護、システム監視及び対応方針
│       └── service/            # 本プロジェクト特有の資料
│           ├── overview/       # サービス概要、コンセプト、料金及びプラン体系
│           ├── features/       # 国際化方針や決済実装方針など特筆すべき機能仕様
│           ├── design/         # デザインガイドライン ... 文字やパーツ配置に関するサービス固有の規則
│           └── legal/          # 法律及びコンプライアンス準拠方針、利用規約・プライバシーポリシーの大枠
├── config/                     # ルートと全アプリが参照する設定データ ... アプリ一覧と共有ディレクトリの配置先、テストの命名パターンとカバレッジ閾値、アプリ間で写した値とデバッガーの待ち受けポートの照合テスト
│   ├── eslint/                 # バックエンドのアプリ(api・event)が共通で読み込む層の静的解析規則
│   └── vitest/                 # ブラウザテスト・Workers統合テストのVitestプリセット、Workers統合テストへのD1マイグレーションの読み込み、単体テストで検査するソースのWorkers統合テストのカバレッジからの除外
├── e2e/                        # PlaywrightによるE2Eテスト(設定はルートの`playwright.config.ts`) ... 対象アプリ(`client`・`admin`)ごとのディレクトリ(機能ごとのサブディレクトリを含む)にテストと、その機能の画面の操作の手順(`<手順の名前>-steps.ts`)を置く
│   └── support/                # 対象アプリのURL解決、Playwrightの設定値の組み立て、到達確認、対象0件の表示、ローカルの定期実行を業務日付と業務時刻で起こす補助、応答のセキュリティヘッダー・nonce・CSPの違反の検査、疎通確認の画面の検査、Mailpitからの宛先ごとの最新のメールとリンクの読み取り、ブラウザの文脈ごとの接続元のIPの名乗り、ローカルのWorkerのオリジンの解決、APIサーバーのIPアドレス単位の制限の使い切り(サーバー側の描画での取得の失敗の再現)、多要素認証の認証コードの計算、画像のアップロードの欄への単色のPNGの送信、管理者の用意(招待の発行コマンドによる招待・画面での招待の完了・ロールの設定・再ログイン)とローカルのD1への書き込み
├── scripts/                    # 開発コンテナとツールのスクリプト ... コンテナ起動時の処理(Claude Codeの更新、ワークスペース信頼設定のマージ、RTKフックとベル音フックの登録、Chromiumの導入、常駐プロセスの起動)、Claudeの入力待ちや作業完了をホスト側のVSCodeのベル音で知らせる処理
│   ├── delivery/               # 検査・デプロイ・リリースの配布のスクリプト(`cli.ts`のサブコマンド) ... 依存パッケージの導入と脆弱性の確認、構成検査・ワークフローの検査・IaCの検査、Infisicalへのログインとシークレットの注入、CIでのE2Eの実行環境、デプロイの予行と各段階、リリースのプルリクエストの作成
│   └── tooling/                # 品質ゲートのツールスクリプト ... Gitフックの導入、コミット時の検査対象の振り分け、一括検査・一括実行、共有ディレクトリの配置、テスト命名の検査
├── test-support/               # ルートの単体テストの補助 ... 共通フィクスチャ、型だけの読み込みの判定、Git管理外の判定
├── Dockerfile                  # AIエージェントによる自動作業を安全に進める開発コンテナ
├── compose.yaml                # コンテナの管理
├── package.json                # プロジェクトルート ... Gitフック(husky・lint-staged・commitlint)によるgit管理の厳格化、ルート所有ファイルの整形・静的解析・型検査・単体テスト、全アプリの一括検査とテストの一括実行、共有ディレクトリの配置確認とCIでのコピー配置、PlaywrightによるE2Eテスト
├── bunfig.toml                 # 単体テスト(Bun)の共通設定 ... 他の種別の除外、カバレッジの閾値・除外・出力先
├── tsconfig.base.json          # ルートと全アプリが継承する型検査の基底設定
├── eslint.config.base.ts       # ルートと全アプリが使う静的解析の基底設定
├── prettier.config.ts          # リポジトリ全体の整形設定
└── README.md                   # サービス説明、各種ドキュメントへの索引
```
