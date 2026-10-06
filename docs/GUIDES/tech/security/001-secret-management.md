# シークレットの管理

秘匿すべき環境シークレットの保管場所と実行時の注入方法、Cloudflare WorkersのコードとIaCからシークレットを参照する設定、及びコミット前のシークレット検出の注意点を定める。

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
- `secrets`を定義すると、`wrangler dev`・`vite dev`は`secrets.required`に挙げたキーだけを`process.env`などから読み込み、`env`に渡す。挙げたキーが見つからなければ、足りないキーの名前を警告する。
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

OpenTofuで使うシークレットもInfisicalで一元管理し、`*.tfvars`・`*.tfstate`などのファイルに書き出さない。OpenTofuからは、`infisical`プロバイダの`ephemeral`リソースをOIDC認証で呼び出して取得する。

```hcl
provider "infisical" {
  auth = {
    oidc = {
      identity_id = "<マシンアイデンティティのID>"
    }
  }
}

ephemeral "infisical_secret" "<リソース名>" {
  name         = "<シークレットのキー>"
  env_slug     = "<環境種別>"
  workspace_id = "<InfisicalのプロジェクトのID>"
  folder_path  = "/"
}
```

- `ephemeral`リソースで取得した値は、stateファイル(`*.tfstate`)に保存されない。`data`ソースで取得すると、値がstateファイルに残る。
- `ephemeral`リソースは、OpenTofu 1.11以降で使える。
- OIDC認証では、CIなどの実行環境が発行する短期のトークンでInfisicalのマシンアイデンティティとして認証する。Infisicalの長期の認証情報をCIに保存せずに済む。
- 引数の名前(`workspace_id`など)はプロバイダの版で変わり得るため、導入する版のプロバイダのドキュメントで確かめる。
- 参照: Infisicalの「[OpenTofu Secrets Management with Infisical](https://infisical.com/blog/opentofu-secrets-management-with-infisical)」

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
