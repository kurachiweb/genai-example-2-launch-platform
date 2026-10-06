# オンボーディングガイド — Launch Stadium

本プロジェクトに参加した開発者が、サービス像・仕様・インフラ・データベースを最短で把握し、ローカル環境を立ち上げるための入り口(索引)。

技術ドキュメント(`docs/GUIDES/tech`)は他のプロジェクトへ丸写しできるよう、本プロジェクト固有の値を一般的な表記で書いている。その手順やコマンドを本プロジェクトで使うときは、[本プロジェクト固有の値](project-values.md)に読み替える。

## ローカル開発環境クイックスタート

このクイックスタートは開発者向け手順書であり、AIエージェントはこのセクションのコマンドを実行しないこと。

1. ホスト環境: DockerをインストールしてDocker Desktopアプリを開く

   ```zsh
   brew install --cask docker-desktop # Macのみ
   ```

2. ホスト環境: コンテナ・イメージ・ボリュームの作成

   ```zsh
   docker compose up -d
   ```

3. VSCodeでコンテナにアタッチし、`/workspace`ディレクトリを開く
4. コンテナ内: Infisicalアカウントにログインする(初回のみ)

   ```sh
   infisical --telemetry=false login --domain https://eu.infisical.com
   # EUリージョンでログイン後、画面に表示されたトークンをこのターミナルに貼り付ける
   ```

5. コンテナ内: GitHubアカウントにログインする(初回のみ)

   ```sh
   gh auth login --web # HTTPSを選択後、表示されたワンタイムコードをブラウザ画面に貼り付ける
   ```

6. コンテナ内: WranglerをCloudflareアカウントと紐づける(初回のみ)

   ```sh
   wrangler login --device
   wrangler whoami # 認証確認
   ```

7. コンテナ内: Stripeアカウントにログインする(初回のみ)

   ```sh
   stripe login
   stripe whoami # 認証確認
   ```

