# シークレットの管理

秘匿すべき環境シークレットの保管場所と実行時の注入方法、Cloudflare WorkersのコードとIaCからシークレットを参照する設定、デプロイ時のWorkerのシークレットの反映、及びコミット前のシークレット検出の注意点を定める。

## 前提と用語

シークレット管理サービスにInfisical、実行環境にCloudflare Workers(Wrangler・`@cloudflare/vite-plugin`)、IaCにOpenTofuを使う構成を前提とする。

| 用語                       | 意味                                                                                                            |
| -------------------------- | --------------------------------------------------------------------------------------------------------------- |
| シークレット               | APIキー・トークン・パスワードなど、秘匿すべき環境シークレット                                                   |
| シークレットでない環境変数 | 公開されても問題の無い設定値(接続先のURLなど)                                                                   |
| Wrangler設定               | 各アプリの`wrangler.jsonc`(または`wrangler.toml`)。ルートの設定と、デプロイ先ごとの`env.<環境種別>`の設定を持つ |
| `<環境種別>`               | Infisical・Wranglerで環境を選ぶ名前。「[環境種別](../infra/002-environments.md)」に従う                         |
| `<シークレットのキー>`     | シークレットの名前。Infisicalでの名前と、コードで参照する`env.<シークレットのキー>`の名前を一致させる           |

## シークレットの注入

