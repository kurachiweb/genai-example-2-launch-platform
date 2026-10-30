# オンボーディングガイド — Launch Stadium

本プロジェクトに参加した開発者が、サービス像・仕様・インフラ・データベースを最短で把握し、ローカル環境を立ち上げるための入り口(索引)。

技術ドキュメント(`docs/GUIDES/tech`)は他のプロジェクトへ丸写しできるよう、本プロジェクト固有の値を一般的な表記で書いている。その手順やコマンドを本プロジェクトで使うときは、[本プロジェクト固有の値](project-values.md)に読み替える。

## ローカル開発環境クイックスタート

このクイックスタートは開発者向け手順書である。AIエージェントは、手順1〜11(ホスト環境の操作・各サービスへのログインと認証・依存パッケージの初期導入・シークレットの登録)のコマンドを実行しないこと。手順12〜14(ローカルDBの初期化・アプリケーションの起動・デプロイ前動作確認)は、AIエージェントも動作確認のために実行してよく、起動したプロセスは確認を終えたら止める。

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

   - 環境変数`CI`が空でない環境(CI)や、`.git`の無い場所(リポジトリをGit管理外へコピーした場合など)では、Gitフックの導入を飛ばして`bun install`を成功させる。huskyの無効化を示す環境変数`HUSKY`が`0`の場合も同様に導入を飛ばすが、開発コンテナでのコミットは常にGitフックを通す。

9. コンテナ内: Claude向けMCPを認証する(初回のみ)

   ```sh
   claude mcp login cloudflare-api --no-browser # Cloudflareにログイン/認証後、「このサイトにアクセスできません」に遷移するのでURLをターミナルに入力する
   claude mcp login cloudflare-bindings --no-browser
   claude mcp login cloudflare-builds --no-browser
   claude mcp login cloudflare-observability --no-browser
   ```