8. コンテナ内: ルートの依存パッケージをインストールし、Gitフックを有効にする(初回のみ)

   ルートの`bun install`は、`package.json`の`prepare`スクリプト(`/workspace/scripts/tooling/install-git-hooks.ts`)を実行し、huskyでGitフックを有効にする。以後のコミットでは「[コミット時の検査](#コミット時の検査)」が行われる。

   ```sh
   cd /workspace
   bun install
   /workspace/scripts/setup-chromium.sh # コンテナの起動時にもこのスクリプトが実行されるが、ルートの`bun install`前はChromiumの導入を飛ばすため、ここで`bun install`で解決された`@playwright/test`の版に合わせて導入する
   ```

   - 環境変数`CI`が空でない環境(CI)や、`.git`の無い場所(リポジトリをGit管理外へコピーした場合など)では、Gitフックの導入を飛ばして`bun install`を成功させる。

9. コンテナ内: Claude向けMCPを認証する(初回のみ)

   ```sh
   claude mcp login cloudflare-api --no-browser # Cloudflareにログイン/認証後、「このサイトにアクセスできません」に遷移するのでURLをターミナルに入力する
   claude mcp login cloudflare-bindings --no-browser
   claude mcp login cloudflare-builds --no-browser
   claude mcp login cloudflare-observability --no-browser
   ```

10. コンテナ内: ローカルDBの初期化(マイグレーション適用)

    `apps/api`と`apps/event`は同一の`--persist-to`を指定することで、D1・R2ローカルモードの実データを共有する。そのためマイグレーション適用は`apps/api`側の1回のみでよい。

    ```sh
    cd /workspace/apps/api
    wrangler d1 migrations apply genai-example-2-dev --local --persist-to /workspace/.wrangler/state
    ```

11. コンテナ内: DBスキーマ定義の依存パッケージをインストール(初回のみ)

    ```sh
    cd /workspace/apps/db
    bun install
    ```

12. コンテナ内: アプリケーションの起動

    APIサーバー

    ```sh
    cd /workspace/apps/api
    bun install # 初回のみ
    infisical --telemetry=false run --env dev -- wrangler dev --port 48042 --ip 0.0.0.0 --persist-to /workspace/.wrangler/state
    ```

    イベントサーバー

    ```sh
    cd /workspace/apps/event
    bun install # 初回のみ
    infisical --telemetry=false run --env dev -- wrangler dev --port 48043 --ip 0.0.0.0 --persist-to /workspace/.wrangler/state
    ```

    利用者側フロントエンド

    ```sh
    cd /workspace/apps/client
    bun install # 初回のみ
    infisical --telemetry=false run --env dev -- bun run dev --port 48044 --host 0.0.0.0
    ```

    管理者側フロントエンド

    ```sh
    cd /workspace/apps/admin
    bun install # 初回のみ
    infisical --telemetry=false run --env dev -- bun run dev --port 48045 --host 0.0.0.0
    ```

    Storybookコンポーネントカタログ

    ```sh
    cd /workspace/apps/frontend-lib
    bun install # 初回のみ
    bun run storybook:dev --port 48046 --host 0.0.0.0
    ```

    利用者側・管理者側各画面モックアップ

    ```sh
    cd /workspace/mockups
    bun install # 初回のみ
    bun run dev --port 48047 --host 0.0.0.0
    ```

13. コンテナ内: デプロイ前動作確認

    ```sh
    # TanStack Startアプリを`@cloudflare/vite-plugin`経由でCloudflare Workers向けにビルドして動作確認(D1・R2のローカル永続化パスはvite.config.tsのpersistStateオプションで指定する)
    cd /workspace/apps/client
    infisical --telemetry=false run --env dev -- bunx vite build
    infisical --telemetry=false run --env dev -- bunx vite preview --port 48044 --host 0.0.0.0

    cd /workspace/apps/admin
    infisical --telemetry=false run --env dev -- bunx vite build
    infisical --telemetry=false run --env dev -- bunx vite preview --port 48045 --host 0.0.0.0
    ```

## コミット時の検査

コミットは開発コンテナ内で行う。クイックスタートの手順8で有効にしたGitフックが、コミットのたびに次を実行し、1つでも失敗するとコミットを中止する。

| フック       | 内容                                                                                                                                                                                                                                             |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pre-commit` | Betterleaksでステージした変更からシークレットを検出する(検出した値は伏せ字で表示する)。続いてlint-stagedで、ステージしたファイルに、所有するアプリのESLintによる自動修正とルートのPrettierによる整形を適用し、修正後の内容をそのコミットに含める |
| `commit-msg` | commitlintで、コミットメッセージの1行目が「型(任意のスコープ): 件名」の形式であり、型が`/workspace/commitlint.config.ts`の`ALLOWED_COMMIT_TYPES`のいずれかであることを確かめる                                                                   |

- Betterleaksは開発コンテナのイメージに導入され、lint-staged・ESLint・Prettierなどの依存パッケージも`node_modules`の名前付きボリュームとしてコンテナ側にだけある。ホスト環境のGitクライアントなどBetterleaksの無い環境でコミットすると、シークレット検出を飛ばしたコミットを作らないよう、`pre-commit`フックが開発コンテナ内でのコミットを案内してコミットを中止する。
- 自動修正できない静的解析の違反が残ると、ファイル・行・規則を表示してコミットを中止する。直し方は「[検査コマンド](../GUIDES/tech/coding/001-javascript-typescript-conventions.md#検査コマンド)」に従う。
- ステージしたファイルを所有するアプリに静的解析ツールが導入されていないと、そのアプリでの`bun install`を案内してコミットを中止する。アプリの`package.json`に品質ツールがまだ宣言されていない場合は、`bun install`では解消しないため、「[アプリへの品質ツールの導入](#アプリへの品質ツールの導入)」の手順で導入する。

### シークレットを検出したとき

1. 検出結果に表示されるファイルのパス・検出規則・行番号で、検出箇所を確かめる。
2. 本物のシークレットであれば、ファイルから取り除いてInfisicalで管理し、ステージし直してからコミットする。
3. 誤検知であれば、検出結果から`<ファイルのパス>:<検出規則>:<行番号>`の形式のFingerprintを作り、`/workspace/.betterleaksignore`に1行で追記する。`.betterleaksignore`もステージして同じコミットに含め、誤検知と判断した理由をコミットメッセージに残す。

Fingerprintの書式の注意(行末にコメントを付けない、行番号が変わったら登録し直す)、`git revert`・`git cherry-pick`がフックを通らないこと、調査時の注意(`GIT_TRACE=1`・`--log-level debug`)は「[シークレットの管理](../GUIDES/tech/security/001-secret-management.md#シークレットの検出)」の「シークレットの検出」に従う。

## compose.yamlを変更したとき

`compose.yaml`を変更したら(特に共有ディレクトリのbind mountや、`node_modules`の名前付きボリュームのマウント)、ホスト環境でコンテナを再作成する。実行中のコンテナには`compose.yaml`の変更が反映されず、変更前のマウントが残るためである。

```zsh
docker compose up -d # 設定が変わったコンテナを作り直す。ログイン情報などの名前付きボリュームは引き継がれる
```

再作成後、コンテナ内で共有ディレクトリの配置状態を確かめる。

```sh
cd /workspace
bun run shared-dirs:verify
```

- 変更前のマウントが残ると、例えば共有ディレクトリの`node_modules`を利用側アプリの配置先(`apps/api/db`など)へ見せるマウントにより、共有ディレクトリのコードと利用側アプリが同じパッケージを別々の実体として読み込む(二重実体)。
- この状態は、`bun run shared-dirs:verify`と、その確認を最初の段階で行う一括検査`bun run check`が、`non-empty-node-modules`(配置先のマウントの誤りは`mount-mismatch`)として検出し、コンテナの再作成を案内する。各状態の意味は「[配置状態](../GUIDES/tech/coding/003-shared-directories.md#配置状態)」を参照する。

## アプリへの品質ツールの導入

品質ゲートの対象のアプリ(`/workspace/config/workspace-layout.ts`の`APPS`に登録するアプリ)を新しく作るときは、静的解析・整形・型検査の品質ツールを、[主要パッケージの一覧](../GUIDES/tech/coding/002-dependency-versions.md#主要パッケージの一覧)の版でdevDependenciesとして導入する。導入するパッケージは「[導入する品質ツール](../GUIDES/tech/coding/001-javascript-typescript-conventions.md#導入する品質ツール)」に従い、版は主要パッケージの一覧を正として確かめてから指定する(一覧に無い`@types/bun`はルートと同じ版にする)。

```sh
cd /workspace/apps/<アプリ>
bun add --dev --exact <パッケージ>@<版> <パッケージ>@<版> # 導入する品質ツールの全パッケージを、版を明示して並べる
```

- `^`・`~`の範囲指定や、版を指定しない追加をしない(「[版を指定しない追加の禁止](../GUIDES/tech/coding/002-dependency-versions.md#版を指定しない追加の禁止)」)。
- 追加後の`package.json`と`bun.lock`を同じコミットに含める。他の開発者は、そのアプリで`bun install`を実行すれば同じ版が入る。初期設定を済ませた後でも、版の追加・更新を含むコミットを取り込んだら該当アプリで`bun install`を再実行する(版の更新ではコミット時の検査も一括検査も案内を出さないため、古い版が残り得る)。
- 一覧の版を更新するときは、「[全アプリの版をそろえる手順](../GUIDES/tech/coding/002-dependency-versions.md#全アプリの版をそろえる手順)」に従い、それを使うすべての場所を同じ版にそろえる。
- アプリをコミット時の検査と一括検査の対象にするには、品質ツールの導入に加え、`APPS`への登録、基底設定を継承する`tsconfig.json`・`eslint.config.ts`、スクリプト契約の定義が必要である(「[一括検査への参加](../GUIDES/tech/coding/001-javascript-typescript-conventions.md#一括検査への参加)」)。

## 日常の検査とテスト

ルート(`/workspace`)で実行する主なコマンド。各コマンドの詳細とアプリ内での実行方法は、「[検査コマンド](../GUIDES/tech/coding/001-javascript-typescript-conventions.md#検査コマンド)」と「[実行コマンド](../GUIDES/tech/testing/001-test-strategy.md#実行コマンド)」に従う。

| コマンド                                                                       | 内容                                                                                                                            |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `bun run check`                                                                | 共有ディレクトリの配置確認・テスト命名の検査・整形検査・全アプリの静的解析と型検査を一括で実行する                              |
| `bun run format`                                                               | リポジトリ全体を整形する                                                                                                        |
| `bun run test:all:unit`・`bun run test:all:browser`・`bun run test:all:worker` | ルートと全アプリの単体テスト・ブラウザテスト・Workers統合テストを種別ごとに一括で実行する(`--coverage`を付けると各アプリへ渡る) |
| `bun run test:e2e`                                                             | E2Eテストを実行する(対象のアプリは事前に起動しておく)                                                                           |

## ローカルポート一覧

| アプリ              | 役割                                   | ポート |
| ------------------- | -------------------------------------- | ------ |
| Mailpit             | メール確認Web UI・HTTP送信API          | 48041  |
| `apps/api`          | APIサーバー(Hono)                      | 48042  |
| `apps/event`        | イベントサーバー(Hono)                 | 48043  |
| `apps/client`       | 利用者側フロントエンド(TanStack Start) | 48044  |
| `apps/admin`        | 管理者側フロントエンド(TanStack Start) | 48045  |
| `apps/frontend-lib` | Storybookコンポーネントカタログ        | 48046  |
| `mockups`           | 利用者側・管理者側各画面モックアップ   | 48047  |

ローカルではD1の代わりにWranglerのD1ローカルモード、Cloudflare Email Serviceの代わりにMailpit、Cloudflare R2の代わりにWranglerのR2ローカルモードを使う。
