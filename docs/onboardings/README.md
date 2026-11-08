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

10. コンテナ内: DBスキーマ定義・共用部品・APIサーバー・イベントサーバー・フロントエンド共通ファイル・利用者側と管理者側のフロントエンドの依存パッケージをインストールする(初回のみ)

    ```sh
    cd /workspace/apps/db
    bun install
    cd /workspace/apps/common-lib
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
    - `apps/common-lib`は、`apps/api`・`apps/event`・`apps/client`・`apps/admin`へ`common-lib`として配置される共用部品である(マークダウンの描画とサニタイズ・文字数・入力の検証規則・検索語の処理・メディアの形式とアップロードのプロトコル・画像バリアントと配信のURL)。自身の依存パッケージで静的解析・単体テストを動かし、`apps/frontend-lib`の位置の検査(兄弟の相対パスで`apps/common-lib`を読み込む)もこの依存パッケージで解決される。配置先では各アプリの依存パッケージで動く(「[別の共有ディレクトリの参照](../GUIDES/tech/coding/003-shared-directories.md#別の共有ディレクトリの参照)」)。`apps/common-lib`の`bun install`の前は、`apps/common-lib`の検査と`apps/frontend-lib`のテスト・カタログが失敗する。
    - 依存パッケージの版の追加・更新を含むコミットを取り込んだら、該当するディレクトリで`bun install`を再実行する。

11. コンテナ内: シークレットをInfisicalに登録する(初回のみ、開発者の手作業)

    `apps/api`・`apps/event`・`apps/client`・`apps/admin`は、起動時に次のシークレットを必要とする。Infisicalのプロジェクトのローカル環境(`dev`)のルートフォルダ(`/`)に、Webの管理画面で登録する。登録済みであれば飛ばす。各値の意味は「[バインディング・変数・シークレット](project-values.md#バインディング変数シークレット)」を参照する。

    | キー                    | 登録する値                                                                    | 使うアプリ                                            |
    | ----------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------- |
    | `HASH_PEPPER`           | 次の`openssl rand -hex 64`で生成した128文字の16進数                           | `apps/api`・`apps/event`・`apps/client`・`apps/admin` |
    | `TURNSTILE_SECRET_KEY`  | 常に成功するテスト用の秘密鍵`1x0000000000000000000000000000000AA`             | `apps/api`                                            |
    | `EMAIL_SMOKE_TOKEN`     | 次の`openssl rand -hex 32`で生成した64文字の16進数                            | `apps/event`                                          |
    | `EMAIL_SMOKE_RECIPIENT` | 疎通確認メールの宛先。任意のアドレス(例:`smoke@local.example`)でよい          | `apps/event`                                          |
    | `MEDIA_SMOKE_TOKEN`     | 次の`openssl rand -hex 32`で、`EMAIL_SMOKE_TOKEN`と別に生成した64文字の16進数 | `apps/event`                                          |

    ```sh
    openssl rand -hex 64 # 出力をHASH_PEPPERとして登録し、ファイルやチャットに残さない
    openssl rand -hex 32 # 出力をEMAIL_SMOKE_TOKENとして登録し、ファイルやチャットに残さない
    openssl rand -hex 32 # もう1度実行し、出力をMEDIA_SMOKE_TOKENとして登録し、ファイルやチャットに残さない
    infisical --telemetry=false run --env dev -- sh -c 'test -n "$HASH_PEPPER" && test -n "$TURNSTILE_SECRET_KEY" && echo "登録済み"' # 値を表示せずに登録を確かめる
    infisical --telemetry=false run --env dev -- sh -c 'test -n "$EMAIL_SMOKE_TOKEN" && test -n "$EMAIL_SMOKE_RECIPIENT" && echo "疎通確認のシークレットも登録済み"'
    infisical --telemetry=false run --env dev -- sh -c 'test -n "$MEDIA_SMOKE_TOKEN" && echo "画像の動作確認のトークンも登録済み"'
    ```

    - `HASH_PEPPER`は4アプリで1つの値を共有し、アプリごとに別の値を登録しない。`apps/client`・`apps/admin`はWorker単位のIP制限のキーのハッシュ化に使う(「[フロントエンドのキーのハッシュ化](../GUIDES/tech/frontend/003-frontend-server-security.md#キーのハッシュ化)」)。
    - `apps/client`・`apps/admin`の起動・ビルド・プレビューのコマンドも、Infisicalからの注入を付けて実行する(注入を付けないとWranglerが`HASH_PEPPER`の不足を警告して`.dev.vars`の作成を促し、すべての要求が環境の検証で500になる。`.dev.vars`は作らない)。ただし手順14の環境別のビルドは、理由を同じ手順に記したとおり注入を付けない。
    - `apps/api`・`apps/event`を未登録のまま起動すると、`wrangler dev`が足りないキーを警告し、ヘルスチェック以外の経路が環境の検証で500になる。ヘルスチェックは環境の検証より前に応答するため、未登録でも200を返す。
    - `EMAIL_SMOKE_TOKEN`・`EMAIL_SMOKE_RECIPIENT`は、メールの疎通確認の経路(「[疎通確認の経路](#疎通確認の経路)」)だけが使う。未登録でもイベントサーバーは環境の検証に通り、疎通確認の経路だけが404になる。ローカル環境ではMailpitが全ての宛先のメールを受け取るため、外部へは送られない。
    - `MEDIA_SMOKE_TOKEN`は、画像の動作確認の経路(「[画像の動作確認の経路](#画像の動作確認の経路)」)だけが使う。未登録でもイベントサーバーは警告を出して起動し、動作確認の経路だけが404になる。
    - `dev`にはキーワード抽出の外部APIのキー(`GOOGLE_NL_API_KEY`)を登録しない。ローカル環境ではキーワード抽出が無効(`KEYWORD_EXTRACTOR`が`disabled`)で、イベントサーバーはキーを注入せずに起動する(「[キーワード抽出の外部API](#キーワード抽出の外部api)」)。
    - `dev`には画像判定サービスの資格情報(`REKOGNITION_ACCESS_KEY_ID`・`REKOGNITION_SECRET_ACCESS_KEY`)を登録しない。ローカル環境は代替の判定(`MODERATION_PROVIDER`が`stub`)で判定サービスを呼ばず、イベントサーバーはキーを注入せずに起動する(「[画像のアップロード・判定・配信](#画像のアップロード判定配信)」)。
    - `dev`には使い捨てメールアドレスの判定のAPIキー(`DISIFY_API_KEY`)を登録しない。ローカル環境の`secrets.required`に無く、APIサーバーとイベントサーバーはキーを注入せずに起動し、判定サービスを呼ばずに全てのメールアドレスを通常として扱う(「[使い捨てメールアドレスの判定のAPIキー](#使い捨てメールアドレスの判定のapiキー)」)。
    - `dev`には、APIサーバーとイベントサーバーのWorkerごとのフォルダ(`/workers/api`・`/workers/event`)もある。同じキー名でWorkerごとに異なる値が要るシークレットを置き、現時点では空である。決済を試す場合だけ、Stripeの制限付きキーを「[決済(Stripe)のキー](#決済stripeのキー)」の手順で登録する。各環境のフォルダとキーの一覧は「[Workerのシークレットのキーの一覧](project-values.md#workerのシークレットのキーの一覧)」を参照する。

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

## ローカルの最初の最上位管理者

管理画面(`http://localhost:48045`)には新規登録が無い。ローカル環境で管理画面を使うには、開発者が招待の発行コマンドで最上位管理者の招待を発行し、表示されたリンクから画面で招待を完了する(「[最初の最上位管理者の用意](../GUIDES/tech/operations/003-first-administrator-bootstrap.md)」)。コマンドはメールを送らず、管理画面とAPIサーバーを通らずにローカルのD1へ直接書き込む。

1. クイックスタートの手順12のとおり、ローカルのD1にマイグレーションを適用しておく。コマンドの実行だけなら、APIサーバーを起動していなくてよい。
2. `apps/api`で、Infisicalの`dev`から`HASH_PEPPER`を注入して招待を発行する。メールアドレスは自分の管理者に使う任意のアドレスでよい(ローカル環境のメールはMailpitが受け取り、外部へは送らない)。

   ```sh
   cd /workspace/apps/api
   infisical --telemetry=false run --env dev -- bun run admin:invite-super-admin -- --target local --email admin@local.example
   ```

3. 表示された`招待のリンク: http://localhost:48045/auth/invitation#token=...`を、APIサーバーと管理者側(クイックスタートの手順13)を起動した上で、ブラウザで開く。リンクは再表示できず、有効期限は24時間である。
4. 招待の受け入れの画面で、ニックネームとパスワードを設定し、認証アプリでQRコードを読み取って(読み取れなければ手入力用の文字列を入力して)6桁の認証コードを入力する。表示されたリカバリコードを保存してから「ダッシュボードへ進む」を押すと、最上位管理者としてログインした状態になる。