10. コンテナ内: DBスキーマ定義・APIサーバー・イベントサーバー・フロントエンド共通ファイル・利用者側と管理者側のフロントエンドの依存パッケージをインストールする(初回のみ)

    ```sh
    cd /workspace/apps/db
    bun install
    cd /workspace/apps/api
    bun install
    cd /workspace/apps/event
    bun install
    cd /workspace/apps/frontend-lib
    bun install
    cd /workspace/apps/client
    bun install
    cd /workspace/apps/admin
    bun install
    ```

    - `apps/db`と`apps/backend-lib`は、`apps/api`・`apps/event`へ`db`・`lib`として配置される共有ディレクトリである(「[共有ディレクトリの配置先](project-values.md#共有ディレクトリの配置先)」)。`apps/backend-lib`は依存パッケージを持たず、配置先のアプリの依存パッケージで動く。`apps/db`の依存パッケージは、`apps/db`で実行するマイグレーションの生成に使う。
    - `apps/frontend-lib`は、`apps/client`・`apps/admin`へ`lib`として配置される共有ディレクトリである。自身の依存パッケージで静的解析・テスト・カタログ(Storybook)を動かし、配置先では`apps/client`・`apps/admin`の依存パッケージで動く。ルートの整形検査(`bun run format:check`)は`apps/frontend-lib`・`apps/client`・`apps/admin`の整形の設定がそれぞれの`node_modules`から整形のプラグインを読み込むため、この3つの`bun install`の前は失敗する。
    - 依存パッケージの版の追加・更新を含むコミットを取り込んだら、該当するディレクトリで`bun install`を再実行する。

11. コンテナ内: シークレットをInfisicalに登録する(初回のみ、開発者の手作業)

    `apps/api`・`apps/event`・`apps/client`・`apps/admin`は、起動時に次のシークレットを必要とする。Infisicalのプロジェクトのローカル環境(`dev`)のルートフォルダ(`/`)に、Webの管理画面で登録する。登録済みであれば飛ばす。各値の意味は「[バインディング・変数・シークレット](project-values.md#バインディング変数シークレット)」を参照する。

    | キー                    | 登録する値                                                           | 使うアプリ                                            |
    | ----------------------- | -------------------------------------------------------------------- | ----------------------------------------------------- |
    | `HASH_PEPPER`           | 次の`openssl rand -hex 64`で生成した128文字の16進数                  | `apps/api`・`apps/event`・`apps/client`・`apps/admin` |
    | `TURNSTILE_SECRET_KEY`  | 常に成功するテスト用の秘密鍵`1x0000000000000000000000000000000AA`    | `apps/api`                                            |
    | `EMAIL_SMOKE_TOKEN`     | 次の`openssl rand -hex 32`で生成した64文字の16進数                   | `apps/event`                                          |
    | `EMAIL_SMOKE_RECIPIENT` | 疎通確認メールの宛先。任意のアドレス(例:`smoke@local.example`)でよい | `apps/event`                                          |

    ```sh
    openssl rand -hex 64 # 出力をHASH_PEPPERとして登録し、ファイルやチャットに残さない
    openssl rand -hex 32 # 出力をEMAIL_SMOKE_TOKENとして登録し、ファイルやチャットに残さない
    infisical --telemetry=false run --env dev -- sh -c 'test -n "$HASH_PEPPER" && test -n "$TURNSTILE_SECRET_KEY" && echo "登録済み"' # 値を表示せずに登録を確かめる
    infisical --telemetry=false run --env dev -- sh -c 'test -n "$EMAIL_SMOKE_TOKEN" && test -n "$EMAIL_SMOKE_RECIPIENT" && echo "疎通確認のシークレットも登録済み"'
    ```

    - `HASH_PEPPER`は4アプリで1つの値を共有し、アプリごとに別の値を登録しない。`apps/client`・`apps/admin`はWorker単位のIP制限のキーのハッシュ化に使う(「[フロントエンドのキーのハッシュ化](../GUIDES/tech/frontend/003-frontend-server-security.md#キーのハッシュ化)」)。
    - `apps/client`・`apps/admin`の起動・ビルド・プレビューのコマンドも、Infisicalからの注入を付けて実行する(注入を付けないとWranglerが`HASH_PEPPER`の不足を警告して`.dev.vars`の作成を促し、すべての要求が環境の検証で500になる。`.dev.vars`は作らない)。ただし手順14の環境別のビルドは、理由を同じ手順に記したとおり注入を付けない。
    - `apps/api`・`apps/event`を未登録のまま起動すると、`wrangler dev`が足りないキーを警告し、ヘルスチェック以外の経路が環境の検証で500になる。ヘルスチェックは環境の検証より前に応答するため、未登録でも200を返す。
    - `EMAIL_SMOKE_TOKEN`・`EMAIL_SMOKE_RECIPIENT`は、メールの疎通確認の経路(「[疎通確認の経路](#疎通確認の経路)」)だけが使う。未登録でもイベントサーバーは環境の検証に通り、疎通確認の経路だけが404になる。ローカル環境ではMailpitが全ての宛先のメールを受け取るため、外部へは送られない。
    - `dev`には、APIサーバーとイベントサーバーのWorkerごとのフォルダ(`/workers/api`・`/workers/event`)もある。同じキー名でWorkerごとに異なる値が要るシークレットを置き、現時点では空である。各環境のフォルダとキーの一覧は「[Workerのシークレットのキーの一覧](project-values.md#workerのシークレットのキーの一覧)」を参照する。

12. コンテナ内: ローカルDBの初期化(マイグレーション適用)

    `apps/api`と`apps/event`は同一の`--persist-to`を指定することで、D1・R2ローカルモードの実データを共有する。そのためマイグレーション適用は`apps/api`側の1回のみでよい。`apps/client`・`apps/admin`も`vite.config.ts`の`persistState`に同じ保存先を指定する。4アプリの保存先(`--persist-to`のすべての出現と`persistState`)が一致することは、ルートの単体テスト`config/local-state-path.unit.test.ts`が確かめる。`db:migrate:local`は`wrangler d1 migrations apply genai-example-2-dev --local --persist-to /workspace/.wrangler/state`を実行する。

    ```sh
    cd /workspace/apps/api
    bun run db:migrate:local
    ```

    - DBスキーマを変えたときは「[DBスキーマを変更したとき](#dbスキーマを変更したとき)」の手順でマイグレーションを生成して適用する。

13. コンテナ内: アプリケーションの起動

    Wranglerは開発コンテナのNode.jsで動く(`node --version`がv26を返す。Bunで動かすと`wrangler dev`がHTTPに応答しない。理由は「[Wranglerを動かす実行環境](../GUIDES/tech/infra/001-wrangler-conventions.md#wranglerを動かす実行環境)」)。`node --version`がBunの版を返す古いコンテナでは、コンテナを作り直す。

    APIサーバーとイベントサーバーは、`infisical run`の代わりに配布のスクリプトの`run-with-secrets --scope local --worker <Worker>`でシークレットを注入して起動する。Infisicalの`dev`の共通のフォルダ(`/`)の値に、そのWorkerのフォルダ(`/workers/api`・`/workers/event`)の値を重ね、デプロイとCIのE2Eと同じ規則でWorkerごとの値を渡すためである(「[シークレット注入の実行接頭辞](project-values.md#シークレット注入の実行接頭辞)」)。

    APIサーバー(`bun run dev`は`wrangler dev --port 48042 --ip 0.0.0.0 --persist-to /workspace/.wrangler/state --test-scheduled`を実行する)

    ```sh
    cd /workspace/apps/api
    bun /workspace/scripts/delivery/cli.ts run-with-secrets --scope local --worker api -- bun run dev
    ```

    イベントサーバー(`bun run dev`は`wrangler dev --port 48043 --ip 0.0.0.0 --persist-to /workspace/.wrangler/state --inspector-port 9230`を実行する。APIサーバーと同時に起動するため、開発者ツールの接続先(インスペクター)を既定の9229と重ならない9230にしている。利用者側・管理者側のフロントエンドは`vite.config.ts`でインスペクターのポートを9231・9232に固定しているため、4つを同時に起動しても重ならない)

    ```sh
    cd /workspace/apps/event
    bun /workspace/scripts/delivery/cli.ts run-with-secrets --scope local --worker event -- bun run dev
    ```

    両サーバーの起動後、別のターミナルでヘルスチェックに到達できることを確かめる。どちらも200と本文`{"status":"ok"}`を返す。

    ```sh
    curl -i http://localhost:48042/health
    curl -i http://localhost:48043/health
    ```

    APIサーバーの定期実行は自動では起動しないため、「[定期実行の手動起動](#定期実行の手動起動)」の手順で起こす。GraphQLの操作は、ブラウザで「[ローカルのGraphiQL](#ローカルのgraphiql)」から試せる。

    利用者側・管理者側のフロントエンドは、Service Bindingsで接続するAPIサーバーを先に起動し、ヘルスチェックが200を返してから起動する。APIサーバーが起動していない間は、疎通確認の画面が「APIサーバーへ到達できません。」を表示する(「[別プロセスのWorkerへのService Bindings](../GUIDES/tech/frontend/002-tanstack-start-on-workers.md#別プロセスのworkerへのservice-bindings)」)。起動はAPIサーバー→(必要ならイベントサーバー)→利用者側→管理者側の順に、前のサーバーが応答するのを待ってから次を起動する。

    利用者側フロントエンド(`bun run dev`は`vite dev`を実行する。`--port`を付けないとViteの既定のポートで起動し、E2Eテストの既定のURLに届かない)

    ```sh
    cd /workspace/apps/client
    infisical --telemetry=false run --env dev -- bun run dev --port 48044 --host 0.0.0.0
    ```

    管理者側フロントエンド

    ```sh
    cd /workspace/apps/admin
    infisical --telemetry=false run --env dev -- bun run dev --port 48045 --host 0.0.0.0
    ```

    両フロントエンドの起動後、ブラウザで`http://localhost:48044/system/status`・`http://localhost:48045/system/status`の疎通確認の画面を開き、「サーバー側の描画時の結果」にAPIサーバーの時刻と「到達可能」が表示され、「再確認」を押すと「ブラウザからの再確認の結果」にも同じ表示が出ることを確かめる。経路は「[フロントエンドサーバーの経路](project-values.md#フロントエンドサーバーの経路)」を参照する。

    - 開発サーバーは、ハイドレーションが終わる前の最初のクリックを取りこぼすことがある。「再確認」が反応しなければ、もう一度押す。
    - 時刻は分の単位で表示するため、再確認で結果が更新されたことは時刻からは見分けられない。
    - 操作(`.graphql`ファイル)を変えたときは、起動の前に「[GraphQLのスキーマや操作を変更したとき](#graphqlのスキーマや操作を変更したとき)」の手順で生成と許可リストの再生成を行う。

    Storybookコンポーネントカタログ(`apps/frontend-lib`の部品のカタログ。書き方は「[カタログの書き方](../GUIDES/tech/frontend/005-shared-components.md#カタログの書き方)」)

    ```sh
    cd /workspace/apps/frontend-lib
    bun run storybook:dev --port 48046 --host 0.0.0.0
    bun run storybook:build # 静的なカタログを出力してビルドが通ることを確かめる場合
    ```

    利用者側・管理者側各画面モックアップ

    ```sh
    cd /workspace/mockups
    bun install # 初回のみ
    bun run dev --port 48047 --host 0.0.0.0
    ```

14. コンテナ内: デプロイ前動作確認

    TanStack Startアプリを`@cloudflare/vite-plugin`経由でCloudflare Workers向けにビルドし、ビルド後のプレビューで動作を確かめる(`bun run build`は`vite build`、`bun run preview`は`vite preview`を実行する。D1・R2のローカル永続化パスは、手順12のとおり`vite.config.ts`の`persistState`で指定している)。手順13と同じく、APIサーバーを先に起動しておく。

    ```sh
    cd /workspace/apps/client
    infisical --telemetry=false run --env dev -- bun run build
    infisical --telemetry=false run --env dev -- bun run preview --port 48044 --host 0.0.0.0

    cd /workspace/apps/admin
    infisical --telemetry=false run --env dev -- bun run build
    infisical --telemetry=false run --env dev -- bun run preview --port 48045 --host 0.0.0.0
    ```

    - 開発サーバーとプレビューは同じポートを使うため、同じアプリの両方を同時に起動しない。プレビューの前に開発サーバーを止める。
    - プレビューでも、手順13と同じく疎通確認の画面と「[ローカルでのE2Eテスト](#ローカルでのe2eテスト)」で確かめる。
    - `@cloudflare/vite-plugin`は注入の下のビルドで`HASH_PEPPER`を`dist/server/.dev.vars`として書き出すが、`apps/client`・`apps/admin`の`vite.config.ts`は共通部品の`excludeLocalSecretsFile`(`lib/config/local-secrets-output.ts`)でこのファイルを出力から除く。プレビューは`dist/server/wrangler.json`の`secrets.required`の`HASH_PEPPER`を注入した環境変数から読むため、ビルドとプレビューの両方に注入を付ける(「[ビルド結果のシークレットのファイル](../GUIDES/tech/frontend/002-tanstack-start-on-workers.md#ビルド結果のシークレットのファイル)」)。プレビューの起動時に`Using secrets defined in process.env`と表示されれば、ファイルではなく注入から読んでいる。
    - ビルドが出力する500kBを超えるチャンクの警告と、`@cloudflare/vite-plugin`がAIエージェントの実行を検出したときの案内は、想定どおりの表示である。

    デプロイ先の環境の設定(Worker名・`API`の接続先・`namespace_id`・変数)は、環境を指定したビルドの出力`dist/server/wrangler.json`で確かめる(「[デプロイ先の環境のビルド時の指定](../GUIDES/tech/frontend/002-tanstack-start-on-workers.md#デプロイ先の環境のビルド時の指定)」)。期待する値は「[Workerとリソースの名前と識別子](project-values.md#workerとリソースの名前と識別子)」を参照する。

    ```sh
    cd /workspace/apps/client
    CLOUDFLARE_ENV=staging bun run build # 出力の設定を確かめるだけで、ビルドはシークレットを使わないため注入を付けない
    infisical --telemetry=false run --env dev -- bun run build # 確かめた後、ローカル環境向けにビルドし直す
    ```

    - 環境を指定したビルドは、ローカル環境向けの`dist`を上書きする。ローカル環境でプレビューする前に、環境を指定せずにビルドし直す。
    - ビルドは、Git管理外の`apps/client/.wrangler/deploy/config.json`・`apps/admin/.wrangler/deploy/config.json`も作る。
    - `staging`・`prod`のビルドでは、Wranglerが`HASH_PEPPER`・`SENTRY_DSN`の不足を警告するが無視してよい。シークレットの値は出力に含まれない。

## ローカルでのE2Eテスト

ローカルで起動したアプリに対して、すべてのE2Eテストを実行する。デプロイの後に公開のURLに対して`@smoke`タグのテストだけを実行する「[デプロイ後のスモークテスト](../GUIDES/tech/testing/001-test-strategy.md#デプロイ後のスモークテスト)」とは別である。

利用者側・管理者側の疎通確認の画面で、応答のセキュリティヘッダーとnonce付きのCSP、APIサーバーの時刻と「到達可能」の表示、再確認、ハイドレーションの後も再確認までは中継へ取得し直さないこと、CSPの違反が起きないこと、存在しないページの404、クロスサイトを名乗る中継の要求の403、スクリプトの読み込み方、静的なファイルがWorkerを通らずに配信されること、管理者側の画面にフッターが無いことを、PlaywrightのE2Eテスト(`e2e/client/system-status.e2e.test.ts`・`e2e/admin/system-status.e2e.test.ts`)で確かめる。クイックスタートの手順13の開発サーバーか、手順14のプレビューで、APIサーバー・利用者側・管理者側を起動してから実行する。両方の起動で続けて確かめるときは、「[開発サーバーとビルド後のプレビューの両方での実行](#開発サーバーとビルド後のプレビューの両方での実行)」のコマンドを使う。

```sh
cd /workspace
bun run test:e2e
```

- 対象のURLは`E2E_CLIENT_URL`・`E2E_ADMIN_URL`で上書きでき、既定はローカルの`http://localhost:48044`・`http://localhost:48045`である(「[テスト戦略の前提と用語](../GUIDES/tech/testing/001-test-strategy.md#前提と用語)」)。デプロイ先検証環境に向けるときは、2つの環境変数に`staging`のURL(「[配信URL一覧](../../README.md#配信url一覧)」)を指定する。
- ローカル環境にはアクセス解析のトークン・エラートラッキングのDSN・bot判定のウィジェットが無いため、それらに関わる確認は対象が無ければ飛ばし、飛ばしたことをテストの結果の注記(「確認の省略」)に残す。エラートラッキングのSDKの静的な取り込み、静的なファイルのセキュリティヘッダー、静的なファイルがWorkerを通らずに配信されること(`/assets/*.js`と`/favicon.ico`の応答に`no-store`も`X-Robots-Tag`も無く、`/assets/*.js`は`immutable`で長期キャッシュされる)の確認は、ビルド後の対象(プレビュー・`staging`)でだけ行い、開発サーバーでは飛ばしたことを注記に残す。
- 並列数(Playwrightのワーカーの数)の上限は既定で2である。開発サーバーに対して多く並列に実行するとworkerdが機械の負荷で落ちることがあるため、ローカルもCIも`E2E_WORKERS`を設定せずに同じ上限で実行する。一時的に変えたいときだけ`E2E_WORKERS=1 bun run test:e2e`のように1以上の整数を指定する(1以上の整数でなければ設定の読み込みで失敗する)。コマンドの`--workers`の引数は`E2E_WORKERS`より優先される(「[E2Eテストの実行](../GUIDES/tech/testing/001-test-strategy.md#e2eテストの実行)」)。
- 存在しないページを開いたときのブラウザのコンソールの読み込みの失敗は、404の応答によるもので想定どおりである。
- 開発サーバーに対する実行では、最初の再確認のクリックがハイドレーションの前で取りこぼされることがあるため、テストは再確認の案内が消えるまで押し直して確かめる。案内が消えた後は押さないため、中継への要求は再確認の1件だけになる。

### 開発サーバーとビルド後のプレビューの両方での実行

ルートの`bun run test:e2e:dev-and-preview`は、利用者側・管理者側のフロントエンドを開発サーバー(`bun run dev --port 48044 --host 0.0.0.0`・`bun run dev --port 48045 --host 0.0.0.0`)で起動してE2Eテストを実行し、止めてから`bun run build`の後にプレビュー(`bun run preview`に同じ引数)で起動して、同じE2Eテストを実行する。開発サーバーでは飛ばすビルド後の対象だけの確認も、同じ1回の実行のプレビューの段階で確かめる。

1. APIサーバーをクイックスタートの手順13のとおり先に起動し、ヘルスチェックが200を返すことを確かめる。このコマンドはAPIサーバーを起動しない。
2. 利用者側・管理者側のフロントエンドは起動しないでおく。48044・48045のどちらかが使われていると、何も起動せずにポートと対象を示して失敗する。
3. コマンド全体をInfisicalの注入の下で実行する。注入したシークレットは、起動する両フロントエンドとE2Eテストへ引き継がれる。

```sh
cd /workspace
infisical --telemetry=false run --env dev -- bun run test:e2e:dev-and-preview
```

- 最後に段階ごとの結果の表を表示する。実行の順序、失敗した段階があるときの続け方と終了コード、起動しなかったときの表示、中断の扱いは「[開発サーバーとビルド後のプレビューの両方での実行](../GUIDES/tech/testing/001-test-strategy.md#開発サーバーとビルド後のプレビューの両方での実行)」に従う。
- プレビューの段階の`bun run build`は環境を指定しないビルドのため、`apps/client`・`apps/admin`の`dist`をローカル環境向けのビルドで上書きする。
- 注入の下のビルドでも、`dist/server/`にシークレットのファイルは残らない(手順14)。プレビューの段階は、注入したシークレットを環境変数から読む。

## 定期実行の手動起動

ローカルの`wrangler dev`は、Cron Triggersを決まった時刻に自動では起こさない。APIサーバーは`bun run dev`により`--test-scheduled`付きで起動するため、次の経路への要求で、任意の業務時刻の定期実行を起こせる。イベントサーバーは定期実行を持たない。

```sh
# 業務日付2026-11-02の業務時刻4:21(UTCの2026-11-02 12:21)の定期実行を起こす
curl "http://localhost:48042/cdn-cgi/local/scheduled?cron=21+12+*+*+*&time=1793622060000"
```

- `cron`はUTCのcron式で、空白を`+`にする。業務時刻はUTC-08:00のため、業務時刻に8時間を足した時刻がUTCの時刻になる(「[業務時刻](project-values.md#業務時刻)」)。
- `time`は予定時刻のUTCのミリ秒である。`bun -e "console.log(Date.UTC(2026, 10, 2, 12, 21))"`のように求める(月は0始まり)。
- 応答は、ジョブが失敗しても200になる。ジョブの結果は、APIサーバーのログとデータの状態で確かめる。登録したジョブの無い式では、`warning`のログが出るだけである。
- E2Eテストからは、共有の補助`e2e/support/scheduled-trigger.ts`の`triggerScheduled({ worker: 'api', businessDate, businessTime })`で、業務日付と業務時刻を指定して起こす。cron式と予定時刻は補助が求め、APIサーバーのURLは環境変数`E2E_API_URL`で上書きできる(「[E2Eからの起動](../GUIDES/tech/infra/003-async-processing.md#e2eからの起動)」)。

## ローカルのGraphiQL

ローカル環境のAPIサーバーは、外部経路のGraphQLの経路でGraphiQLの画面を返す。クイックスタートの手順13でAPIサーバーを起動し、ブラウザで次のURLを開く。

```text
http://localhost:48042/graphql
```

画面の左の編集欄に操作の本文を書いて実行する。例えば、次の操作でAPIサーバーの時刻とデータベースへの到達可否を確かめられる。

```graphql
query {
  systemStatus {
    serverTime
    databaseReachable
  }
}
```

- GraphiQLの要求は、許可リストに無い操作の本文とintrospectionも実行できる。補完やスキーマの参照はintrospectionで動く。クエリの上限は内部経路と同じく適用する(「[introspectionとGraphiQL](../GUIDES/tech/backend/004-graphql-server.md#introspectionとgraphiql)」)。
- 呼び出し元とセッション識別子は、画面の下部のHeadersの欄にJSONで手入力して指定する。呼び出し元の既定は利用者側(`client`)である。ヘッダーの名前は「[内部経路のヘッダー](project-values.md#内部経路のヘッダー)」を参照する。

  ```json
  {
    "x-debug-caller": "admin",
    "x-session-token": "<43文字のセッション識別子>"
  }
  ```

- 元のクライアントIPアドレスのヘッダーは信頼されず、接続元のIPアドレスが使われる。
- GraphiQLの画面は、本体・スタイル・エディタのワーカーをCDN(`https://unpkg.com`)から読み込むため、ブラウザからインターネットへ接続できる必要がある。
- GraphiQLとintrospectionは`APP_ENVIRONMENT`が`local`のときだけ使える。デプロイ先環境の外部経路のGraphQLの経路は404を返す。

## ローカルのメールの確認

ローカル環境のイベントサーバーは、メールを外部へ送らずにMailpitへ送る(`EMAIL_PROVIDER`が`mailpit`)。Mailpitはコンテナの起動時に`/workspace/scripts/entrypoint.sh`がポート48041で起動する。届いたメールは、ブラウザで次のURLを開いて確かめる。

```text
http://localhost:48041
```

- 一覧からメールを選び、件名・送信元・宛先と、HTMLとテキストの両パート・ヘッダーを確かめる。
- コマンドで確かめるときは、MailpitのAPIを使う。APIの一覧は「[ローカルの受信箱(Mailpit)](../GUIDES/tech/external/001-email-sending.md#ローカルの受信箱mailpit)」に従う。

  ```sh
  curl -sG http://localhost:48041/api/v1/search --data-urlencode 'query=subject:"メール送信の確認"' # 件名で検索し、メッセージのIDを得る
  curl -s http://localhost:48041/api/v1/message/<メッセージのID> # 件名・送信元・宛先・HTMLとテキストの本文
  curl -s -X DELETE http://localhost:48041/api/v1/messages # 全てのメッセージを削除する
  ```

- メールは`/workspace/apps/email/mailpit.db`に5,000通まで保存され、それを超えると古いものから消える。Mailpitのログは`/workspace/apps/email/mailpit.log`に出る。どちらもGit管理に含めない。

### 疎通確認の経路

イベントサーバーの`POST /internal/email/smoke`は、`EMAIL_SMOKE_RECIPIENT`の宛先へ疎通確認メール(件名「メール送信の確認」)の送信を依頼する。本番と同じ経路(Queue → 送信処理 → 描画 → 送信プロバイダ)を通るため、送信の仕組み全体を確かめられる。

1. クイックスタートの手順11で`EMAIL_SMOKE_TOKEN`・`EMAIL_SMOKE_RECIPIENT`を登録し、手順13でイベントサーバーを起動する。
2. 別のターミナルで、Infisicalから注入したトークンを使って経路を呼ぶ。トークンの値をコマンドに直接書かない。

   ```sh
   infisical --telemetry=false run --env dev -- sh -c 'curl -i -X POST -H "Authorization: Bearer $EMAIL_SMOKE_TOKEN" http://localhost:48043/internal/email/smoke'
   ```

3. 202と本文`{"requestId":"<送信要求の識別子>"}`が返ることを確かめる。
4. イベントサーバーのログで、メッセージ「メールの送信処理を終えました」の`requestId`が同じで、`result`が`sent`であることを確かめる。
5. Mailpitで、件名・本文の日本語が文字化けせず、HTMLとテキストの両パートがあり、送信元が`Launch Stadium <noreply@local.example>`であることを確かめる。

| 応答 | 原因と対処                                                                                               |
| ---- | -------------------------------------------------------------------------------------------------------- |
| 401  | トークンが一致しない。`--env dev`で注入しているか、イベントサーバーを起動したときと同じ値かを確かめる    |
| 404  | `EMAIL_SMOKE_TOKEN`・`EMAIL_SMOKE_RECIPIENT`のどちらかが未登録。登録した後、イベントサーバーを起動し直す |

- staging環境での確かめ方は「[stagingでの確認](../GUIDES/tech/external/001-email-sending.md#stagingでの確認)」に従う。URLは「[メール送信](project-values.md#メール送信)」を参照する。

## stagingへのデプロイとリリース

検査とデプロイはGitHub Actionsが行う(フェーズの構成は「[技術選定のCI/CD](tech-stack.md#cicd)」)。デプロイ・リリースの承認とマージ・シークレットの登録・資源やリポジトリの設定は開発者が行い、AIエージェントは行わない(「[AIエージェントが実行しない操作](../GUIDES/tech/operations/001-deployment.md#aiエージェントが実行しない操作)」)。本プロジェクトの値は「[IaC定義とデプロイのパイプライン](project-values.md#iac定義とデプロイのパイプライン)」と「[Workerのシークレットのキーの一覧](project-values.md#workerのシークレットのキーの一覧)」を参照する。

| 場面                               | 手順                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 最初のデプロイの前(開発者の手作業) | 「[初回の準備](../GUIDES/tech/operations/001-deployment.md#初回の準備)」                                                                                                                                                                                                                                                   |
| stagingへのデプロイ                | mainへのマージで、検査の後に自動でデプロイされる(「[mainからstagingへの自動デプロイ](../GUIDES/tech/operations/001-deployment.md#mainからstagingへの自動デプロイ)」)。最初のデプロイは「[stagingの最初のデプロイと識別子の反映](../GUIDES/tech/operations/001-deployment.md#stagingの最初のデプロイと識別子の反映)」に従う |
| prodへのリリース                   | 「[prodへのリリース](../GUIDES/tech/operations/001-deployment.md#prodへのリリース)」                                                                                                                                                                                                                                       |
| hotfix                             | 「[hotfixとprodからmainへの戻し](../GUIDES/tech/operations/001-deployment.md#hotfixとprodからmainへの戻し)」                                                                                                                                                                                                               |
| シークレットの追加と削除           | 「[シークレットの追加と削除](../GUIDES/tech/operations/001-deployment.md#シークレットの追加と削除)」                                                                                                                                                                                                                       |
| デプロイの失敗・不具合の戻し       | 「[ロールバックと復旧](../GUIDES/tech/operations/002-rollback-and-recovery.md)」                                                                                                                                                                                                                                           |

## stagingのメールのシークレット

デプロイ先検証環境(`staging`)のイベントサーバーは、検証済みの宛先にだけメールを送る(`EMAIL_RECIPIENT_POLICY`が`allowlist`)。次のシークレットは開発者がInfisicalの`staging`環境へ手作業で登録し、AIエージェントは登録しない。Infisicalの値を正とする。

| キー                       | 登録する値                                                                                   | 必須                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `EMAIL_ALLOWED_RECIPIENTS` | 送ってよい宛先のカンマ区切り。各宛先はEmail Routingの**Destination Addresses**で検証しておく | 必須。`secrets.required`にあり、未設定ではデプロイが失敗する |
| `EMAIL_SMOKE_TOKEN`        | `openssl rand -hex 32`で生成した、ローカル環境と別の値                                       | 任意。疎通確認の経路を使うときだけ                           |
| `EMAIL_SMOKE_RECIPIENT`    | `EMAIL_ALLOWED_RECIPIENTS`に含めた宛先の1つ                                                  | 任意。疎通確認の経路を使うときだけ                           |

1. Infisicalのプロジェクトの`staging`環境のルートフォルダ(`/`)に、Webの管理画面で上の値を登録する。必須の`EMAIL_ALLOWED_RECIPIENTS`は、そのキーを`secrets.required`へ加える変更を`main`へマージする前に登録する。
2. 登録だけで、次のstagingへのデプロイがWorkerへ反映する(「[stagingへのデプロイとリリース](#stagingへのデプロイとリリース)」)。Wranglerのシークレットのコマンドで直接設定しない(設定しても次のデプロイでInfisicalの値に戻る)。

- 本番環境(`prod`)には`EMAIL_SMOKE_TOKEN`・`EMAIL_SMOKE_RECIPIENT`を設定しない。疎通確認の経路は404のままになる。
- 送信ドメインの登録と送信内容のプレビューの無効化、メールイベント用Queueの作成はIaC定義が、配信不能イベントの購読の作成はデプロイのパイプラインが行い、管理画面では行わない(「[管理画面の設定](../GUIDES/tech/external/001-email-sending.md#管理画面の設定)」「[購読とQueueの作成](../GUIDES/tech/external/001-email-sending.md#購読とqueueの作成)」)。
- 他のシークレットの登録先と時期は「[Workerのシークレットのキーの一覧](project-values.md#workerのシークレットのキーの一覧)」に従う。

## DBスキーマを変更したとき

テーブル定義を`apps/db/schema/`に書き(「[テーブル定義の配置](../GUIDES/tech/db/003-schema-conventions.md#テーブル定義の配置)」)、次の順でマイグレーションを生成して適用する。各手順の詳細は「[スキーマ規約のマイグレーション](../GUIDES/tech/db/003-schema-conventions.md#マイグレーション)」に従う。

```sh
# 1. マイグレーションを生成する(apps/db/migrations/<日時>_<名前>/migration.sql)
cd /workspace/apps/db
bun run db:generate --name=<マイグレーションの名前>
bunx drizzle-kit generate --custom --name=<マイグレーションの名前> # テーブル定義で表せない内容(全文検索の仮想テーブル・トリガーなど)を生のSQLで書く場合

# 2. ローカルのD1に適用し、生成したマイグレーションがWranglerに検出されることを確かめる
cd /workspace/apps/api
bun run db:migrate:local
bun run db:migrations:check
```

- マイグレーションの適用は`apps/api`での1回でよい。`apps/event`は同じローカル状態とデータベースを参照する。
- `db:migrations:check`は、CIの検査の品質検査でも、配布のスクリプトの`app-checks`が同じスクリプトを呼ぶ。共有のローカル状態を変えずに一時ディレクトリで検出を確かめ、検出されなかったマイグレーションがあれば名前を表示して失敗する。

## GraphQLのスキーマや操作を変更したとき

APIサーバーのスキーマファイル・リゾルバの型・許可リストは、生成コマンドで作ってコミットする(生成物の場所は「[GraphQLの生成物と操作の一覧](project-values.md#graphqlの生成物と操作の一覧)」)。生成と検査にシークレットは要らないため、Infisicalからの注入は付けない。

```sh
cd /workspace/apps/api

# スキーマモジュール(src/presentation/graphql/modules/)や登録箇所(src/composition/graphql-modules.ts)を変えたとき: スキーマファイルとリゾルバの型を生成する
bun run graphql:generate

# フロントエンドの操作の一覧が変わったとき: 許可リストを生成する
bun run graphql:allowlist

# 生成物が定義・操作の一覧と食い違っていないことを確かめる
bun run graphql:check
```

フロントエンドの操作を加えた・変えた後は、次の順に生成し、生成物を同じコミットに含める(「[許可リストの生成とデプロイの順序](../GUIDES/tech/coding/004-graphql-communication.md#許可リストの生成とデプロイの順序)」)。

1. スキーマモジュールも変えたなら、先に`/workspace/apps/api`で`bun run graphql:generate`を実行する。フロントエンドのコード生成がスキーマファイルを入力にするためである。
2. 操作を変えたアプリ(`/workspace/apps/client`・`/workspace/apps/admin`)で`bun run graphql:generate`を実行し、生成物(`src/graphql/generated/`の`graphql.ts`・`persisted-documents.json`など)を出力する。スキーマモジュールを変えたときは両方のアプリで実行する。
3. `/workspace/apps/api`で`bun run graphql:allowlist`を引数なしで実行し、現行の操作だけから許可リストを生成する。
4. `/workspace/apps/api`で`bun run graphql:check`を実行し、成功することを確かめる。
5. スキーマファイル・リゾルバの型・フロントエンドの生成物・許可リストを同じコミットに含める。

```sh
cd /workspace/apps/client
bun run graphql:generate
cd /workspace/apps/admin
bun run graphql:generate
cd /workspace/apps/api
bun run graphql:allowlist
bun run graphql:check
```

- フロントエンドの操作は、各アプリの`src/graphql/operations/`に`.graphql`ファイルで書き、操作名を利用者側は`Client`、管理者側は`Admin`で始める(「[操作の置き場所と名前](../GUIDES/tech/coding/004-graphql-communication.md#操作の置き場所と名前)」)。画面は生成物の`graphql.ts`だけを読み込み、操作の本文を含む`gql.ts`・`index.ts`を読み込まない。
- `apps/client`・`apps/admin`の`bun run graphql:check`は、生成物が操作とスキーマファイルに食い違っていないかを確かめる。食い違うか操作がスキーマに合わなければ、再実行すべき`bun run graphql:generate`を表示して失敗する。一括検査`bun run check`も実行する。

- 起動中のAPIサーバーは、許可リストをバンドルに含めて読み込む。`wrangler dev`は許可リストのファイルの変更を検知してバンドルし直すため、生成し直した許可リストは起動し直さずに反映される。反映されなければ、APIサーバーを起動し直す。
- `graphql:allowlist`の`--previous-ref <コミット>`は、デプロイの時にCIが直前のリリースの操作を加えるためのものである。ローカル環境では指定せず、指定して生成した許可リストはコミットしない(`graphql:check`は現行の操作だけで生成した許可リストと比べるため、直前のリリースの操作が現行と異なれば失敗する)。
- 許可リストの生成は、操作がスキーマに対する検証・クエリの上限の検査・ルートの型の検査(スキーマに`Subscription`型が無いのに`subscription`の操作を登録したなど)に通らなければ、操作の識別子と理由を表示して失敗する。
- `graphql:check`は、食い違った生成物と、再実行すべき生成コマンドを実行する順に表示する。一括検査`bun run check`も、型検査の前にこの検査を実行する。

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

CIの検査も、TruffleHogで変更履歴からシークレットを検出する(「[CIのシークレットの検出](../GUIDES/tech/infra/007-ci-cd-pipelines.md#シークレットの検出)」)。CIの検出が誤検知であれば、`/workspace/.github/trufflehog-exclude-paths.txt`に、対象のファイルのパスの正規表現を1行で追記し、直前の行に`#`で始まるコメントで誤検知と判断した理由を書く。このファイルは`.betterleaksignore`とは別に管理し、片方に登録しても他方の検出からは除かれない。

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

| コマンド                                                                       | 内容                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run check`                                                                | 共有ディレクトリの配置確認・テスト命名の検査・整形検査・全アプリの静的解析・型生成の検査・GraphQLの生成物の検査・型検査・写しの照合を一括で実行する                                                                                          |
| `bun run format`                                                               | リポジトリ全体を整形する                                                                                                                                                                                                                     |
| `bun run test:all:unit`・`bun run test:all:browser`・`bun run test:all:worker` | ルートと全アプリの単体テスト・ブラウザテスト・Workers統合テストを種別ごとに一括で実行する(`--coverage`を付けると各アプリへ渡る)                                                                                                              |
| `bun run test:e2e`                                                             | E2Eテストを実行する(対象のアプリは事前に起動しておく。並列数の上限は既定で2、`E2E_WORKERS`で上書きできる。「[ローカルでのE2Eテスト](#ローカルでのe2eテスト)」)                                                                               |
| `bun run test:e2e:dev-and-preview`                                             | 利用者側・管理者側のフロントエンドを開発サーバーとビルド後のプレビューで順に起動し、それぞれでE2Eテストを実行する(前提と実行方法は「[開発サーバーとビルド後のプレビューの両方での実行](#開発サーバーとビルド後のプレビューの両方での実行)」) |

APIサーバー・イベントサーバーだけを検査・テストするときは、各アプリのディレクトリ(`/workspace/apps/api`・`/workspace/apps/event`)で次のスクリプトを実行する。テストに必要なシークレットはテストの設定がテスト用の値で渡すため、Infisicalからの注入は要らない。

| コマンド                            | 対象                     | 内容                                                                                                                                        |
| ----------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run lint`・`bun run typecheck` | `apps/api`・`apps/event` | 静的解析・型検査。共有ディレクトリ(`db`・`lib`)の静的解析は検査担当の`apps/api`が受け持つ                                                   |
| `bun run test:unit`                 | `apps/api`・`apps/event` | 単体テスト(Bun)。共有ディレクトリの単体テストは`apps/api`が実行する                                                                         |
| `bun run test:worker`               | `apps/api`・`apps/event` | Workers統合テスト(Vitest、workerd上)。`apps/api`はマイグレーションを適用したD1と共有ディレクトリのWorkers統合テストを含む                   |
| `bun run test:smoke`                | `apps/api`               | 依存性注入のスモークテスト。Wranglerでバンドルして起動したWorkerが、`@inject`付きのコンストラクタ引数を持つクラスを解決できることを確かめる |
| `bun run db:migrations:check`       | `apps/api`               | マイグレーションがWranglerに検出されることを確かめる                                                                                        |
| `bun run cf-typegen`                | `apps/api`・`apps/event` | Wrangler設定を変えたときに、実行時の型の定義ファイル`worker-configuration.d.ts`を生成し直す                                                 |
| `bun run cf-typegen:check`          | `apps/api`・`apps/event` | 生成済みの`worker-configuration.d.ts`がWrangler設定と食い違っていないかを確かめる。ルートの一括検査(`bun run check`)でも実行される          |
| `bun run graphql:generate`          | `apps/api`               | GraphQLのスキーマファイルとリゾルバの型を生成する(「[GraphQLのスキーマや操作を変更したとき](#graphqlのスキーマや操作を変更したとき)」)      |
| `bun run graphql:allowlist`         | `apps/api`               | フロントエンドの操作の一覧から、GraphQLの許可リストを生成する                                                                               |
| `bun run graphql:check`             | `apps/api`               | GraphQLの生成物がスキーマモジュールと操作の一覧に食い違っていないかを確かめる。ルートの一括検査(`bun run check`)でも実行される              |

画面を持つアプリ(`apps/frontend-lib`・`apps/client`・`apps/admin`)だけを検査・テストするときは、各アプリのディレクトリで次のスクリプトを実行する。

| コマンド                                            | 対象                                             | 内容                                                                                                                                                                                                                   |
| --------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run lint`・`bun run typecheck`                 | `apps/frontend-lib`・`apps/client`・`apps/admin` | 静的解析・型検査。共有ディレクトリ(`lib`)の静的解析は検査担当の`apps/frontend-lib`が受け持つ                                                                                                                           |
| `bun run test:unit`                                 | `apps/frontend-lib`・`apps/client`・`apps/admin` | 単体テスト(Bun)。`apps/client`・`apps/admin`は配置先の`lib`を除いた`bunfig.unit.toml`を使う                                                                                                                            |
| `bun run test:browser`                              | `apps/frontend-lib`・`apps/client`・`apps/admin` | ブラウザテスト(Vitest Browser Mode、共有Chromium)。部品のアクセシビリティの自動検査を含む                                                                                                                              |
| `bun run storybook:dev`・`bun run storybook:build`  | `apps/frontend-lib`                              | 部品のカタログの起動と静的な出力。起動の手順はクイックスタートの手順13に従う                                                                                                                                           |
| `bun run cf-typegen`・`bun run cf-typegen:check`    | `apps/client`・`apps/admin`                      | Wrangler設定を変えた時の環境の型の定義ファイル`worker-configuration.d.ts`の生成し直し(実行時の型は含めない)と、生成物の食い違いと環境の検証スキーマとの型の照合の検査。ルートの一括検査(`bun run check`)でも実行される |
| `bun run graphql:generate`・`bun run graphql:check` | `apps/client`・`apps/admin`                      | フロントエンドの操作の型・文書・操作の一覧の生成と、生成物の食い違いの検査(食い違えば、再実行すべき`bun run graphql:generate`を表示して失敗する)                                                                       |
| `bun run dev`・`bun run build`・`bun run preview`   | `apps/client`・`apps/admin`                      | 開発サーバー・ビルド・ビルド後のプレビュー。手順はクイックスタートの手順13・14に従う                                                                                                                                   |

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

`apps/client`・`apps/admin`の開発サーバーとプレビューは同じポートを使うため、同じアプリの両方を同時に起動しない。

Workerのデバッガー(インスペクター)の待ち受けポートは次のとおりである。4つを同時に起動しても重ならないよう固定し、互いに異なることをルートの単体テスト(`/workspace/config/inspector-ports.unit.test.ts`)が確かめる。

| アプリ        | インスペクターのポート | 指定箇所                                  |
| ------------- | ---------------------- | ----------------------------------------- |
| `apps/api`    | 9229                   | `wrangler dev`の既定                      |
| `apps/event`  | 9230                   | `package.json`の`dev`の`--inspector-port` |
| `apps/client` | 9231                   | `vite.config.ts`の`inspectorPort`         |
| `apps/admin`  | 9232                   | `vite.config.ts`の`inspectorPort`         |

`apps/api`・`apps/event`のヘルスチェックの経路は`/health`である(「[ヘルスチェックとローカルのURL](project-values.md#ヘルスチェックとローカルのurl)」)。

ローカルではD1の代わりにWranglerのD1ローカルモード、Cloudflare Email Serviceの代わりにMailpit、Cloudflare R2の代わりにWranglerのR2ローカルモードを使う。
