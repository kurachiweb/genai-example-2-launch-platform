# IaC定義の構成

デプロイ先の環境のCloudflareの資源をOpenTofuで定義するときの、ディレクトリ構成・資源一覧の項目・モジュールの境界・資源の追加手順、状態の保管と暗号化、資格情報の受け取り方、providerの固定、2段階の適用、削除の防止、テスト、管轄の注意、既存の資源の取り込みを定める。

## 前提と用語

`staging`・`prod`の資源を1つの定義と環境ごとの資源一覧から作り、状態を同じアカウントのR2へ暗号化して置き、シークレットをInfisicalから実行時に受け取る構成を前提とする。全体の構成は「[インフラの構成](005-infrastructure-overview.md)」に従う。

| 用語                  | 意味                                                                                                                                        |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `<IaCのディレクトリ>` | IaC定義を置くディレクトリ                                                                                                                   |
| 資源一覧              | `<IaCのディレクトリ>/environments/<環境種別>.json`。環境ごとの資源の名前・識別子・管轄・ホスト名・Infisicalの識別子を持つ。秘密値を持たない |
| ルートモジュール      | `<IaCのディレクトリ>/live`。資源一覧を読み、providerと状態の保管先を設定し、子モジュールを呼ぶ                                              |
| 子モジュール          | `<IaCのディレクトリ>/modules/<名前>`。資源の種類のまとまりごとに資源を定義する                                                              |
| 状態                  | OpenTofuのstate。資源と実体の対応のほか、bot判定の秘密鍵などの秘密値を含む                                                                  |
| 計画ファイル          | `tofu plan -out`が書き出す適用前の計画。状態と同じく秘密値を含み得る                                                                        |
| `<状態のバケット>`    | 環境ごとの状態を置くR2バケット                                                                                                              |
| `<アカウントID>`      | CloudflareのアカウントのID(英小文字の16進32桁)                                                                                              |
| 構成検査              | 資源一覧と各アプリのWrangler設定・状態の保管先の設定の食い違いを確かめる検査。`bun <配布のスクリプト>/cli.ts contract-check`で実行する      |
| `<環境種別>`          | `staging`・`prod`。「[デプロイ先の環境種別](002-environments.md#デプロイ先の環境種別)」に従う                                               |

## ディレクトリ構成

```
<IaCのディレクトリ>/
├── environments/
│   ├── staging.json              # 資源一覧(staging)
│   └── prod.json                 # 資源一覧(prod)。stagingと同じ形
├── backends/
│   ├── staging.s3.hcl            # 状態の保管先(バケット・キー・接続先)の部分設定
│   └── prod.s3.hcl
├── live/                         # ルートモジュール。環境は初期化のbackend設定と変数environmentで選ぶ
│   ├── versions.tf               # required_version・required_providers(完全固定)・backend "s3"・encryption
│   ├── variables.tf              # environment・状態のパスフレーズ(sensitive)
│   ├── providers.tf              # infisical(hostだけ)・ephemeralのシークレット・cloudflare
│   ├── main.tf                   # 資源一覧の読み込み・子モジュールの呼び出し・環境の一致の確認
│   ├── outputs.tf                # resource_ids(秘密でない識別子だけ)
│   ├── tests/live.tftest.hcl     # 両環境の資源一覧がモジュールへ渡ることのテスト
│   └── .terraform.lock.hcl
└── modules/
    ├── storage/                  # D1・R2
    ├── messaging/                # Queues
    ├── edge-services/            # Turnstile・Web Analytics・送信ドメイン
    └── worker-routing/           # Workersのカスタムドメイン
```

- 各子モジュールは`versions.tf`・`variables.tf`・`main.tf`・`outputs.tf`・`.terraform.lock.hcl`と、`tests/<モジュール名>.tftest.hcl`を持つ。
- 変数の値は資源一覧と環境変数で与え、`*.tfvars`を使わない。`*.tfstate`・`*.tfplan`・`*.tfvars`・`.terraform`はGitの管理対象外にし、providerのロックファイル(`.terraform.lock.hcl`)は管理対象にする。

## 資源一覧の項目

```json
{
  "environment": "staging",
  "cloudflare": {
    "accountId": "<アカウントID>",
    "zoneId": "<ゾーンID>",
    "zoneName": "<ゾーン名>"
  },
  "jurisdiction": "<管轄>",
  "d1": { "main": { "name": "<データベース名>" } },
  "r2": { "<キー>": { "name": "<バケット名>" } },
  "queues": { "<キー>": { "name": "<Queueの名前>" } },
  "workers": {
    "api": { "name": "<Worker名>" }
  },
  "hostnames": {
    "<キー>": { "hostname": "<ホスト名>", "worker": "<workersのキー>" }
  },
  "turnstile": {
    "name": "<ウィジェットの名前>",
    "hostnames": ["<ホスト名>"],
    "mode": "invisible"
  },
  "webAnalytics": { "hostname": "<ホスト名>" },
  "emailSending": {
    "domain": "<送信ドメイン>",
    "eventsQueue": "<queuesのキー>",
    "events": [
      "message.bounced",
      "message.complained",
      "message.rejected",
      "message.failed"
    ],
    "subscriptionName": "<購読の名前>"
  },
  "state": { "bucket": "<状態のバケット>", "key": "live/terraform.tfstate" },
  "infisical": {
    "host": "<Infisicalのホスト>",
    "projectId": "<InfisicalのプロジェクトのID>",
    "identityId": "<マシンアイデンティティのID>",
    "oidcAudience": "<OIDCのaudience>"
  },
  "github": { "environment": "staging", "branch": "main" }
}
```

| 項目                 | 意味                                                                                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `environment`        | 環境種別。ファイル名と`github.environment`に一致させる                                                                                                      |
| `cloudflare`         | アカウントID・ゾーンID・ゾーン名。両環境で同じ値にする                                                                                                      |
| `jurisdiction`       | D1・R2・Queuesの管轄。全資源で同じ値にする                                                                                                                  |
| `d1`・`r2`・`queues` | 資源の名前のmap。キーは資源一覧の中だけの名前で、Wrangler設定のバインディング名とは独立している                                                             |
| `workers`            | WorkerのキーごとのWorker名だけ。アプリのディレクトリはアプリの一覧から引くため書かない。Worker名は各アプリのWrangler設定の`env.<環境種別>.name`と一致させる |
| `hostnames`          | 公開するホスト名と割り当てるWorkerのキー。1つのWorkerに複数のホスト名を割り当ててよい                                                                       |
| `turnstile`          | bot判定のウィジェットの名前・使うホスト名・種類。種類は非表示(`invisible`)だけを受け付ける                                                                  |
| `webAnalytics`       | アクセス解析のサイトの対象のホスト名                                                                                                                        |
| `emailSending`       | 送信ドメイン、配信不能イベントを届けるQueue(`queues`のキー)、購読するイベントの種類、購読の名前                                                             |
| `state`              | 状態のバケットとキー。`backends/<環境種別>.s3.hcl`と一致させる                                                                                              |
| `infisical`          | Infisicalのホスト・プロジェクトのID・その環境のデプロイの主体のID・OIDCのaudience                                                                           |
| `github`             | GitHubのEnvironmentの名前と、デプロイを許すブランチ                                                                                                         |

- 各項目の値は本プロジェクト固有の値であり、技術ドキュメントには写さない。
- アカウントID・ゾーンIDは、秘密でない識別子としてコミットする。主体のIDもコミットする。主体のIDは、OIDCのクレームと組み合わせないと認証に使えないためである。値がまだ無い項目には全桁0の仮の値(`00000000-0000-0000-0000-000000000000`、または`0`の32桁)を置く。デプロイの前の確認(`preflight`)が仮の値を見つけると、記入先のファイルを示して止まる。
- mapのキーは英小文字で始まり、英小文字・数字・ハイフンだけから成る。
- 次の不変条件を、資源一覧の解析(`parseResourceCatalog`)が確かめる。
  - `hostnames`の値・`emailSending.domain`は、すべて`cloudflare.zoneName`で終わる。
  - `turnstile.hostnames`と`webAnalytics.hostname`は、`hostnames`の値のいずれかである。
  - `emailSending.eventsQueue`は`queues`のキーである。
  - `hostnames`の`worker`は`workers`のキーである。
- JSONはコメントを書けないため、項目の意味は本文書を正とする。

## モジュールの境界

| モジュール       | 資源                                                                                                             | 主な入力                                                                           | 出力                                                                                       |
| ---------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `storage`        | `cloudflare_d1_database`(読み取りレプリカの無効・管轄・削除の防止)、`cloudflare_r2_bucket`(管轄・削除の防止)     | `account_id`・`jurisdiction`・`databases`・`buckets`                               | `database_ids`・`bucket_names`・`placement`                                                |
| `messaging`      | `cloudflare_queue`(管轄)                                                                                         | `account_id`・`jurisdiction`・`queues`                                             | `queue_ids`・`placement`                                                                   |
| `edge-services`  | `cloudflare_turnstile_widget`(削除の防止)、`cloudflare_web_analytics_site`、`cloudflare_email_sending_subdomain` | `account_id`・`zone_id`・`turnstile`・`web_analytics_host`・`email_sending_domain` | `turnstile_sitekey`・`web_analytics_site_token`・`email_sending_subdomain_id`・`placement` |
| `worker-routing` | `cloudflare_workers_custom_domain`                                                                               | `account_id`・`zone_id`・`domains`(ホスト名とWorker名のmap)                        | `hostnames`・`placement`                                                                   |

- 依存の向きは`live`→`modules/*`だけにする。子モジュール同士は参照しない。資源一覧はルートモジュールだけが読み、値を変数で子モジュールへ渡す。
- 子モジュールはproviderの設定を持たず、`required_providers`だけを宣言する。
- `storage`・`messaging`・`worker-routing`は、資源の種類ごとにmapの変数を`for_each`で回す。これらの資源の追加は資源一覧の項目の追加だけで済み、子モジュールを変えない。`edge-services`の資源は、環境ごとに1つずつ作る。
- ルートモジュールは、資源一覧の`hostnames`の`worker`(Workerのキー)を`workers`のWorker名へ引き直して`worker-routing`へ渡し、`turnstile.hostnames`を`edge-services`の`turnstile.domains`へ渡す。
- 次のものは定義しない。
  - Workerのプログラム(`cloudflare_workers_script`)・定期実行・メッセージの受信(`cloudflare_queue_consumer`)。Wranglerのデプロイが同じ版で反映するため、両方で管理すると互いに上書きし合う。
  - ゾーン全体に効くルールセット・ゾーンの設定(「[管理する範囲](005-infrastructure-overview.md#管理する範囲)」)。
  - 送信ドメインのDNSレコード。Email Serviceが送信ドメインの登録時に作ってロックする。APIでの登録で作られない場合に限り、`cloudflare_dns_record`を`edge-services`へ加える。
  - 配信不能イベントの購読。providerに資源が無いため、デプロイパイプラインが確かめる(「[配信不能イベントの購読](007-ci-cd-pipelines.md#配信不能イベントの購読)」)。
- ルートモジュールは`check`ブロックで、資源一覧の`environment`と変数`environment`の一致を確かめる。`check`の失敗は警告で、計画を止めない。
- 各子モジュールの`placement`は、計画した資源の属性から読んだアカウント・管轄・ゾーン(`edge-services`はアクセス解析のホスト名と送信ドメインも)を返す。`tofu test`のassertは子モジュールの変数と資源を参照できず出力だけを参照できるため、ルートモジュールのテストが入力の結線を確かめるのに使う。ルートモジュールの出力には含めない。

### 秘密でない識別子の出力

ルートモジュールの出力は、Wrangler設定へ写す秘密でない識別子をまとめた`resource_ids`だけにする。

```json
{
  "d1": { "main": "<データベースID>" },
  "turnstile_sitekey": "<サイトキー>",
  "web_analytics_site_token": "<トークン>"
}
```

- 識別子は状態が正で、Wrangler設定はその写しである。デプロイパイプラインの識別子の照合(`reconcile-ids`)が、写しの一致を確かめる(「[デプロイの段階](007-ci-cd-pipelines.md#デプロイの段階)」)。
- Turnstileの秘密鍵(`secret`)などの秘密値は、出力にしない。`locals`や子モジュールの引数を経由して出力されるのを防ぐため、resourceブロックの外では秘密鍵(`cloudflare_turnstile_widget.<名前>.secret`)も資源全体(`secret`を含む)も参照しない。`tofu output -json`は`sensitive`な出力の値も平文で表示するためである。`tofu output -json <出力名>`は`sensitive`の印も落とすため、照合は全出力を`tofu output -json`で読み、`sensitive`な出力の値に触れずに飛ばす。

## 資源の追加手順

### 既存の種類の資源を追加する

Queue・R2バケット・ホスト名の割り当てを追加するときは、次を同じ変更で行う。

1. 両環境の資源一覧の`queues`・`r2`・`hostnames`のmapに項目を加える。名前は環境の接尾辞の規則にそろえる。
2. 資源を使うアプリのWrangler設定の`env.staging`・`env.prod`へ、資源一覧と同じ名前でバインディングを加える。R2のバインディングには資源一覧と同じ`jurisdiction`を書く(「[管轄の注意](#管轄の注意)」)。
3. 構成検査(`contract-check`)で違反が0件であることを確かめる。資源一覧にあってどのWorkerからも参照されない資源も違反になるため、手順1と2を分けない。
4. IaC定義のテスト(`bun run infra:check`)が成功することを確かめる。
5. mainへマージすると、`staging`へのデプロイが資源を作ってからWorkerをデプロイする。`prod`は次のリリースで作られる。

- Queueのデッドレターを指定するときは、デッドレターのQueueも資源一覧に加え、送り元と同じ管轄で作る。
- 新しいホスト名は、資源一覧の`cloudflare.zoneName`で終わるものにする。割り当ては、Workerのデプロイの後の段階で作られる(「[2段階の適用](#2段階の適用)」)。

### 新しい種類の資源を追加する

1. 資源の種類のまとまりに合う子モジュールへ資源を加える。合うものが無ければ子モジュールを新設し、`versions.tf`の`required_providers`と`tests/<モジュール名>.tftest.hcl`を置く。
2. 資源一覧の型と解析(`<配布のスクリプト>/catalog/resource-catalog.ts`)へ項目を加え、両環境の資源一覧へ値を書く。
3. ルートモジュールの`main.tf`で、資源一覧の値を子モジュールへ渡す。Wrangler設定へ写す識別子があれば`resource_ids`へ加え、識別子の照合の対象(`<配布のスクリプト>/core/resource-ids.ts`)へも加える。
4. データを保持する資源、または秘密値を持つ資源には`lifecycle { prevent_destroy = true }`を付け、リポジトリの単体テストのデータを持つ資源の種類の一覧に加える(「[削除の防止](#削除の防止)」)。
5. CloudflareのAPIトークンの権限に、その資源の編集が含まれるかを確かめる。含まれなければ開発者がトークンを作り直す。

### 構成検査の規則

構成検査は、両環境の資源一覧・各アプリのWrangler設定・状態の保管先の設定に次の規則を掛け、食い違った項目と期待値を表で表示して失敗する。

| 規則 | 確かめること                                                                                                                                |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| C1   | Wrangler設定が参照するD1・R2・Queueの名前が、資源一覧にある                                                                                 |
| C2   | 資源一覧のD1・R2・Queueが、いずれかのWorkerから参照されている                                                                               |
| C3   | R2のバインディングの`jurisdiction`が、資源一覧の管轄と同じである                                                                            |
| C4   | Worker名とService Bindingsの接続先が、資源一覧のWorker名である                                                                              |
| C5   | `workers_dev`・`preview_urls`が`false`で、`routes`・`route`が無い                                                                           |
| C6   | 同じD1を使うWorkerの間で`database_id`が同じである(仮の値を除く)                                                                             |
| C7   | 状態の保管先の部分設定のバケット・キー・接続先が、資源一覧の`state`とアカウントIDに一致する(アカウントIDが仮の値の間は接続先の形だけを見る) |
| C8   | 配信不能イベント用のQueueを、メッセージを受信するアプリが受信している                                                                       |

## 状態の保管と暗号化

### 保管先

- 状態は、環境ごとに別々の`<状態のバケット>`へ、OpenTofuのS3互換のbackend(`backend "s3"`)で保存する。リポジトリとCIの成果物には置かない。
- `<状態のバケット>`は資源と同じアカウントに、管轄を付けずに作る。IaC定義が自分の状態を置く場所のため、開発者が手作業で作る。
- 接続用の鍵(R2のAPIトークンのアクセスキー)は、その環境の`<状態のバケット>`だけを読み書きできる範囲で発行する。
- `versions.tf`の`backend "s3"`は環境によらない設定だけを持ち、バケット・キー・接続先は`backends/<環境種別>.s3.hcl`の部分設定で与える。

```hcl
backend "s3" {
  region                      = "auto"
  use_lockfile                = true
  use_path_style              = true
  skip_credentials_validation = true
  skip_region_validation      = true
  skip_requesting_account_id  = true
  skip_metadata_api_check     = true
  skip_s3_checksum            = true
}
```

```hcl
bucket = "<状態のバケット>"
key    = "live/terraform.tfstate"
endpoints = {
  s3 = "https://<アカウントID>.r2.cloudflarestorage.com"
}
```

- `use_lockfile = true`で、OpenTofuは状態と同じキーに`.tflock`を条件付き書き込みで置き、同じ環境を更新する他の実行を失敗させる。計画と適用は`-lock-timeout=5m`で5分まで待つ。ロックが残ったときの解除は「[ロールバックと復旧](../operations/002-rollback-and-recovery.md)」に従う。
- 接続用の鍵は、backendの設定に書かず、S3 backendが読む環境変数`AWS_ACCESS_KEY_ID`・`AWS_SECRET_ACCESS_KEY`で渡す。
  - OpenTofuは、backendの設定に`sensitive`な変数を使うと`tofu init`で拒否する(`tofu validate`・`tofu test`では現れない)。
  - `sensitive`でない変数で渡すと、値が`.terraform/terraform.tfstate`と計画ファイルに保存される。

```sh
tofu -chdir=<IaCのディレクトリ>/live init -input=false -reconfigure -backend-config=../backends/<環境種別>.s3.hcl
```

### 暗号化

- 状態と計画ファイルを、OpenTofuの暗号化(`encryption`)で暗号化する。鍵はパスフレーズから`pbkdf2`で導き、`aes_gcm`で暗号化する。`state`と`plan`の両方に`enforced = true`を付け、鍵が無いときに暗号化していないデータを書かない。

```hcl
encryption {
  key_provider "pbkdf2" "state" {
    passphrase = var.state_passphrase
  }

  method "aes_gcm" "state" {
    keys = key_provider.pbkdf2.state
  }

  state {
    method   = method.aes_gcm.state
    enforced = true
  }

  plan {
    method   = method.aes_gcm.state
    enforced = true
  }
}
```

- パスフレーズは`sensitive = true`の変数`state_passphrase`で受け取り、値は環境変数`TF_VAR_state_passphrase`で渡す。`pbkdf2`のパスフレーズは16文字以上にする。
- 暗号化の設定が参照できるのは、`tofu init`の時点で解決できる変数とlocalsだけである。
- 接続用の鍵とパスフレーズは、Infisicalの各環境の`/ci/tofu`に置き、OpenTofuを起動するコマンドが取り出して子プロセスの環境変数にだけ渡す(「[シークレットの流れ](005-infrastructure-overview.md#シークレットの流れ)」)。
- 計画ファイル(`<環境種別>.tfplan`)はルートモジュールのディレクトリに書き出され、暗号化されたまま適用の後も残る。Gitの管理対象外にする。

## 一時的な資格情報

- Cloudflareのproviderが使うAPIトークンは、Infisicalの`ephemeral`リソースで実行時に受け取る。`ephemeral`の値は状態と計画ファイルに保存されない。`data`ソースで取得すると状態に残るため使わない。

```hcl
provider "infisical" {
  host = local.catalog.infisical.host
}

ephemeral "infisical_secret" "cloudflare_api_token" {
  name         = "CLOUDFLARE_API_TOKEN"
  env_slug     = var.environment
  workspace_id = local.catalog.infisical.projectId
  folder_path  = "/ci/cloudflare"
}

provider "cloudflare" {
  api_token = ephemeral.infisical_secret.cloudflare_api_token.value
}
```

- `infisical`のproviderには`auth`ブロックを書かず、認証の方法を環境変数で選ぶ。CIと開発者の操作で同じ定義を使うためである。
  - CIでは、`INFISICAL_AUTH_METHOD=oidc`・`INFISICAL_MACHINE_IDENTITY_ID`(その環境のデプロイの主体)・`INFISICAL_AUTH_JWT`(GitHubのOIDCトークン)を渡す。OIDCトークンは、計画と適用の直前に毎回取り直す。
  - 障害対応でCIの外から操作するときは、有効期限の短いUniversal Authの資格情報を`INFISICAL_AUTH_METHOD=universal`などで渡し、操作の後に失効させる(「[ロールバックと復旧](../operations/002-rollback-and-recovery.md)」)。
- 引数の名前(`workspace_id`など)と認証の環境変数の名前は、providerの版で変わり得る。固定した版のproviderのドキュメントで確かめる。

## providerの固定とロックファイル

- `required_version`とproviderの`version`は、範囲の指定(`~>`・`>=`)を使わず完全に固定する。

```hcl
terraform {
  required_version = "<OpenTofuの版>"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "<Cloudflare providerの版>"
    }
    infisical = {
      source  = "infisical/infisical"
      version = "<Infisical providerの版>"
    }
  }
}
```

- providerの版は、OpenTofu Registryで公開から2週間以上経ったものを選ぶ。Terraform Registryとは公開日が異なり得るため、OpenTofu Registryの日付で判断する。
- 子モジュールもproviderを宣言し、それぞれのディレクトリにロックファイルを置く。ロックファイルは、CIのランナーと開発コンテナの両方の環境のハッシュを含めて作る。

```sh
tofu -chdir=<モジュールのディレクトリ> providers lock -platform=linux_amd64 -platform=linux_arm64
```

- IaC定義の検査(`infra-check`)の初期化は`-lockfile=readonly`で行い、ロックファイルを書き換えない。ロックファイルと`required_providers`が食い違えば失敗する。
- デプロイの初期化(`init -input=false -reconfigure -backend-config=...`)は`-lockfile=readonly`を付けない。ロックファイルに記録した版を選び、導入するproviderをロックファイルに記録したハッシュと照合することに頼る。そのため、ロックファイルにはCIのランナーの環境(`linux_amd64`)のハッシュを必ず含める。
- OpenTofuの版は、開発コンテナのイメージ定義・CIの準備のアクション・`required_version`の3箇所で同じにする。ワークフローの検査が食い違いを違反にする(「[版の固定と同期](007-ci-cd-pipelines.md#版の固定と同期)」)。
- providerの版を上げるときは、ルートモジュールと全子モジュールの`required_providers`を同じ変更で改め、各ディレクトリでロックファイルを作り直し、`bun run infra:check`を通す。

## 2段階の適用

デプロイでは、計画と適用を2回に分けて行う。

| 段階         | 対象                                                    | 時期                               |
| ------------ | ------------------------------------------------------- | ---------------------------------- |
| `foundation` | ホスト名の割り当て(`module.worker_routing`)以外の全資源 | 識別子の照合とWorkerのデプロイの前 |
| `routing`    | ホスト名の割り当てを含む全資源                          | 全Workerのデプロイの後             |

- Workersのカスタムドメインは、割り当て先のWorkerが存在しないと作れない。Workerはデプロイパイプラインの`deploy-*`の段階で作られるため、ホスト名の割り当てを最初の適用から外す。
- `foundation`は`-exclude=module.worker_routing`を付けて計画する。`-exclude`は指定した資源と、それに依存する資源を計画から外す。
- 各段階は、計画を計画ファイルへ書き出し、`tofu show -json`で読んだ計画を資源のアドレスと操作の種類だけに要約して表示してから、その計画ファイルを適用する。要約に削除(`delete`)か作り直し(`replace`)があれば、先頭に警告を付ける。
- 既存のCNAMEレコードがあるホスト名には、カスタムドメインを作れない。新しいホスト名を加える前に、そのホスト名のDNSレコードが無いことを確かめる。

```sh
tofu -chdir=<IaCのディレクトリ>/live plan -input=false -no-color -lock-timeout=5m -var environment=<環境種別> -exclude=module.worker_routing -out=<環境種別>.tfplan
tofu -chdir=<IaCのディレクトリ>/live apply -input=false -no-color -lock-timeout=5m <環境種別>.tfplan
```

## 削除の防止

- データを保持する資源(D1・R2)と、秘密値を持つ資源(Turnstileのウィジェット)には`lifecycle { prevent_destroy = true }`を付ける。削除または作り直しを伴う変更は計画の時点で失敗し、既存の資源が残る。
  - Turnstileのウィジェットを作り直すと秘密鍵が変わり、Infisicalへの再登録が要るためである。
- Queueには付けない。メッセージは一時的であり、受信するWorkerが付いたQueueはCloudflareが削除を拒む。
- 管轄・名前など、変えると作り直しになる属性を変える計画も、`prevent_destroy`で失敗する(意図どおり)。
- `prevent_destroy`は計画のテストで確かめられない。リポジトリの単体テストがHCLを読み、データを持つ資源の種類(D1・R2・Turnstile)の全ブロックに`prevent_destroy = true`があることと、Queueに無いことを確かめる。データを持つ資源の種類を加えるときは、テストの一覧にも加える。
- 資源を意図して削除するときは、開発者が`prevent_destroy`を外す変更と削除する変更を分け、データの退避を確かめてから適用する。

## テスト

各モジュールの`tests/*.tftest.hcl`で、モックのproviderと`command = plan`で計画だけを行い、属性の値を確かめる。資源を作らず、資格情報も要らない。

```hcl
mock_provider "cloudflare" {}

variables {
  account_id   = "00000000000000000000000000000000"
  jurisdiction = "<管轄>"
  queues = {
    main = { name = "app-main-staging" }
  }
}

run "places_every_queue_in_given_jurisdiction" {
  command = plan

  assert {
    condition     = alltrue([for q in cloudflare_queue.this : q.jurisdiction == var.jurisdiction])
    error_message = "資源一覧の管轄で作られていないQueueがある"
  }
}
```

| テスト                      | 確かめること                                                                                                                                                                     |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage.tftest.hcl`        | mapの項目数どおりの資源、全資源の管轄、D1の読み取りレプリカの無効とロケーションヒント無し、R2の保存クラス、項目の追加で資源が増える、不正な管轄の拒否                            |
| `messaging.tftest.hcl`      | mapの項目数どおりのQueue、全Queueの管轄、項目の追加でQueueが増える、不正な管轄の拒否                                                                                             |
| `edge-services.tftest.hcl`  | Turnstileの対象のホスト名と非表示の種類、Web Analyticsの対象のホスト名と自動挿入の無効、送信ドメインのプレビューの無効、非表示以外の種類の拒否、`placement`の値                  |
| `worker-routing.tftest.hcl` | ホスト名とWorker名の対応、項目の追加でカスタムドメインが増える                                                                                                                   |
| `live.tftest.hcl`           | 両環境の資源一覧の値が各モジュールへ渡る。アカウント・ゾーン・管轄・アクセス解析のホスト名・送信ドメインは各モジュールの`placement`で確かめる(`mock_provider "infisical"`も使う) |

- 子モジュールのテストの変数の名前・ホスト名は、`app-`で始まる名前や`.example`のドメインなど、実際の資源と区別できる値にする。ルートモジュールのテストは実際の資源一覧を読む。
- 子モジュールのテストの`placement`の確認では、アカウントIDとゾーンIDに互いに異なる値を渡し、取り違えを検出できるようにする。資源一覧のアカウントIDとゾーンIDが同じ仮の値の間は、ルートモジュールのテストでは両者の取り違えを区別できない。
- ルートモジュールのテストはbackendの設定を使わないため、状態の保管先の鍵を要らない。モックのproviderは`ephemeral`リソースにも対応する。
- `bun run infra:check`(`bun <配布のスクリプト>/cli.ts infra-check`)が、`tofu fmt -check -recursive <IaCのディレクトリ>`の後、`live`と各子モジュール(名前順)で`init -backend=false -lockfile=readonly -input=false`→`validate`→(テストがあれば)`test`を、最初の失敗まで実行する。整形は`bun run infra:fmt`で直す。
- 計画のテストで確かめられないHCLの記述(`prevent_destroy`、R2に`location`が無いこと、カスタムドメインに非推奨の`environment`が無いこと、出力に`secret`が無いこと、resourceブロックの外でTurnstileの秘密鍵と資源全体を参照しないこと)は、リポジトリの単体テストがHCLを読んで確かめる。対象は`<IaCのディレクトリ>`配下の全`.tf`で、`tofu init`が取得した写し(`.terraform/`配下)を除く。
- テストの書き方と実行の位置づけは「[IaC定義のテスト](../testing/001-test-strategy.md#iac定義のテスト)」に従う。

## 管轄の注意

D1・R2・Queuesは、資源一覧の`jurisdiction`(`<管轄>`)で作る。管轄を付けた資源には次の制約がある。

- 管轄は作成後に変えられない。値を変えると作り直しになり、`prevent_destroy`の資源では計画が失敗する。
- R2
  - Workersから管轄付きのバケットを使うには、Wrangler設定の`r2_buckets`の各要素に、資源と同じ`jurisdiction`を書く。構成検査(規則C3)が、デプロイ先の環境の全バインディングに書かれていることを確かめる。ローカル環境の設定には書かない。
  - S3互換のAPIで接続するときの接続先は`https://<アカウントID>.<管轄>.r2.cloudflarestorage.com`である。管轄の接続先からは、他の管轄や管轄の無いバケットに届かない。状態のバケットは管轄を付けないため、`https://<アカウントID>.r2.cloudflarestorage.com`で接続する。
  - 管轄付きのバケットでは、Data Access Logs(オブジェクトの操作のログ)を使えない。Logpushの出力先にも直接は指定できない。
  - `location`(地域のヒント)は管轄と組み合わせず、指定しない。
- D1
  - 管轄付きのデータベースにも、Workersは世界中から接続できる。Wrangler設定に管轄の指定は要らない。
  - 管轄を指定すると`primary_location_hint`は無視されるため、指定しない。
- Queues
  - 管轄付きのQueueにも、Workersはどこからでも送受信できる。Wrangler設定に管轄の指定は無い。
  - デッドレターのQueueは、送り元と同じ管轄にしなければならない。存在しない名前をデッドレターに指定すると、送り元と同じ管轄で自動作成されるが、資源一覧に無い資源になるため、必ず資源一覧に加えて先に作る。
  - Email Sendingの配信不能イベントが管轄付きのQueueへ届くことは、最初のデプロイで確かめる。
- Durable Objectsの管轄は、Wrangler設定やOpenTofuでなく、コードで名前空間に指定するものである。指定しない場合、保存場所は保証されない。
- 管轄を指定できない資源(Turnstile・Web Analytics・Email Sending)とWorkerの実行・エッジのキャッシュ・ログは、所在を限定しない。

## 既存の資源の取り込み

IaC定義の導入より前に手作業で作った資源は、`import`ブロックで状態へ取り込む。

```hcl
import {
  to = module.storage.cloudflare_r2_bucket.this["<キー>"]
  id = "<アカウントID>/<バケット名>/<管轄>"
}
```

- `import`ブロックは、ルートモジュールの`main.tf`に一時的に置く。資源一覧へ同じ名前の項目を加え、デプロイパイプラインの適用で取り込む。取り込んだ後の変更で`import`ブロックを消す。
- 取り込みの識別子の形は資源の種類ごとに異なる。固定した版のproviderのドキュメントの各資源の「Import」の節で確かめる。
- 取り込みは、変更が無ければ計画の要約に件数としてだけ現れる。取り込んだ資源に変更(`update`・`replace`)が出ないことを、計画の要約で確かめてから適用する。
- 管轄の無いD1・R2・Queueは、管轄を変えられないため取り込まない。開発者がデータを退避して削除してから、最初の適用で管轄付きで作り直す。
  - Queueを作り直すときは、そのQueueへの配信不能イベントの購読も削除する。購読はOpenTofuの管理外で、次のデプロイが作り直す。
  - 購読は取り込む必要が無い。既にあれば、デプロイパイプラインが内容を比べて同じなら何もしない。
- 取り込み・適用・状態の操作(`tofu import`・`tofu state rm`など)は、デプロイパイプラインか開発者が行う。