- 秘匿すべきシークレットは、すべてInfisicalで管理する。`.env`・`.dev.vars`などのファイルにシークレットを書かず、そのようなファイルを作らない。
- `bun run dev`など、シークレットを使うコマンドは、毎回`infisical run`で実行してシークレットを注入する。`--env`にはInfisicalの環境種別を指定する(「[シークレット管理の環境種別](../infra/002-environments.md#シークレット管理の環境種別)」)。

```sh
infisical run --env <環境種別> -- bun run dev
```

- `infisical run`は、指定した環境種別のシークレットを環境変数として`--`の後のコマンドへ渡す。プロジェクトで決めた共通のオプションがあれば、`infisical`の直後に付ける。
- CIでは、開発者のログインでなく、OIDCで認証する機械の主体で取り出して注入する(「[CIのシークレットとリポジトリ保護](003-ci-secrets-and-repository-protection.md)」)。

### Workersのコードから参照するシークレット

`wrangler dev`や、`@cloudflare/vite-plugin`による`vite dev`では、Infisicalから注入されたシークレットは`process.env`に入る。Workersのコードで`env.<シークレットのキー>`として使うには、Wrangler設定のルートと`env.<環境種別>.secrets.required`の両方に、そのキーを指定する必要がある。

```jsonc
{
  "secrets": { "required": ["<シークレットのキー>"] },
  "env": {
    "staging": { "secrets": { "required": ["<シークレットのキー>"] } },
    "prod": { "secrets": { "required": ["<シークレットのキー>"] } },
  },
}
```

- `secrets`はWranglerの継承されないキー(non-inheritable keys)であり、ルートの指定は`env.<環境種別>`へ引き継がれない。ルートの指定はローカル環境(環境種別を指定しない`wrangler dev`・`vite dev`)で使われる。
- `secrets`を定義すると、`wrangler dev`・`vite dev`は`secrets.required`に挙げたキーだけを`process.env`などから読み込み、`env`に渡す。挙げたキーが見つからなければ、足りないキーの名前を警告する。`vite preview`も、ビルド結果のWrangler設定に残る`secrets.required`のキーを同じく`process.env`から読み込むため、ビルド後のプレビューもシークレットの注入の下で起動する。`process.env`に`vars`と同じ名前のキーがあると、その値が`vars`の値に優先して渡るため、注入する値やシェルの変数に`vars`と同じ名前を使わない。
- `@cloudflare/vite-plugin`のビルドは、`secrets.required`のキーの値が`process.env`にあると、その値をローカル用のシークレットのファイル(`.dev.vars`)としてビルド結果へ書き出す。シークレットの注入の下でビルドしてもファイルが残らないよう、ビルドの設定でこのファイルを出力から除く(「[ビルド結果のシークレットのファイル](../frontend/002-tanstack-start-on-workers.md#ビルド結果のシークレットのファイル)」)。
- `wrangler deploy`・`wrangler versions upload`は、`secrets.required`のキーがすべてデプロイ先のWorkerに設定済みであることを確かめ、足りなければ失敗する。
- `wrangler types`は、`secrets.required`からシークレットの型を生成する。
- 参照: Cloudflare Docsの「[Configuration](https://developers.cloudflare.com/workers/wrangler/configuration/#secrets-configuration-property)」

### シークレットでない環境変数

シークレットでない環境変数をコードで`env.<キー>`として使うには、Wrangler設定のルートと`env.<環境種別>.vars`の両方に、その環境変数を指定する必要がある。

```jsonc
{
  "vars": { "<キー>": "<ローカル環境の値>" },
  "env": {
    "staging": { "vars": { "<キー>": "<デプロイ先検証環境の値>" } },
    "prod": { "vars": { "<キー>": "<本番環境の値>" } },
  },
}
```

- `vars`も継承されないキーであり、ルートの指定は`env.<環境種別>`へ引き継がれない。
- `vars`の値はWrangler設定に平文で残るため、シークレットを`vars`に書かない。
- 参照: Cloudflare Docsの「[Environment variables](https://developers.cloudflare.com/workers/configuration/environment-variables/)」

### IaCで使うシークレット

OpenTofuとデプロイパイプラインで使うシークレットもInfisicalで一元管理し、`*.tfvars`・`*.tfstate`などのファイルに書き出さない。値は、必要になる時点に応じて次の3つの経路で受け取る。

| 値                                                                                           | 経路                                                                                  |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| OpenTofuのproviderの資格情報(クラウドのAPIトークンなど)                                      | OpenTofuが`infisical`プロバイダの`ephemeral`リソースで実行時に取得する                |
| コマンドの起動の前に要る値(状態の保管先の鍵・状態の暗号化のパスフレーズ・Wranglerの資格情報) | Infisical CLIで取り出し、そのコマンドだけの環境変数として注入する                     |
| Workerの実行時のシークレット                                                                 | デプロイのコマンドが取り出し、`wrangler deploy`の標準入力でWorkerの版と同時に反映する |

CIでの主体・フォルダの分け方とログの扱いは「[CIのシークレットとリポジトリ保護](003-ci-secrets-and-repository-protection.md)」に従う。

#### providerの資格情報

```hcl
provider "infisical" {
  host = "<Infisicalのホスト>"
}

ephemeral "infisical_secret" "<リソース名>" {
  name         = "<シークレットのキー>"
  env_slug     = "<環境種別>"
  workspace_id = "<InfisicalのプロジェクトのID>"
  folder_path  = "<フォルダ>"
}

provider "cloudflare" {
  api_token = ephemeral.infisical_secret.<リソース名>.value
}
```

- `ephemeral`リソースで取得した値は、stateファイル(`*.tfstate`)と計画ファイルに保存されない。`data`ソースで取得すると、値がstateファイルに残る。
- `ephemeral`リソースは、OpenTofu 1.11以降で使える。
- `infisical`プロバイダには`auth`ブロックを書かず、認証の方法を環境変数で選ぶ。CIと開発者の操作で同じ定義を使うためである。

| 実行する場所                           | 環境変数                                                                                                                                                          |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CI(OIDC認証)                           | `INFISICAL_AUTH_METHOD=oidc`・`INFISICAL_MACHINE_IDENTITY_ID=<マシンアイデンティティのID>`・`INFISICAL_AUTH_JWT=<CIが発行したOIDCトークン>`                       |
| CIの外での一時的な操作(Universal Auth) | `INFISICAL_AUTH_METHOD=universal`・`INFISICAL_UNIVERSAL_AUTH_CLIENT_ID`・`INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET`(有効期限を短くして発行し、操作の後に失効させる) |

- OIDC認証では、CIなどの実行環境が発行する短期のトークンでInfisicalのマシンアイデンティティとして認証する。Infisicalの長期の認証情報をCIに保存せずに済む。OIDCトークンは短期のため、計画と適用の直前に毎回取り直して渡す。
- CIの外での操作の手順は「[CIの外での一時的な操作](../operations/002-rollback-and-recovery.md#ciの外での一時的な操作)」に従う。
- 引数の名前(`workspace_id`など)と認証の環境変数の名前はプロバイダの版で変わり得るため、導入する版のプロバイダのドキュメントで確かめる。
- 参照: Infisicalの「[OpenTofu Secrets Management with Infisical](https://infisical.com/blog/opentofu-secrets-management-with-infisical)」

#### 起動の前に要る値

状態の保管先(S3互換のbackend)の鍵と状態の暗号化のパスフレーズは`tofu init`の時点で要り、Wranglerの資格情報は`wrangler`の起動時に環境変数から読まれる。いずれも`ephemeral`リソースでは渡せないため、Infisical CLIで取り出してそのコマンドだけの環境変数として注入する。

```sh
infisical run --env <環境種別> --path <状態の保管先の鍵を置くフォルダ> -- tofu init -input=false -backend-config=<状態の保管先の部分設定>
```

| 値                         | 渡す環境変数                                              |
| -------------------------- | --------------------------------------------------------- |
| 状態の保管先の鍵           | backend専用の`AWS_ACCESS_KEY_ID`・`AWS_SECRET_ACCESS_KEY` |
| 状態の暗号化のパスフレーズ | `sensitive`な変数への`TF_VAR_<変数名>`                    |
| CloudflareのAPIトークン    | `CLOUDFLARE_API_TOKEN`(Wranglerが読む)                    |

- backendの設定に、鍵を変数で書かない。backendの設定は作業ディレクトリ(`.terraform/`)と計画ファイルに保存されるため、OpenTofuは`sensitive`な変数を使ったbackendの設定を`tofu init`で拒否し、`sensitive`でなければ鍵が平文で残る。状態の暗号化の設定は`sensitive`な変数を受け付ける。
- 起動の前に要る値は、Workerのシークレットと別のフォルダに置き、使うコマンドにだけ渡す。Workerや他のコマンドへ渡らないようにするためである。
- CIでは、配布のスクリプトのコマンドがデプロイの主体で取り出してマスクし、子プロセスの環境変数として渡す。開発者のシェルの環境変数として常設しない。

#### デプロイ時のWorkerのシークレット

デプロイ先のWorkerのシークレットは`wrangler secret put`で個別に登録せず、デプロイのたびにInfisicalから取り出して、コードと同じ版で反映する。

```sh
bunx wrangler deploy --env <環境種別> --secrets-file /dev/stdin
```

- `@cloudflare/vite-plugin`でビルドするアプリは、`CLOUDFLARE_ENV=<環境種別>`でビルドした後に`--env`を付けずにデプロイする(「[デプロイの段階](../infra/007-ci-cd-pipelines.md#デプロイの段階)」)。
- 渡すキーは、そのWorkerのWrangler設定の`env.<環境種別>.secrets.required`(必須)と、配布のスクリプトの任意のシークレットの一覧に挙げたキー(任意)に限る。宣言していない値は、Infisicalにあっても渡さない。
- 取り出した値は、マスクしてからJSONにし、標準入力だけで渡す。引数・環境変数・ファイルに置かない。
- `--secrets-file`で渡したシークレットとコードは同じ版として反映されるため、新しいコードが新しいシークレットの無いまま動く時間ができない。`wrangler secret put`で登録すると、デプロイと別の版ができ、Infisicalの値・版のタグと食い違う。
- 必須のキーが欠けていれば、デプロイの前にキーの名前だけを示して止める(`wrangler deploy`も`secrets.required`の欠落で失敗する)。
- `--secrets-file`に無いシークレットは前の版から引き継がれ、デプロイでは消えない。消す手順は「[シークレットの追加と削除](../operations/001-deployment.md#シークレットの追加と削除)」に従う。
- Workerごとに異なる値の選び方は「[Workerのシークレットの選別](../infra/007-ci-cd-pipelines.md#workerのシークレットの選別)」に従う。

## シークレットの検出

Gitのpre-commitフックでBetterleaksを実行してステージした変更からシークレットを検出し、CIでも別にシークレットを検出する構成での注意点を定める。次の挙動はBetterleaks 1.9.0で確かめた。

### 誤検知の登録

- 誤検知は、リポジトリのルートの許可リスト`.betterleaksignore`にFingerprintを1行に1つ書き、検出の対象から外す。
- コミット前の検査(`betterleaks git --pre-commit`)のFingerprintは`<ファイルのパス>:<検出規則>:<行番号>`の形式であり、検出結果に表示されるファイルのパス・検出規則・行番号から組み立てる。`--verbose`の出力にはFingerprintそのものは表示されない。
- 行番号が変わるとFingerprintも変わるため、該当する行が移動したら登録し直す。
- `.betterleaksignore`では、行頭の`#`で始まる行だけがコメントになる。Fingerprintの行末にコメントを付けると、その行はFingerprintとして一致しなくなる。誤検知と判断した理由は、コミットメッセージに残す。

```text
# 誤検知のFingerprintを1行に1つ書く(行末にコメントを付けない)
<ファイルのパス>:<検出規則>:<行番号>
```

### フックを通らないコミット

- `git revert`・`git cherry-pick`は、`--no-edit`でも編集を経ても、pre-commit・commit-msgフックを実行しない(Gitの仕様)。これらで作ったコミットはコミット前のシークレット検出を通らないため、CIでのシークレット検出で補う。

### 調査時の注意

- `GIT_TRACE=1`でGitのトレースを画面(標準エラー出力)に出しながらコミットすると、Betterleaksが走査の失敗としてコミットを拒否する(安全側に止まる)。トレースが必要な場合は、`GIT_TRACE=<ファイルの絶対パス>`としてファイルへ出す。
- Betterleaksの`--log-level debug`は、`--redact`を付けても検出した値を表示する。誤検知の調査に使わない。