- リンクを失った・期限が切れたときは、同じメールアドレスでコマンドを実行し直す。前のリンクは無効になる。既に招待を完了した(有効な)管理者のメールアドレスでは、何も書き込まずに失敗する。
- `HASH_PEPPER`を注入せずに実行すると、何も書き込まずに、注入付きの実行の形を示して失敗する。`apps/api`以外のディレクトリでは`admin:invite-super-admin`のスクリプトが見つからない。
- 2人目以降の管理者は、最上位管理者が管理画面の「管理者アカウント」から招待する。招待のメールはイベントサーバーがMailpitへ送るため、イベントサーバーも起動しておく(「[ローカルのメールの確認](#ローカルのメールの確認)」)。
- パスワードを忘れたときはログイン画面のパスワードの再設定を使い、認証アプリとリカバリコードの両方を失ったときは別のメールアドレスで招待を発行し直す(「[最上位管理者が締め出された場合](../GUIDES/tech/operations/003-first-administrator-bootstrap.md#最上位管理者が締め出された場合)」)。データベースを直接編集して認証の手段を消したりロールを書き換えたりしない。
- 管理者側のE2Eテストは、実行の間だけ他の有効な最上位管理者をモデレーターに変えるため、ここで用意した管理者のロールも一時的に変わる。戻らなかったときの手順は「[ローカルでのE2Eテスト](#ローカルでのe2eテスト)」に従う。
- デプロイ先(`staging`・`prod`)の最初の最上位管理者の招待は開発者だけが発行し、AIエージェントは実行しない。引数と環境ごとの値は「[管理者のアカウント](project-values.md#管理者のアカウント)」、手順は「[デプロイ先(staging・prod)](../GUIDES/tech/operations/003-first-administrator-bootstrap.md#デプロイ先stagingprod)」に従う。

## ローカルでのE2Eテスト

ローカルで起動したアプリに対して、すべてのE2Eテストを実行する。デプロイの後に公開のURLに対して`@smoke`タグのテストだけを実行する「[デプロイ後のスモークテスト](../GUIDES/tech/testing/001-test-strategy.md#デプロイ後のスモークテスト)」とは別である。

利用者側・管理者側の疎通確認の画面で、応答のセキュリティヘッダーとnonce付きのCSP、APIサーバーの時刻と「到達可能」の表示、再確認、ハイドレーションの後も再確認までは中継へ取得し直さないこと、CSPの違反が起きないこと、存在しないページの404、クロスサイトを名乗る中継の要求の403、スクリプトの読み込み方、静的なファイルがWorkerを通らずに配信されること、管理者側の画面にフッターが無いことを、PlaywrightのE2Eテスト(`e2e/client/system-status.e2e.test.ts`・`e2e/admin/system-status.e2e.test.ts`)で確かめる。クイックスタートの手順13の開発サーバーか、手順14のプレビューで、APIサーバー・利用者側・管理者側を起動してから実行する。両方の起動で続けて確かめるときは、「[開発サーバーとビルド後のプレビューの両方での実行](#開発サーバーとビルド後のプレビューの両方での実行)」のコマンドを使う。

E2Eテストのコマンドは、Infisicalの注入の下で実行する。管理者側のE2Eテストは、Playwrightのプロセスから招待の発行コマンド(`apps/api`の`bun run admin:invite-super-admin -- --target local --email <アドレス>`)を呼び、このコマンドは`HASH_PEPPER`を環境変数から読むためである。注入を付けないと、管理者を用意するE2Eテストがすべて`HASH_PEPPER`が注入されていない旨の案内で失敗する。`HASH_PEPPER`はInfisicalの`dev`の共通のフォルダ(`/`)にあり、注入した値はE2Eテストのプロセスから招待の発行コマンドへそのまま引き継がれる(コマンドの中では注入し直さない)。

```sh
cd /workspace
infisical --telemetry=false run --env dev -- bun run test:e2e
infisical --telemetry=false run --env dev -- bun run test:e2e --project admin # 管理者側のE2Eテストだけを実行する場合
```

利用者側の登録とログインの流れ(登録→未確認の帯→メールのリンクでの確認→帯が消える、ユーザーメニューからのログアウト、誤ったパスワードの文言、別のブラウザの文脈でのログインとセッションの一覧・個別の失効)、パスワードリセット(未登録のメールアドレスでも同じ案内、リンクからの再設定で既存のセッションが無効になる)、多要素認証(画面の手入力用の文字列から計算した認証コードでの有効化、認証コードとリカバリコードでのログイン、無効化)、メールアドレス変更とパスワード変更のリンクでの確定、退会→ログインできない→同じメールアドレスでの再登録は、`e2e/client/auth/`のE2Eテスト(`registration.e2e.test.ts`・`login-and-sessions.e2e.test.ts`・`password-reset.e2e.test.ts`・`two-factor.e2e.test.ts`・`account-changes.e2e.test.ts`)で確かめる。

- APIサーバー・イベントサーバー・利用者側をクイックスタートの手順13のとおり起動してから実行する。確認のメールはイベントサーバーがMailpit(コンテナの起動時に起動済み)へ送り、テストは共有の補助`e2e/support/mailpit.ts`でMailpitのAPI(`http://localhost:48041`、`E2E_MAILPIT_URL`で上書きできる)から宛先ごとの最新のメールのリンクを読む(「[ローカルのメールの確認](#ローカルのメールの確認)」)。イベントサーバーを起動していないと、メールが届かずに待ちの期限(20秒)で失敗する。
- 利用者のメールアドレスは`e2e-<乱数>@test.example`、パスワードとニックネームも乱数から作るため、前回の実行のデータやMailpitに残ったメールを消さずに何度でも実行できる。
- 登録・ログインの画面は、非表示のbot判定のウィジェット(ローカルでは常に成功するテスト用のキー)がトークンを発行するのを待ってから入力して送信する。
- メールの送信回数とログイン試行はIPアドレス単位でも制限され、記録はローカルの状態(`/workspace/.wrangler/state`)に残る。テストはブラウザの文脈ごとに文書用のIPv6アドレスを接続元として名乗るため(`e2e/support/client-ip.ts`)、繰り返し実行しても上限に達しない。手作業の確認と合わせて同じ接続元から1時間に6回以上登録すると、画面に「操作が集中しています。」が出る。
- これらのテストはメールとローカルのIPアドレスの扱いを前提にするため、`@smoke`タグを付けず、デプロイ後のスモークテストでは実行しない。

利用者側のトップページの共通フッターの利用規約・プライバシーポリシー・法的通知のリンクから各公開ページ(`/terms`・`/privacy`・`/legal`)へ移動でき、見出しが文書の名前で、本文の最終改訂日か準備中の表示が出て(エラーの表示は出ない)、移動先にも共通フッターの3文書へのリンクがあることは、`e2e/client/legal-pages.e2e.test.ts`で確かめる。APIサーバー・利用者側をクイックスタートの手順13のとおり起動してから実行する(イベントサーバーは不要)。公開済み・準備中のどちらの文書でも成功するため、ローカルのD1の版の有無によらず何度でも実行できる。

利用者側の問い合わせの流れ(未ログインの送信→フォームが送信完了の表示に置き換わり「未対応」の未ログインの問い合わせとして保存される、ログイン中の利用者のファイルを添付した送信→その問い合わせのチャットへ移り最初のメッセージと添付が出る、停止中の利用者の既存のチャットに送信欄の代わりの案内が出て`/contact`ではニックネーム・連絡先メールアドレスを入力するフォームから未ログインの問い合わせとして送信できる)は、`e2e/client/inquiry/inquiry-contact.e2e.test.ts`で確かめる。

- 実行の前に、`apps/api`で`bun run db:migrate:local`を実行し、APIサーバー・イベントサーバー・利用者側をクイックスタートの手順13のとおり起動しておく。
- 利用者の停止は管理画面の機能のため、テストはローカルのD1(`e2e/support/local-d1.ts`)で利用者を停止中にし、保存された未ログインの問い合わせもローカルのD1で確かめる。そのため`@smoke`タグを付けない。
- 未ログインの送信は送信元IPアドレスごとに1時間5回までに制限されるが、利用者側のE2Eテストはブラウザの文脈ごとに文書用のIPv6アドレスを接続元として名乗るため(`e2e/support/client-ip.ts`)、繰り返し実行しても上限に達しない。利用者・問い合わせ・添付のファイルは実行ごとに乱数から作り、ローカルの状態(`/workspace/.wrangler/state`)に残る。
- 送信の手順(フォームを開く・未ログインとログインの送信・送信完了の確認)は、管理画面とまたぐE2Eテストと共有する補助`e2e/client/inquiry/inquiry-steps.ts`にある。

利用者側の決済履歴(ログイン後に設定のナビゲーションの「決済履歴」から`/settings/billing`を開くと、その項目が現在の項目として示され、記録が無い表示が出て、Stripe.jsが読み込まれない)は`e2e/client/billing.e2e.test.ts`で、疎通確認の決済(決済履歴の「疎通確認の決済を始める」→決済画面の購入の内容が「お支払い情報」より上に出る→同意の無い間は「支払いを確定する」が押せない→テストカード`4242 4242 4242 4242`と請求先住所の入力と同意→決済後のランディングの完了の表示→同意の日時と版が購入の記録に保存される→決済履歴に「都度決済」「成功」の記録→Mailpitの件名「購入が完了しました」の購入確認メールに決済履歴へのリンクがある、決済画面と決済後のランディングでCSPの違反が出ない)は`e2e/client/checkout.e2e.test.ts`で確かめる。

- 実行の前に、`apps/api`で`bun run db:migrate:local`を実行し、APIサーバー・イベントサーバー・利用者側をクイックスタートの手順13のとおり起動しておく。疎通確認の決済のE2Eはメールアドレスの確認を済ませるため、イベントサーバーが要る。
- 疎通確認の決済のE2Eは、APIサーバーの`startSmokeCheckout`が`payments_unavailable`を返す環境(Stripeのsandboxのキーが無い環境)では、`test.skip`で「Stripeのsandboxのキーが無い環境のため、決済のE2Eを飛ばします」を示して飛ばす。Infisicalの`dev`にStripeのキーが無い間は、ローカルとCIでこのE2Eは飛ばされる。決済まで実行するには、dev用のsandboxのキーの登録と、利用者側の公開キーの置き換え(「[決済(Stripe)のキー](#決済stripeのキー)」、paymentsのspecのタスク1.4)が要る。
- 決済画面の入力欄はStripeの埋め込み枠の中にあるため、手順(`e2e/client/checkout-steps.ts`)は入力欄の名前(`number`・`expiry`・`cvc`・`addressLine1`など)を持つStripeの枠を探して入力する。請求先住所は米国の住所で入力する。
- 決済履歴と決済画面の手順は`e2e/client/billing-steps.ts`・`e2e/client/checkout-steps.ts`にある。同意の記録はローカルのD1(`e2e/support/local-d1.ts`)で、購入確認メールはMailpitで確かめるため、`@smoke`タグを付けない。

利用者側のUltrasの料金ページとプラン管理画面(機能フラグがオンのとき、未ログインの`/pricing`にUltrasの区画が出て、特典の3箇条・価格(価格を照会できなければ「現在表示できません」)・加入のボタン・法的通知へのリンクが見える、フラグがオフのとき区画が出ずページの題名と法的通知へのリンクは出る、ログイン後に設定のナビゲーションの「プラン」から`/settings/plan`を開くとその項目が現在の項目として示され未加入の旨が出る、確認済みの利用者が「Ultrasに加入」からテストカードで加入→決済後のランディングの完了の表示→プラン管理画面の「加入状態: 有効」→「解約・支払い方法の管理」でStripeのCustomer Portalへ移る)は`e2e/client/ultras.e2e.test.ts`で、管理者側のUltras導線の機能フラグ(最上位管理者が`/settings`でスイッチを切り替え→確認のダイアログで理由を入れて確定→トースト→区画に新しい値と変更した管理者が出る→監査ログの一覧に「Ultras導線の機能フラグの変更」の記録が理由と新しい値とともに出る)は`e2e/admin/ultras-promotion.e2e.test.ts`で確かめる。

- 実行の前に、`apps/api`で`bun run db:migrate:local`を実行し、APIサーバー・イベントサーバー・利用者側・管理者側をクイックスタートの手順13のとおり起動しておく。確認メールと招待のメールはイベントサーバーがMailpit(コンテナの起動時に起動済み)へ送る。
- 2つのファイルは同じ機能フラグの行(`ultras_settings`の`setting_key = 'ultras_promotion'`)を書き換えるため、ルートの`playwright.config.ts`の直列の組`ultras`で、利用者側の手順(`ultras-1-client`)の後に管理者側の手順(`ultras-2-admin`)を1つずつ実行する(「[E2Eテストの実行](../GUIDES/tech/testing/001-test-strategy.md#e2eテストの実行)」)。組のファイルは`--project client`・`--project admin`では実行されず、組は`--project 'ultras-*'`で実行する。管理者側の手順は`admin`のテストのプロジェクトにも依存するため、組だけを指定しても`admin`のテストが先に実行される。

  ```sh
  cd /workspace
  infisical --telemetry=false run --env dev -- bun run test:e2e --project 'ultras-*'
  ```

- 機能フラグの行は、各テストの直前にローカルのD1(`e2e/support/local-d1.ts`)で書き換え、管理者側のテストは`finally`で元の値へ戻す。利用者側のテストは値を戻さないため、実行の後のローカルのフラグは最後に設定した値(オン)になる。ローカルのD1への直接の投入を前提にするため、`@smoke`タグを付けない。
- 加入の経路は、プラン管理画面の「Ultrasに加入」が価格なしの理由で無効なら(Infisicalの`dev`にStripeのsandboxのキーが無い、またはsandboxに価格`ultras_monthly`が無い)、`test.skip`で理由を示して飛ばす。加入の開始がAPIサーバーから`payments_unavailable`を返した場合も同じく飛ばす。
- 加入の経路を実行すると、実行のたびに新しい確認済みの利用者がsandboxで定期課金を作り、sandboxとローカルのD1に`active`な加入が残る(実行のたびに増える)。不要になったらStripeのダッシュボードで解約する。

管理画面とメールをまたぐ問い合わせの流れ(モデレーターがログインの問い合わせへ返信→Mailpitの件名「お問い合わせに返信がありました」の通知メールに返信の本文が無く、そのリンクで開いたチャットに返信と管理者のニックネームが出て、最初のメッセージの添付ファイルを元のファイル名と内容でダウンロードできる、対応済にした問い合わせへ利用者が追加メッセージを送ると利用者側と管理画面の対応ステータスが「未対応」へ戻りダッシュボードの未対応の件数が増える、未ログインの問い合わせが一覧に「未ログイン」として出て詳細にニックネーム・連絡先メールアドレス・メッセージとシステム外のメールで回答する旨が出て返信のフォームが出ない、カテゴリのページで追加したカテゴリを利用者が問い合わせで選べ、削除の確認に紐付く件数と監査ログの旨が出て、削除すると問い合わせのカテゴリが「その他」に付け替わり「その他」に削除の操作が無い)は、`e2e/admin/inquiries.e2e.test.ts`・`e2e/admin/inquiry-categories.e2e.test.ts`で確かめる。

- 実行の前に、`apps/api`で`bun run db:migrate:local`を実行し、APIサーバー・イベントサーバー・利用者側・管理者側をクイックスタートの手順13のとおり起動しておく。返信の通知メールはイベントサーバー(Queueの受信側)が送るため、イベントサーバーを起動していないと通知メールの待ちの期限(20秒)で失敗する。管理者側のプロジェクトのテストのため、`--project admin`で実行する(`infisical --telemetry=false run --env dev -- bun run test:e2e e2e/admin/inquiries.e2e.test.ts e2e/admin/inquiry-categories.e2e.test.ts --project admin`)。
- 管理者は下の管理者側の流れと同じく共有の補助`e2e/support/admin-bootstrap.ts`でモデレーターとして用意する。利用者側の画面は、`e2e/admin/client-page-test.ts`の`clientPage`が管理者と別のブラウザの文脈で開く。開く先は利用者側のE2Eの対象のURL(`E2E_CLIENT_URL`、既定は`http://localhost:48044`)で、利用者側のE2Eテストと同じくブラウザの文脈ごとに文書用のIPv6アドレスを接続元として名乗る。
- ダッシュボードの未対応の件数は他のテストや前回の実行の問い合わせも数えるため、追加メッセージを送る前に読んだ件数より増えたことで確かめる。追加したカテゴリの名前は実行ごとに乱数を含め、テストの中で削除する。利用者・管理者・問い合わせはローカルの状態に残る。

管理者側の流れ(招待の発行コマンドのリンクからの最初の最上位管理者の招待の完了→空の状態のダッシュボード、誤ったパスワードの文言、ログアウトと認証コード・リカバリコードでのログイン、ログイン必須のページからログイン画面へ移りログインの後に元のページへ戻ること)、管理者アカウントの管理(最上位管理者によるモデレーターの招待とMailpitのリンクからの完了、ロールの変更、最後の最上位管理者の自己降格の拒否、削除、監査ログの操作者・操作種別・期間での絞り込み)、自分のアカウント(プロフィールのニックネーム・肩書き・画像の登録と取り除き・既定のアイコン、パスワードリセット、メールアドレス変更、パスワード変更、多要素認証の再設定)、ロール(閲覧のみ・モデレーター・最上位管理者)によるヘッダーの表示と操作の出し分けと再ログイン、法務文書(最上位管理者による利用規約の下書きの保存→利用者側の公開ページに下書きが出ないこと→公開→公開ページの本文・最終改訂日・改訂履歴の先頭の版→続けての公開→改訂履歴が新しい順に2版増え、1つ前の版のページに過去の版である旨と最新版へのリンクが出ること)は、`e2e/admin/`のE2Eテスト(`admin-sign-in.e2e.test.ts`・`admin-accounts.e2e.test.ts`・`my-account.e2e.test.ts`・`admin-roles.e2e.test.ts`・`legal-documents.e2e.test.ts`)で確かめる。

- 実行の前に、`apps/api`で`bun run db:migrate:local`を実行してローカルのD1へマイグレーションを適用し、APIサーバー(`bun /workspace/scripts/delivery/cli.ts run-with-secrets --scope local --worker api -- bun run dev`)・イベントサーバー(`apps/event`で`bun /workspace/scripts/delivery/cli.ts run-with-secrets --scope local --worker event -- bun run dev`)・管理者側(`apps/admin`で`infisical --telemetry=false run --env dev -- bun run dev --port 48045 --host 0.0.0.0`)をクイックスタートの手順13のとおり起動しておく。招待・パスワードリセット・メールアドレス変更のメールはイベントサーバーがMailpit(`http://localhost:48041`、コンテナの起動時に起動済み)へ送り、テストは`e2e/support/mailpit.ts`で読む。
- `legal-documents.e2e.test.ts`は利用者側の公開ページも開くため、利用者側(`apps/client`で`infisical --telemetry=false run --env dev -- bun run dev --port 48044 --host 0.0.0.0`)も起動しておく。公開ページのURLは管理画面の「公開ページを開く」のリンク(管理者側のWrangler設定の`CLIENT_SITE_ORIGIN`)から読む。開始時の最新の版番号を読んで相対的に確かめ、本文と変更概要に乱数を含めるため、何度でも実行できる。公開した版は削除できないため、実行のたびにローカルのD1の利用規約の版が2つずつ増える。
- 管理者は共有の補助`e2e/support/admin-bootstrap.ts`が用意する。招待の発行コマンドを`--target local`で呼んで最上位管理者として招待し、画面で招待を完了(ニックネーム・パスワード・手入力用の文字列から計算した認証コード・リカバリコードの確認)させてから、閲覧のみ・モデレーターが要るときはローカルのD1(`e2e/support/local-d1.ts`、`/workspace/.wrangler/state`)でロールを設定する。メールアドレスは`e2e-<乱数>@test.example`、ニックネームとパスワードも乱数から作るため、前回の実行の管理者やMailpitに残ったメールを消さずに何度でも実行できる。テストで作った管理者はローカルのD1に残る。
- 最後の最上位管理者の自己降格の拒否は、有効な最上位管理者が1人だけの時にだけ起きる。そのため`admin-accounts.e2e.test.ts`は、確認の間だけ`withSoleActiveSuperAdmin`で、操作する最上位管理者以外の有効な最上位管理者(前のテスト・前回の実行で作った管理者と、開発者が手作業で用意した管理者を含む)をモデレーターにし、確認の後に`finally`で最上位管理者へ戻す。他のテストの管理者のロールを変えるため、管理者側のE2Eテストは並列数の上限を1にして1件ずつ実行する(利用者側のE2Eテストとは並行する)。
- テストの時間切れ・`Ctrl+C`などの中断で`finally`が実行されないと、モデレーターにした管理者が戻らない。戻す処理自体が失敗したときは、テストが`一時的にモデレーターにした最上位管理者を戻せませんでした: <ID>, <ID>`で失敗し、IDを示す。次のようにローカルのD1で確かめて戻す(`--local --persist-to`を付けてローカルの状態だけを操作する。「[ローカル状態の永続化と共有](../GUIDES/tech/infra/001-wrangler-conventions.md#ローカル状態の永続化と共有)」)。

  ```sh
  cd /workspace/apps/api
  # 有効なモデレーターの一覧から、最上位管理者だった管理者(自分で用意した管理者のメールアドレスなど)を探す
  bunx wrangler d1 execute DB --local --persist-to /workspace/.wrangler/state --command "SELECT id, email, nickname FROM admins WHERE role = 'moderator' AND status = 'active';"
  # 失敗の表示のIDか、探した管理者のIDを指定して戻す
  bunx wrangler d1 execute DB --local --persist-to /workspace/.wrangler/state --command "UPDATE admins SET role = 'super_admin' WHERE id = '<ID>';"
  ```

  - テストが作った管理者(`e2e-<乱数>@test.example`)は戻さなくてよい。テストは毎回新しい管理者を用意し、以前の管理者を使わない。
  - 開発者が用意した管理者をモデレーターに変えずに管理者側のE2Eテストを実行することはできない。ローカルの最上位管理者を常に使いたいときは、E2Eテストの後に上のSQLで戻すか、招待の発行コマンドで新しい最上位管理者を用意する(「[ローカルの最初の最上位管理者](#ローカルの最初の最上位管理者)」)。

- 対象のURLは`E2E_CLIENT_URL`・`E2E_ADMIN_URL`で上書きでき、既定はローカルの`http://localhost:48044`・`http://localhost:48045`である(「[テスト戦略の前提と用語](../GUIDES/tech/testing/001-test-strategy.md#前提と用語)」)。デプロイ先検証環境に向けるときは、2つの環境変数に`staging`のURL(「[配信URL一覧](../../README.md#配信url一覧)」)を指定する。
- ローカル環境にはアクセス解析のトークン・エラートラッキングのDSNが無いため(bot判定は常に成功するテスト用の非表示のウィジェットを使う)、それらに関わる確認は対象が無ければ飛ばし、飛ばしたことをテストの結果の注記(「確認の省略」)に残す。エラートラッキングのSDKの静的な取り込み、静的なファイルのセキュリティヘッダー、静的なファイルがWorkerを通らずに配信されること(`/assets/*.js`と`/favicon.ico`の応答に`no-store`も`X-Robots-Tag`も無く、`/assets/*.js`は`immutable`で長期キャッシュされる)の確認は、ビルド後の対象(プレビュー・`staging`)でだけ行い、開発サーバーでは飛ばしたことを注記に残す。
- 並列数(Playwrightのワーカーの数)の上限は既定で2である。開発サーバーに対して多く並列に実行するとworkerdが機械の負荷で落ちることがあるため、ローカルもCIも`E2E_WORKERS`を設定せずに同じ上限で実行する。一時的に変えたいときだけ`infisical --telemetry=false run --env dev -- env E2E_WORKERS=1 bun run test:e2e`のように1以上の整数を指定する(1以上の整数でなければ設定の読み込みで失敗する)。コマンドの`--workers`の引数は`E2E_WORKERS`より優先される(「[E2Eテストの実行](../GUIDES/tech/testing/001-test-strategy.md#e2eテストの実行)」)。管理者側のE2Eテストは、この上限にかかわらず1件ずつ実行する(上の`withSoleActiveSuperAdmin`の説明)。
- 存在しないページを開いたときのブラウザのコンソールの読み込みの失敗は、404の応答によるもので想定どおりである。
- 開発サーバーに対する実行では、最初の再確認のクリックがハイドレーションの前で取りこぼされることがあるため、テストは再確認の案内が消えるまで押し直して確かめる。案内が消えた後は押さないため、中継への要求は再確認の1件だけになる。

### 開発サーバーとビルド後のプレビューの両方での実行

ルートの`bun run test:e2e:dev-and-preview`は、利用者側・管理者側のフロントエンドを開発サーバー(`bun run dev --port 48044 --host 0.0.0.0`・`bun run dev --port 48045 --host 0.0.0.0`)で起動してE2Eテストを実行し、止めてから`bun run build`の後にプレビュー(`bun run preview`に同じ引数)で起動して、同じE2Eテストを実行する。開発サーバーでは飛ばすビルド後の対象だけの確認も、同じ1回の実行のプレビューの段階で確かめる。

1. APIサーバーとイベントサーバーをクイックスタートの手順13のとおり先に起動し、APIサーバーのヘルスチェックが200を返すことを確かめる。このコマンドはどちらのサーバーも起動しない。イベントサーバーを起動していないと、確認のメールが届かず、メールを読むE2Eテスト(`e2e/client/auth/`・`e2e/admin/`)が待ちの期限で失敗する。管理者側のE2Eテストのために、先に`apps/api`で`bun run db:migrate:local`を実行しておく。
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

# 業務日付2026-11-02の業務時刻16:21(UTCの2026-11-03 0:21)の定期実行を起こす
curl "http://localhost:48042/cdn-cgi/local/scheduled?cron=21+0+*+*+*&time=1793665260000"

# 業務日付2026-11-02の業務時刻23:40(UTCの2026-11-03 7:40)の定期実行を起こす
curl "http://localhost:48042/cdn-cgi/local/scheduled?cron=40+7+*+*+*&time=1793691600000"
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

## キーワード抽出の外部API

全文検索の索引の更新では、イベントサーバーがGoogle Cloud Natural Language APIで検索のキーワードを抽出する(「[外部の自然言語APIによるキーワード抽出](../GUIDES/tech/external/002-natural-language-keyword-extraction.md)」)。

- ローカル環境ではキーワード抽出が無効である(`apps/event`の`KEYWORD_EXTRACTOR`が`disabled`)。外部APIを呼ばず、抽出の対象のテキストがある索引文書を状態`disabled`の縮退索引にする(抽出の対象のテキストが空の索引文書は、空のキーワードで`extracted`になる)ため、キーが無くてもアプリを起動でき、料金も発生しない。ローカルで`KEYWORD_EXTRACTOR`を`google-natural-language`に変えても、ローカル環境の`secrets.required`にキーが無いため`wrangler dev`はキーを渡さず、環境の検証で失敗する。
- 実際の外部APIは、次の疎通確認のスクリプトで手元から確かめる。Infisicalの`staging`の`GOOGLE_NL_API_KEY`を注入して実行し、日本語と英語の短文ごとに抽出の結果・言語・キーワードの数を表示する。全て抽出できれば終了コード0、抽出できない短文があれば1、キーが注入されていなければ登録と実行の手順を表示して2で終わる。キーの値は表示しない。

  ```sh
  cd /workspace/apps/event
  infisical --telemetry=false run --env staging -- bun run smoke:keyword-extraction
  ```

- 結果の種類ごとの原因の切り分けは「[疎通確認](../GUIDES/tech/external/002-natural-language-keyword-extraction.md#疎通確認)」に従う。

キーは開発者が用意して登録し、AIエージェントは登録しない。

1. Google Cloudのプロジェクトで、Natural Language APIを有効にし、APIの制限(Cloud Natural Language APIだけ)を掛けた専用のAPIキーを発行する(「[APIキーの渡し方とAPIの制限](../GUIDES/tech/external/002-natural-language-keyword-extraction.md#apiキーの渡し方とapiの制限)」)。
2. Infisicalのプロジェクトの`staging`環境のルートフォルダ(`/`)に、Webの管理画面で`GOOGLE_NL_API_KEY`を登録する。`staging`の`secrets.required`にキーを加える変更を`main`へマージする前に登録する。未登録のままマージすると、イベントサーバーのデプロイが欠けたキーの名前を示して止まり、登録するまで`staging`へのデプロイがすべて止まる。
3. 登録だけで、次のstagingへのデプロイがWorkerへ反映する。Wranglerのシークレットのコマンドで直接設定しない。

- 本番環境(`prod`)の`GOOGLE_NL_API_KEY`は、launch-readinessがリリース時に登録する。
- 登録先のフォルダと時期は「[Workerのシークレットのキーの一覧](project-values.md#workerのシークレットのキーの一覧)」、変数の各環境の値は「[バインディング・変数・シークレット](project-values.md#バインディング変数シークレット)」を正とする。

## 画像のアップロード・判定・配信

アップロードされたファイルは、APIサーバーが受け付けてR2に保存し、画像はイベントサーバーが自動判定・保存先の移動・配信を行う(「[アップロードの安全対策](../GUIDES/tech/security/005-file-upload-security.md)」「[画像判定サービス](../GUIDES/tech/external/003-image-moderation.md)」「[画像の変換配信とエッジキャッシュ](../GUIDES/tech/infra/008-image-delivery.md)」)。本プロジェクトの値は「[画像のアップロード・判定・配信](project-values.md#画像のアップロード判定配信)」を参照する。

### ローカルでの画像配信のURL

ローカル環境では、イベントサーバーのオリジン`http://localhost:48043`が画像配信のオリジンを兼ねる(`IMAGE_DELIVERY_HOSTNAME`が`localhost`、`IMAGE_DELIVERY_DEDICATED_HOST`が`false`)。画像のURLの形の要求だけを画像配信として扱い、ヘルスチェックや動作確認の経路などの他の要求は通常どおり応答する。

```text
http://localhost:48043/<オブジェクトキー>/<バリアント名>.<拡張子>
```

- `<オブジェクトキー>`はアップロードの応答の`objectKey`(32文字の小文字の16進)である。`<バリアント名>`は`square-xs`・`square-sm`・`square-md`・`square-lg`・`screenshot-thumb`・`screenshot-thumb-2x`・`screenshot-full`、`<拡張子>`はラスター画像なら`webp`・`jpg`・`png`(長辺1,200px以下のバリアントは`avif`も)、SVGなら`svg`だけである(「[画像バリアント仕様](../GUIDES/service/features/002-image-variants.md)」)。
- 利用者側・管理者側のフロントエンドとStorybookの画像の表示部品も、`IMAGES_ORIGIN`(ローカル環境は`http://localhost:48043`)からこのURLを組み立てる。イベントサーバーを起動していない間は、画像の代わりにプレースホルダーが表示される。
- ローカルの画像変換は簡易版で`fit`・`quality`が効かず、エッジキャッシュも無い。隔離・削除した画像はすぐに404になる。キャッシュとパージ・変換の品質・JPEGの出力のメタデータはstagingで確かめる(「[画像配信のローカルとテストでの差](../GUIDES/tech/infra/008-image-delivery.md#ローカルとテストでの差)」)。
- 判定は代替の判定(`MODERATION_PROVIDER`が`stub`)で、判定サービスを呼ばずに判定用画像の寸法で結果を決める。99×99の画像は不適切として隔離され、98×98の画像は一時的な失敗が続いて約15分後に未判定になり、97×97の画像は判定サービスが受け付けない画像として隔離される(「[代替の判定](../GUIDES/tech/external/003-image-moderation.md#代替の判定)」)。

### 画像の動作確認の経路

イベントサーバーの`/internal/media/smoke/images`は、`MEDIA_SMOKE_TOKEN`を登録した環境だけで有効になる、トークン付きの動作確認の経路である。本番と同じ受付処理・判定・保存先の移動・パージ・配信を通り、画像のアップロード・状態の取得・隔離・隔離の解除・即時の削除ができる(経路と応答の一覧は「[画像の動作確認の経路](../GUIDES/tech/infra/008-image-delivery.md#動作確認の経路)」)。アップロードしたファイルは紐付けないため、日次のジョブが48時間以内に物理削除する。

1. クイックスタートの手順11で`MEDIA_SMOKE_TOKEN`を登録し、手順12でマイグレーションを適用し、手順13でイベントサーバーを起動する。この経路の確認だけなら、APIサーバーの起動は要らない。
2. 確かめる画像を作る。次の例は、Wranglerのローカルの画像変換が使う`sharp`(`apps/event`の直接の依存ではなくWranglerが間接に入れるため、Wranglerの更新で使えなくなることがある)で、640×640(代替の判定で問題なし)と99×99(代替の判定で不適切)のPNGを作る。

   ```sh
   cd /workspace/apps/event
   bun -e "import sharp from 'sharp'; for (const size of [640, 99]) await sharp({ create: { width: size, height: size, channels: 3, background: '#808080' } }).png().toFile('/tmp/media-smoke-' + size + '.png')"
   ```

3. 別のターミナルで、Infisicalから注入したトークンを使って640×640の画像をアップロードする。トークンの値をコマンドに直接書かない。

   ```sh
   cd /workspace/apps/event
   infisical --telemetry=false run --env dev -- sh -c 'curl -s -X POST -H "Authorization: Bearer $MEDIA_SMOKE_TOKEN" -H "Content-Type: image/png" -H "x-upload-file-name: media-smoke-640.png" --data-binary @/tmp/media-smoke-640.png http://localhost:48043/internal/media/smoke/images'
   ```

   - Infisicalの注入は、プロジェクトの設定`/workspace/.infisical.yaml`を見つけられる`/workspace`の配下で実行する(配下の外では「Please either run infisical init…」で失敗する)。以降の手順の注入も同じ。

4. 201と本文`{"data":{"fileId":"<ファイルの識別子>",…,"objectKey":"<オブジェクトキー>"}}`が返ることを確かめ、`fileId`と`objectKey`を控える。
5. 状態を取得し、`moderationStatus`が`passed`、`location`が`images`、`quarantineReasons`と`findings`が空になることを確かめる。判定は非同期のため、`pending`なら数秒おいて取得し直す。

   ```sh
   cd /workspace/apps/event
   infisical --telemetry=false run --env dev -- sh -c 'curl -s -H "Authorization: Bearer $MEDIA_SMOKE_TOKEN" http://localhost:48043/internal/media/smoke/images/<ファイルの識別子>'
   ```

6. 画像のURL(`curl -i http://localhost:48043/<オブジェクトキー>/square-sm.webp`)が200と`Content-Type: image/webp`を返すことを確かめる。
7. `POST /internal/media/smoke/images/<ファイルの識別子>/quarantine`で隔離し(202)、状態の`location`が`quarantine`・`quarantineReasons`が`["admin_action"]`になった後、画像のURLが404になることを確かめる。`POST …/release`で隔離を解除し(202)、`location`が`images`に戻った後、再び200になることを確かめる。保存先の移動は非同期のため、数秒おいて確かめる。

   ```sh
   cd /workspace/apps/event
   infisical --telemetry=false run --env dev -- sh -c 'curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Authorization: Bearer $MEDIA_SMOKE_TOKEN" http://localhost:48043/internal/media/smoke/images/<ファイルの識別子>/quarantine'
   infisical --telemetry=false run --env dev -- sh -c 'curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Authorization: Bearer $MEDIA_SMOKE_TOKEN" http://localhost:48043/internal/media/smoke/images/<ファイルの識別子>/release'
   ```

8. 99×99の画像を同じ手順でアップロードし、状態の`moderationStatus`が`flagged`、`location`が`quarantine`、`quarantineReasons`が`["auto"]`、`findings`にカテゴリ`Explicit`・信頼度99の検出があり、画像のURLが404になることを確かめる。

   ```sh
   cd /workspace/apps/event
   infisical --telemetry=false run --env dev -- sh -c 'curl -s -X POST -H "Authorization: Bearer $MEDIA_SMOKE_TOKEN" -H "Content-Type: image/png" -H "x-upload-file-name: media-smoke-99.png" --data-binary @/tmp/media-smoke-99.png http://localhost:48043/internal/media/smoke/images'
   ```

9. `DELETE /internal/media/smoke/images/<ファイルの識別子>`で即時に物理削除し(202)、画像のURLと状態の取得がどちらも404になることを確かめる。

   ```sh
   cd /workspace/apps/event
   infisical --telemetry=false run --env dev -- sh -c 'curl -s -o /dev/null -w "%{http_code}\n" -X DELETE -H "Authorization: Bearer $MEDIA_SMOKE_TOKEN" http://localhost:48043/internal/media/smoke/images/<ファイルの識別子>'
   ```

10. イベントサーバーのログで、判定(カテゴリ`['event', 'media', 'moderation']`)・保存先の移動(`['event', 'media', 'relocation']`)・パージ(`['event', 'media', 'purge']`の「エッジキャッシュをパージしました」と件数`purgedCount`。ローカル環境はエッジキャッシュが無いため、何もせず成功する)の記録を確かめる。
    - `relocation`のログ(「保存先をそろえました」)は、管理者の操作の隔離・解除(手順7)でだけ出る。判定による隔離(手順8)の保存先の移動は、判定の処理の中で行い、判定のログ(「画像の判定を終えました」)の`moved`に移動した件数が記録される。

| 応答                              | 原因と対処                                                                                                                              |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 401                               | トークンが一致しない。`--env dev`で注入しているか、イベントサーバーを起動したときと同じ値かを確かめる                                   |
| 404(全ての経路)                   | `MEDIA_SMOKE_TOKEN`が未登録。登録した後、イベントサーバーを起動し直す                                                                   |
| 404(状態の取得・隔離・解除・削除) | ファイルの識別子が誤っているか、動作確認の用途以外のファイル・削除済みのファイルを指している                                            |
| 415・413・422など                 | 受付の検証による拒否。本文の`error.code`の意味は「[アップロードの安全対策](../GUIDES/tech/security/005-file-upload-security.md)」に従う |

- stagingでは、URLを「[画像のアップロード・判定・配信](project-values.md#画像のアップロード判定配信)」のstagingの経路と画像配信のホスト名に、注入を`--env staging`に替えて同じ手順で確かめる。stagingで確かめる項目(キャッシュのヒットとパージ・`fit`と品質・JPEGの出力のメタデータ・判定のCPU時間とメモリ・判定サービスとの疎通)と手順は「[画像配信のstagingでの確認](../GUIDES/tech/infra/008-image-delivery.md#stagingでの確認)」と「[判定サービスとの疎通](../GUIDES/tech/external/003-image-moderation.md#判定サービスとの疎通)」に従う。
- 本番環境(`prod`)には`MEDIA_SMOKE_TOKEN`を設定せず、動作確認の経路は404のままになる。

### stagingの画像判定のシークレット

デプロイ先検証環境(`staging`)のイベントサーバーは、Amazon Rekognitionで画像を判定する(`MODERATION_PROVIDER`が`rekognition`)。次のシークレットは開発者がInfisicalの`staging`環境へ手作業で登録し、AIエージェントは登録しない。Infisicalの値を正とする。

| キー                                                         | 登録する値                                                                                                 | 必須                                                         |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `REKOGNITION_ACCESS_KEY_ID`・`REKOGNITION_SECRET_ACCESS_KEY` | 判定の呼び出し(`rekognition:DetectModerationLabels`)だけを許可した、staging専用のIAMユーザーのアクセスキー | 必須。`secrets.required`にあり、未設定ではデプロイが失敗する |
| `MEDIA_SMOKE_TOKEN`                                          | `openssl rand -hex 32`で生成した、ローカル環境と別の値                                                     | 任意。動作確認の経路を使うときだけ                           |

1. AWSで、staging用のIAMのポリシーとユーザーを作ってアクセスキーを発行し(「[IAMユーザーとポリシーを作る](../GUIDES/tech/external/003-image-moderation.md#iamユーザーとポリシーを作る)」)、AIサービスのオプトアウトを有効にする(「[AIサービスのオプトアウト](../GUIDES/tech/external/003-image-moderation.md#aiサービスのオプトアウト)」)。決めた名前とアカウントIDは「[画像のアップロード・判定・配信](project-values.md#画像のアップロード判定配信)」の表に記入する。
2. Infisicalのプロジェクトの`staging`環境のルートフォルダ(`/`)に、Webの管理画面で上の値を登録する。stagingの値は、そのキーを必須にする変更をmainへマージする前に開発者が登録する。任意の`MEDIA_SMOKE_TOKEN`も、マージの後のstagingの確認に使うため、同じマージの前に登録する。未登録のままマージすると、イベントサーバーのデプロイが欠けたキーの名前を示して止まり、登録するまで`staging`へのデプロイがすべて止まる。
3. 登録だけで、次のstagingへのデプロイがWorkerへ反映する(「[stagingへのデプロイとリリース](#stagingへのデプロイとリリース)」)。Wranglerのシークレットのコマンドで直接設定しない(設定しても次のデプロイでInfisicalの値に戻る)。
4. デプロイの後、動作確認の経路で通常の画像の判定が`passed`になることを確かめる(「[判定サービスとの疎通](../GUIDES/tech/external/003-image-moderation.md#判定サービスとの疎通)」)。

- prodの値はlaunch-readinessがリリース時に登録する。prodのIAMユーザーはstagingと別に作り、prodには`MEDIA_SMOKE_TOKEN`を登録しない。
- アクセスキーが漏れたときは「[資格情報の漏えい時の手順](../GUIDES/tech/external/003-image-moderation.md#資格情報の漏えい時の手順)」に従う。
- 登録先のフォルダと時期は「[Workerのシークレットのキーの一覧](project-values.md#workerのシークレットのキーの一覧)」、変数の各環境の値は「[バインディング・変数・シークレット](project-values.md#バインディング変数シークレット)」を正とする。

## 使い捨てメールアドレスの判定のAPIキー

APIサーバーとイベントサーバーは、メールアドレスの確認とメールアドレスの変更の確定の時に、DISIFYで使い捨てメールアドレスかを判定する(「[使い捨てメールアドレスの判定サービス](../GUIDES/tech/external/005-disposable-email-check.md)」)。判定できなければ未判定として保存し、後で判定し直す。漏洩パスワードの照合(Have I Been Pwned)はAPIキーが要らない。

- ローカル環境ではAPIキーを登録せず、判定サービスを呼ばずに全てのメールアドレスを通常として扱う。未判定にならないため、運用者への通知も判定し直しも起こらない(「[APIキーの渡し方](../GUIDES/tech/external/005-disposable-email-check.md#apiキーの渡し方)」)。
- デプロイ先の環境(`staging`・`prod`)ではAPIキーが必須である。`apps/api`・`apps/event`の`env.staging`・`env.prod`の`secrets.required`にあり、`APP_ENVIRONMENT`が`staging`・`prod`のときは環境の検証もキーの欠けと空文字を不備として起動時に止める。
- 単体テストとWorkers統合テストは判定サービスへ通信しない。判定サービスを通すイベントサーバーのWorkers統合テストは、テスト用のキーを環境に持たせる(「[テストでの差し替え](../GUIDES/tech/external/005-disposable-email-check.md#テストでの差し替え)」)。

デプロイ先検証環境(`staging`)のAPIキーは開発者が用意してInfisicalの`staging`環境へ登録し、AIエージェントは登録しない。Infisicalの値を正とする。

1. DISIFYの無料のアカウントを作り、APIキーを発行する(「[APIキーの渡し方](../GUIDES/tech/external/005-disposable-email-check.md#apiキーの渡し方)」)。作ったばかりのアカウントは、最初の24時間の上限が低い。
2. Infisicalのプロジェクトの`staging`環境のルートフォルダ(`/`)に、Webの管理画面で`DISIFY_API_KEY`を登録する。stagingの値は、そのキーを読む変更(利用者のアカウントの機能)を`main`へマージする前に登録する。必須のシークレットのため、未登録のままでは`apps/api`・`apps/event`のデプロイが欠けたキーの名前を示して止まる。
3. 登録だけで、次のstagingへのデプロイが`apps/api`・`apps/event`のWorkerへ反映する(「[stagingへのデプロイとリリース](#stagingへのデプロイとリリース)」)。Wranglerのシークレットのコマンドで直接設定しない(設定しても次のデプロイでInfisicalの値に戻る)。

- 本番環境(`prod`)の`DISIFY_API_KEY`も、開発者がInfisicalの`prod`環境のルートフォルダ(`/`)へ登録済みである。
- 登録先のフォルダと時期は「[Workerのシークレットのキーの一覧](project-values.md#workerのシークレットのキーの一覧)」、本プロジェクトの値は「[利用者のアカウント](project-values.md#利用者のアカウント)」を正とする。

## 決済(Stripe)のキー

ローカル環境では、Stripeのキー(`STRIPE_API_KEY`・`STRIPE_WEBHOOK_SECRET`)を登録しなくても`apps/api`・`apps/event`は起動する。決済の機能(決済の開始・決済画面・価格の照会)だけが「決済を利用できない」(`payments_unavailable`)になり、他の機能は影響を受けない。

- `apps/api`の`STRIPE_API_KEY`と、`apps/event`の`STRIPE_API_KEY`・`STRIPE_WEBHOOK_SECRET`は、Wrangler設定のルート(ローカル環境)と`env.staging`・`env.prod`の`secrets.required`にある。Wranglerは`secrets.required`に挙げたキーだけをWorkerへ渡す(「[Workersのコードから参照するシークレット](../GUIDES/tech/security/001-secret-management.md#workersのコードから参照するシークレット)」)ため、次の手順でInfisicalの`dev`へ登録すれば、Workerの指定付きで起動したローカル環境の`apps/api`・`apps/event`へ渡り、決済を試せる。
- 未登録の間は、起動時にWranglerが足りないキーの名前を警告するが、環境の検証はStripeのキーを任意として扱うため起動は止まらない。警告は決済を試さない限り無視してよい。
- Infisicalの`dev`は全ての開発者のローカル環境と、検査のE2E(CI。`e2e-stack`が`dev`の値をWorkerの指定付きで注入する)で共有する。登録すると、それらの疎通確認の決済のE2Eが飛ばされずに実行されるため、`apps/client`のローカルの`STRIPE_PUBLISHABLE_KEY`を同じsandboxの公開キーへ置き換える変更と合わせて登録する(仮の値のままでは決済画面のStripe.jsが公開キーを拒み、E2Eが失敗する)。

決済を試す開発者は、次の手順でdevのキーを用意して登録する。AIエージェントは登録しない。手順の詳細と権限は「[決済の環境とデータの運用](../GUIDES/tech/operations/004-payment-data-operations.md)」に従う。

1. Stripeのダッシュボードで、ローカル環境用のsandbox(デプロイ先検証環境のsandboxとは別)を作り、「[環境ごとのStripeの設定](../GUIDES/tech/operations/004-payment-data-operations.md#環境ごとのstripeの設定)」の価格(疎通確認用の`payments_smoke`を含む)・税・Adaptive Pricingの無効化・決済手段を設定する。
2. 同じsandboxで、`apps/api`用と`apps/event`用の2つの制限付きキーを、「[制限付きキーの権限](../GUIDES/tech/operations/004-payment-data-operations.md#制限付きキーの権限)」の表の権限で別々に作る。
3. Infisicalのプロジェクトの`dev`環境で、`apps/api`用の鍵をWorkerごとのフォルダ`/workers/api`へ、`apps/event`用の鍵を`/workers/event`へ、どちらも`STRIPE_API_KEY`の名前でWebの管理画面から登録する。共通のフォルダ(`/`)には置かない(`WORKER_SCOPED_SECRETS`のキーのため、`/`の値は使われない)。
4. `stripe listen --print-secret`で表示される転送の署名の秘密を、`dev`の共通のフォルダ(`/`)へ`STRIPE_WEBHOOK_SECRET`の名前で登録する(「[ローカルの転送](../GUIDES/tech/operations/004-payment-data-operations.md#ローカルの転送)」)。
5. 値を表示せずに、Workerの指定付きの注入でWorkerごとの値が重なることを確かめる。

   ```sh
   bun /workspace/scripts/delivery/cli.ts run-with-secrets --scope local --worker api -- sh -c 'test -n "$STRIPE_API_KEY" && echo "apps/api用の鍵は登録済み"'
   bun /workspace/scripts/delivery/cli.ts run-with-secrets --scope local --worker event -- sh -c 'test -n "$STRIPE_API_KEY" && test -n "$STRIPE_WEBHOOK_SECRET" && echo "apps/event用の鍵と署名の秘密は登録済み"'
   bun /workspace/scripts/delivery/cli.ts run-with-secrets --scope local -- sh -c 'test -z "$STRIPE_API_KEY" && echo "Workerの指定が無ければ鍵は渡らない"'
   ```

- 公開キーは`apps/client`のWrangler設定の`vars`の`STRIPE_PUBLISHABLE_KEY`に書く。ローカル環境の値は、開発者がローカル環境用のsandboxの公開キーを用意するまで仮の値のままである(「[バインディング・変数・シークレット](project-values.md#バインディング変数シークレット)」)。
- 登録先のフォルダと時期は「[Workerのシークレットのキーの一覧](project-values.md#workerのシークレットのキーの一覧)」を正とする。

### ローカルのWebhookの転送

ローカル環境にはStripeのWebhook endpointを作らず、Stripe CLIで開発用のsandboxの通知をローカルのイベントサーバーへ転送する。上の手順でキーと署名の秘密を登録し、クイックスタートの手順7で`stripe login`を済ませ、手順13でAPIサーバーとイベントサーバーを起動してから、別のターミナルで転送を起動する。

```sh
stripe listen \
  --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired,invoice.paid,invoice.payment_failed,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,refund.created,refund.updated,refund.failed,charge.dispute.funds_withdrawn,charge.dispute.funds_reinstated,charge.dispute.closed \
  --forward-to http://localhost:48043/webhooks/stripe
```

- 購読する15種は、イベントサーバーが受け付ける通知の種類(`apps/backend-lib/core/payments/stripe-event-mapping.ts`の`HANDLED_STRIPE_EVENT_TYPES`)と同じである。種類の意味と、署名の秘密・API版の扱いは「[ローカルの転送](../GUIDES/tech/operations/004-payment-data-operations.md#ローカルの転送)」に従う。
- 転送の署名の秘密(`stripe listen --print-secret`)は、`stripe listen`を起動し直しても変わらない。`stripe login`をし直したときなどに`--print-secret`の値が登録した値と変わったら、`dev`の`STRIPE_WEBHOOK_SECRET`を登録し直し、イベントサーバーを起動し直す。
- 転送の画面に、通知ごとにイベントサーバーの応答の状態コードが出る。200以外なら、イベントサーバーのログのカテゴリ`['event', 'payments', 'webhook']`で理由を確かめる。署名の不正(400)は署名の秘密の登録の誤り、503は署名の秘密がイベントサーバーへ渡っていないことを示す(上の「Wrangler設定のルートの`secrets.required`」の変更が入るまでは、登録しても503になる)。
- 転送を止めている間は、定期課金・請求・返金・チャージバックの通知が反映されない。決済後のランディングは通知を待たずに決済セッションを取得して反映するため、即時の決済手段なら転送が無くても完了まで進む設計だが、転送を止めた状態の疎通確認の決済ではまだ確かめていない。

## DBスキーマを変更したとき

テーブル定義を`apps/db/schema/`に書き(「[テーブル定義の配置](../GUIDES/tech/db/003-schema-conventions.md#テーブル定義の配置)」)、次の順でマイグレーションを生成して適用する。各手順の詳細は「[スキーマ規約のマイグレーション](../GUIDES/tech/db/003-schema-conventions.md#マイグレーション)」に従う。

```sh
# 1. マイグレーションを生成する(apps/db/migrations/<日時>_<名前>/migration.sql)
cd /workspace/apps/db
bun run db:generate --name=<マイグレーションの名前>
bunx drizzle-kit generate --custom --name=<マイグレーションの名前> # テーブル定義で表せない内容(全文検索の仮想テーブル・トリガーなど)を生のSQLで書く場合
bun run --silent db:search-index-sql <索引文書のテーブル名> [--drop | --recreate | --triggers --rebuild] # 全文検索の索引のSQLを、apps/db/search/search-indexes.tsに登録した定義から出力してカスタムマイグレーションに貼る

# 2. ローカルのD1に適用し、生成したマイグレーションがWranglerに検出されることを確かめる
cd /workspace/apps/api
bun run db:migrate:local
bun run db:migrations:check
```

- 全文検索の索引する列や前方一致の長さを変える場合のオプションの使い分けと、マイグレーションを作る順は「[列の変更とトリガーの作り直し](../GUIDES/tech/db/004-full-text-search.md#列の変更とトリガーの作り直し)」に従う。索引する列を消す場合は、テーブル定義を変える前に`--drop`の出力を貼ったカスタムマイグレーションを作る。
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
docker compose up -d --build # Dockerfileも変わったとき(新しい名前付きボリュームのマウント先の作成など)は、イメージを作り直してからコンテナを作り直す
```

再作成後、コンテナ内で共有ディレクトリの配置状態を確かめる。

```sh
cd /workspace
bun run shared-dirs:verify
```

- 共有ディレクトリを追加した変更(共用部品`apps/common-lib`の4つの配置先のbind mountと`node_modules`の名前付きボリュームの追加など)を取り込んだときも、`docker compose up -d --build`で作り直す。作り直すまでは配置先のbind mountが無く、`bun run shared-dirs:verify`が`missing`を報告する。作り直す前に検査を通すときは、ルートで`bun run shared-dirs:place`を実行して配置先へコピーする(配置先はGit管理外)。作り直した後は、新しい名前付きボリュームが空で作られて作り直す前の`node_modules`が隠れるため、`cd /workspace/apps/common-lib && bun install`で依存を導入し直す。
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

| コマンド                            | 対象                     | 内容                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run lint`・`bun run typecheck` | `apps/api`・`apps/event` | 静的解析・型検査。共有ディレクトリ(`db`・`lib`)の静的解析は検査担当の`apps/api`が受け持ち、共用部品の配置先`common-lib`は両アプリとも静的解析から除く(検査担当は`apps/common-lib`自身)。型検査は配置先`common-lib`の実行時のコードを含め、設定ファイル(`common-lib/*.config.ts`)・テスト・`common-lib/config/`・`common-lib/markdown/fixtures/`を除く(テストが読み込む実行環境の間の照合の標本は、読み込みを通じて型検査される) |
| `bun run test:unit`                 | `apps/api`・`apps/event` | 単体テスト(Bun)。共有ディレクトリ(`apps/db`・`apps/backend-lib`)の単体テストは`apps/api`が実行し、共用部品(`apps/common-lib`)の配置先は両アプリとも除いた`bunfig.unit.toml`を使う                                                                                                                                                                                                                                               |
| `bun run test:worker`               | `apps/api`・`apps/event` | Workers統合テスト(Vitest、workerd上)。`apps/api`はマイグレーションを適用したD1と共有ディレクトリのWorkers統合テストを含む。共用部品の配置先`common-lib`は両アプリとも除く                                                                                                                                                                                                                                                       |
| `bun run test:smoke`                | `apps/api`               | 依存性注入のスモークテスト。Wranglerでバンドルして起動したWorkerが、`@inject`付きのコンストラクタ引数を持つクラスを解決できることを確かめる                                                                                                                                                                                                                                                                                     |
| `bun run smoke:keyword-extraction`  | `apps/event`             | 実際のGoogle Cloud Natural Language APIへの疎通確認。テストと異なりキーの注入が要り、`infisical --telemetry=false run --env staging -- bun run smoke:keyword-extraction`で`staging`の`GOOGLE_NL_API_KEY`を注入する。日本語と英語の短文ごとに抽出の結果・言語・キーワードの数を表示し、全て抽出できれば終了コード0、できない短文があれば1、キーが注入されていなければ登録と実行の手順を表示して2で終わる。キーの値は表示しない   |
| `bun run db:migrations:check`       | `apps/api`               | マイグレーションがWranglerに検出されることを確かめる                                                                                                                                                                                                                                                                                                                                                                            |
| `bun run cf-typegen`                | `apps/api`・`apps/event` | Wrangler設定を変えたときに、実行時の型の定義ファイル`worker-configuration.d.ts`を生成し直す                                                                                                                                                                                                                                                                                                                                     |
| `bun run cf-typegen:check`          | `apps/api`・`apps/event` | 生成済みの`worker-configuration.d.ts`がWrangler設定と食い違っていないかを確かめる。ルートの一括検査(`bun run check`)でも実行される                                                                                                                                                                                                                                                                                              |
| `bun run graphql:generate`          | `apps/api`               | GraphQLのスキーマファイルとリゾルバの型を生成する(「[GraphQLのスキーマや操作を変更したとき](#graphqlのスキーマや操作を変更したとき)」)                                                                                                                                                                                                                                                                                          |
| `bun run graphql:allowlist`         | `apps/api`               | フロントエンドの操作の一覧から、GraphQLの許可リストを生成する                                                                                                                                                                                                                                                                                                                                                                   |
| `bun run graphql:check`             | `apps/api`               | GraphQLの生成物がスキーマモジュールと操作の一覧に食い違っていないかを確かめる。ルートの一括検査(`bun run check`)でも実行される                                                                                                                                                                                                                                                                                                  |

画面を持つアプリ(`apps/frontend-lib`・`apps/client`・`apps/admin`)だけを検査・テストするときは、各アプリのディレクトリで次のスクリプトを実行する。

| コマンド                                            | 対象                                             | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bun run lint`・`bun run typecheck`                 | `apps/frontend-lib`・`apps/client`・`apps/admin` | 静的解析・型検査。共有ディレクトリ(`lib`)の静的解析は検査担当の`apps/frontend-lib`が受け持ち、共用部品の配置先`common-lib`は`apps/client`・`apps/admin`の静的解析から除く。型検査は`lib`・`common-lib`の実行時のコードを含め、それぞれの設定ファイル・テスト・カタログ(`common-lib`は`config/`・`markdown/fixtures/`も)を除く(`apps/frontend-lib`のブラウザテストが読み込む実行環境の間の照合の標本は、読み込みを通じて型検査される) |
| `bun run test:unit`                                 | `apps/frontend-lib`・`apps/client`・`apps/admin` | 単体テスト(Bun)。`apps/client`・`apps/admin`は配置先の`lib`・`common-lib`を除いた`bunfig.unit.toml`を使う                                                                                                                                                                                                                                                                                                                            |
| `bun run test:browser`                              | `apps/frontend-lib`・`apps/client`・`apps/admin` | ブラウザテスト(Vitest Browser Mode、共有Chromium)。部品のアクセシビリティの自動検査を含む。`apps/client`・`apps/admin`は配置先の`lib`・`common-lib`を実行と網羅の対象から除く                                                                                                                                                                                                                                                        |
| `bun run storybook:dev`・`bun run storybook:build`  | `apps/frontend-lib`                              | 部品のカタログの起動と静的な出力。起動の手順はクイックスタートの手順13に従う                                                                                                                                                                                                                                                                                                                                                         |
| `bun run check:editor-chunks`                       | `apps/frontend-lib`                              | マークダウンの入力欄の編集領域(Milkdown・Vue・ProseMirror)が、ページの最初の読み込みとサーバー側の描画に含まれず動的な読み込みの先にだけあることを、クライアント用とSSR用のビルドで確かめる。エディタの版を更新した時や入力欄の読み込みを変えた時に実行する                                                                                                                                                                          |
| `bun run cf-typegen`・`bun run cf-typegen:check`    | `apps/client`・`apps/admin`                      | Wrangler設定を変えた時の環境の型の定義ファイル`worker-configuration.d.ts`の生成し直し(実行時の型は含めない)と、生成物の食い違いと環境の検証スキーマとの型の照合の検査。ルートの一括検査(`bun run check`)でも実行される                                                                                                                                                                                                               |
| `bun run graphql:generate`・`bun run graphql:check` | `apps/client`・`apps/admin`                      | フロントエンドの操作の型・文書・操作の一覧の生成と、生成物の食い違いの検査(食い違えば、再実行すべき`bun run graphql:generate`を表示して失敗する)                                                                                                                                                                                                                                                                                     |
| `bun run dev`・`bun run build`・`bun run preview`   | `apps/client`・`apps/admin`                      | 開発サーバー・ビルド・ビルド後のプレビュー。手順はクイックスタートの手順13・14に従う                                                                                                                                                                                                                                                                                                                                                 |

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

ローカルではD1の代わりにWranglerのD1ローカルモード、Cloudflare Email Serviceの代わりにMailpit、Cloudflare R2の代わりにWranglerのR2ローカルモード、Amazon Rekognitionの代わりに代替の判定(「[画像のアップロード・判定・配信](#画像のアップロード判定配信)」)を使う。
