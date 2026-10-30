# Research & Design Decisions

## Summary

- **Feature**: `infra-delivery`
- **Discovery Scope**: Complex Integration(`apps/infra`と`.github`はリポジトリに無い。上流の5spec(dev-tooling・backend-platform・api-gateway・email-delivery・frontend-platform)は実装を完了している(2026-10-29に確認。照合の結果は「実装前のギャップ分析(2026-10-29)」)。Cloudflare・Infisical・GitHubの3つの外部サービスを結ぶ)
- **Key Findings**:
  - Cloudflare provider 5.27.0(OpenTofu Registryで2026-10-03公開、本日時点で15日経過)の`cloudflare_d1_database`・`cloudflare_r2_bucket`・`cloudflare_queue`は、いずれも`jurisdiction`に`"us"`を受け付ける。開発者が選んだ米国の管轄(Q3)は、代替手段を使わずにOpenTofuだけで実現できる。5.28.0(2026-10-13公開)は2週間に満たないため採らない。
  - 米国の管轄のR2バケットは、Workersのバインディングに`jurisdiction`の指定が要り、S3 APIの接続先が`https://<ACCOUNT_ID>.us.r2.cloudflarestorage.com`になり、Data Access Logsを使えない。Queuesの管轄はバインディングに指定が要らないが、デッドレターキューは送り元と同じ管轄でなければならない。email-deliveryのメールイベント用Queueのデッドレターは本体のデッドレターなので、Queueはすべて同じ管轄にそろえる必要がある。
  - InfisicalのFreeプランは、主体(人間と機械の合計)5つ・プロジェクト数無制限・環境3つで、独自のロール(環境ごとの権限)を使えない。1つのプロジェクトのままでは、CIの機械の主体がすべての環境のシークレットを読める。開発者はこのリスクを受け入れ、既存の1つのプロジェクトのdev・staging・prodの環境を使うと決めた(K3)。主体は4つ(開発者・検査・stagingのデプロイ・prodのデプロイ)で、上限5に収まる。
  - `GITHUB_TOKEN`で作ったプルリクエストは新しいワークフローを起動しない。main→prodのプルリクエストの必須チェックは、同じコミットに対するmainへのpushの検査結果で満たす。GitHub AppとBotはコードオーナーになれないため、コードオーナーの承認を必須にすれば、ワークフローによる承認ではprodへのマージの条件を満たせない(Q5)。
  - Workersのカスタムドメインは、Workerが存在しないと作れない。OpenTofu 1.13の`-exclude`で、1回目の適用からカスタムドメインを外し、Workerのデプロイの後に2回目の適用で作る。Wrangler設定に`routes`を書かず`workers_dev: false`にすれば、Wranglerは外部で作ったカスタムドメインを変更しない。
  - `.claude/settings.json`は`*wrangler deploy*`を拒否するため、AIエージェントは`wrangler deploy --dry-run`もローカルで実行できない。デプロイの予行はCIの検査で行い、AIエージェントが確かめられるのは`tofu fmt`・`tofu validate`・`tofu test`(モックのプロバイダ)と、TypeScriptのスクリプトの単体テストまでとする。

## 要件フェーズ前の確認事項(2026-10-18)

開発者の判断を要する論点を、要件の作成前に一括で確認した。決定は`requirements.md`の「要件フェーズでの決定事項」にも記録する。

| #   | 論点                                                                                     | 根拠                                                                                                                                                     | 回答(2026-10-18)                                                                                                                                                                                                                                                                                                                                                                   |
| --- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | 暗号化したOpenTofuのstateとロックの保管先                                                | brief Desired Outcome・`.gitignore`・Claude設定の`*.tfstate*`拒否・roadmapの実現性チェック(Turnstileの`secret`がstateに平文で入る)・R2の条件付き書き込み | 推奨案。同じCloudflareアカウントにstate専用のR2バケットを開発者が手作業で作り、S3互換backendのロックファイル(`use_lockfile`)で排他し、アクセスキーはInfisicalから注入する                                                                                                                                                                                                          |
| Q2  | 他の用途と共有している可能性があるゾーン`kurachiweb.com`の、ゾーン全体に効くルールの管理 | brief Desired Outcome・DNSのSOA・要件定義書2.4(ゾーンはFreeプラン)・tech-stack.mdのWAF・FR-RLMIT-009                                                     | 推奨案。OpenTofuは本プロジェクトのホスト名に閉じた資源(カスタムドメイン、送信ドメインとそのDNS、Turnstile、Web Analytics)だけを扱い、ゾーン全体の防御は無償マネージドルールセット、レート制限はアプリ側に任せる。briefの「WAF・レート制限ルール」はこの範囲に読み替える                                                                                                            |
| Q3  | D1とR2の配置場所(ロケーションヒントまたは管轄)                                           | DR-012・`legal/001-compliance-policy.md`「データの保存場所」・NFR-PERF-007・D1とR2の配置は作成後に変えられない                                           | 推奨案(`apac`のロケーションヒント)ではなく「米国の管轄で保証」を採用。`jurisdiction = "us"`で米国内での保存を保証し、プライバシーポリシー骨子・準拠方針の保存場所の記述に反映する                                                                                                                                                                                                  |
| Q4  | 検査フェーズで注入するInfisicalの環境種別と、E2Eテストの実行先                           | tech-stack.mdのCI/CD・backend-platformとfrontend-platformのローカル設定(テスト用の値)・frontend-platform要件12.7・email-deliveryのresearch               | 推奨案。ローカルと同じ`dev`を注入し、ランナー上でapi・event・client・admin・Mailpitをローカルモードで起動してE2Eを実行する。stagingへのデプロイの後に、スモークテストをstagingのURLへ実行する。tech-stack.mdの記載を改める                                                                                                                                                         |
| Q5  | 1人で開発する体制での「prodへの人間の承認」の実現方法                                    | CLAUDE.mdのGit運用方針・既存のルールセット(ID 22452803)・過去のPRの作成者・Claude設定の`gh pr merge`拒否・公開リポジトリ                                 | 推奨案(Environmentの必須レビュアー)ではなく「bot作成のPRを開発者が承認」を採用。main→prodのPRをGitHub Actionsが作り、開発者が承認してマージする(承認数1)。リポジトリ設定「GitHub ActionsにPRの作成と承認を許可」が必要になり、ワークフローからの承認も通るようになるため、ワークフローによる承認では要件を満たせない仕組みを設計で検討し、残るリスクを本書に記録する(開発者の指示) |
| Q6  | prod環境の資源をいつ作り、prodのデプロイ経路をどこまで確かめるか                         | roadmap Overview・brief Out・backend-platformとfrontend-platformの仮の値・カスタムドメインの前提・frontend-platform Q3                                   | 推奨案(資源だけ本specで作る)ではなく「リリース時にまとめて作る」を採用。本specはprodの定義と予行(`tofu plan`・`wrangler deploy --dry-run`等)までとし、prodの資源の作成と識別子の反映はlaunch-readinessが行う。launch-readinessへの引き継ぎ事項としてrequirementsのAdjacent expectationsに明記する                                                                                  |
| Q7  | providerで管理できない設定(配信不能イベントの購読)と、Turnstileの秘密鍵の登録の自動化    | SW-015・email-delivery・provider 5.28.0に購読の資源が無い・backend-platformの`TURNSTILE_SECRET_KEY`・Claude設定の`infisical secrets set`拒否             | 推奨案。デプロイワークフローが毎回購読の有無を確かめ、無ければWranglerで作る。Turnstileの秘密鍵は開発者が初回にInfisicalへ登録し、CIのInfisicalの権限は読み取りだけにする                                                                                                                                                                                                          |

### 提示した選択肢(記録)

- Q1: R2の専用バケット(採用) / AWSのS3とOIDC / 暗号化したstateをGitにコミット
- Q2: ホスト名単位だけ管理(採用) / ゾーンのルールもOpenTofuで管理 / 手作業で設定し文書化
- Q3: アジア太平洋(`apac`のロケーションヒント) / 北米西部(`wnam`) / 米国の管轄で保証(採用) / 指定しない
- Q4: devを注入しランナー内で起動(採用) / stagingを注入しランナー内で起動 / 検査ではE2Eを省きstagingで実行
- Q5: デプロイジョブの承認(Environmentの必須レビュアー) / bot作成のPRを開発者が承認(採用) / 2人目の人間が承認
- Q6: 資源だけ本specで作る / リリース時にまとめて作る(採用) / 本specでprodへ一度デプロイする
- Q7: 購読だけ自動化(採用) / 両方を自動化(`infisical_secret`リソースで書き込む) / 両方を手作業 / 汎用REST APIのproviderで購読も管理

### 確認済みのため質問しない事項

- Workerスクリプトの管理: roadmapの実現性チェックでWranglerに任せると決まっている。`cloudflare_workers_script`・`cloudflare_queue_consumer`・cronはOpenTofuで定義しない(consumerとcronはbackend-platformのWrangler設定が持つ)。
- providerの版: roadmapで完全固定と決まっている。版は設計で決める(Research Log「Cloudflare providerの版と管轄の対応」)。
- D1の`read_replication`: `mode = "disabled"`を明示する。backend-platformの`createDatabase`は`env.DB`を直接使い、Sessions APIを使わないため、レプリカを有効にしても効果が無い。
- stateの暗号化・パスフレーズのInfisicalからの注入・`ephemeral`リソースとOIDC認証: briefとroadmap、`security/001-secret-management.md`で決定済み。
- 環境種別: `infra/002-environments.md`で決定済み。staging・prodは同一のCloudflareアカウントを使う。Infisicalは既存の1つのプロジェクトのdev・staging・prodの環境を使う(K3)。
- 資源の名前・Worker名・Queue名・`namespace_id`・送信ドメイン名: backend-platform・email-delivery・frontend-platformのSupporting Referencesと、email-delivery Q6で決定済み。
- 識別子の反映方法: 実際の値をWrangler設定へ書き込んでコミットする。backend-platformとfrontend-platformが「infra-deliveryが置き換える」と決めている。prodの値はQ6によりlaunch-readinessが反映する。
- Turnstileのウィジェット: 環境ごとに1つとし、client・adminの両ホスト名を登録する。モードは非表示の`invisible`とする(改訂2。frontend-platformの`TurnstileWidget`が非表示で描くため)。
- stagingの公開: READMEにstagingのURLが載っており、frontend-platform Q3もstagingで疎通確認の画面を公開すると決めているため、アクセス制限は掛けない。
- デプロイの順序: マイグレーション→APIサーバー→フロントエンドの順。api-gatewayとfrontend-platformで決定済み。
- 直前のリリースの特定: api-gateway Q3で「新しいリソースを使わない」と決まっている。手段は設計で決める(Workerの版のタグ)。
- ブランチ保護: briefで、コード化せずに文書化すると決まっている。既存のルールセットへ必須チェックなどを足す手順を書く。
- ロールバック: NFR-AVAIL-006が求めるのは「ロールバックできること」である。`wrangler rollback`を逆順(フロントエンド→api→event)で実行する手順を文書化し、CIでは自動ロールバックしない。Durable Objectsのライフサイクルの変更をまたぐロールバックはできない。D1は巻き戻さない(NFR-AVAIL-009のExpand/Contract)。
- D1のバックアップ: `db/002-d1-constraints.md`でTime Travelと決定済み。復元の実行は開発者が行う(AIにはdenyされている)。
- CIの実行環境: GitHubのホステッドランナーで、各ツールの公式のsetupアクションをコミットSHAで固定し、版はDockerfileとそろえる。採用したアクションはtech-stack.mdへ追記する。
- 監視・アラート・Sentryのプロジェクトと値: launch-readinessが担当する。
- フォークからのPR: リポジトリは公開のため、フォークのPRにはシークレットもOIDCのトークンも渡らない。貢献は同じリポジトリのブランチからに限る前提として文書に書く。
- Sentryへのソースマップのアップロード: どのspecも扱っていない。Sentryのプロジェクトと値を所有するlaunch-readinessが、本specのデプロイパイプラインへ手順を追加する(requirementsのAdjacent expectationsに明記)。

### 仮決定(2026-10-18に開発者が承認)

設計中に見つかった、開発者の判断が要る新しい論点である。回答(Q3・Q5・Q6)と上流specに最も整合する案を選んで設計を進め、2026-10-18に開発者が確認した。K1・K2・K4・K5・K6・K8は選んだ案のとおりに承認された。K3・K7は開発者の回答で変わり、下表の「決定」は変更後の内容である。

| #   | 論点                            | 決定                                                                                                                                                                                                                                                                                                                              | 他の選択肢(記録)                                                                                                                                                        |
| --- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| K1  | Queuesの管轄                    | 承認。本体・デッドレター・メールイベント用と、後続specが追加するQueueを、すべて`us`の管轄で作る。メッセージに宛先のメールアドレスなどの個人情報が入り、デッドレターは送り元と同じ管轄が必須のため、全Queueをそろえる                                                                                                              | 管轄を指定しない(既定)。準拠方針に「一時的なメッセージは保存場所を保証しない」と書く。メールイベントの購読が管轄付きのQueueへ届かないと分かった場合の切り替え先でもある |
| K2  | stateの保管先の分け方と管轄     | 承認。環境ごとに別のバケット(`genai-example-2-tofu-state-staging`・`-prod`)を作り、管轄は指定しない。接続先は通常のS3 API(`https://<ACCOUNT_ID>.r2.cloudflarestorage.com`)。バケット単位のR2 APIトークンで環境ごとに権限を分け、Data Access Logsで読み取りを追える                                                                | 1つのバケットをキーで分ける(トークンが両環境のstateに届く) / `us`の管轄で作る(接続先が`.us.`になり、Data Access Logsを使えない)                                         |
| K3  | Infisicalのプロジェクトの分け方 | 変更。既存の1つのプロジェクトのまま、dev・staging・prodの環境を使う。主体は開発者・`ci-checks`・`ci-deploy-staging`・`ci-deploy-prod`の4つ(Freeプランの上限5以内)で、機械の主体はプロジェクト全体のViewerになる。CIの機械の主体が全環境のシークレットを読めるリスクを受け入れる(Risksの「1つのプロジェクトで全環境を読める主体」) | 環境ごとにプロジェクトを分ける(既存をdev用とし、staging用・prod用を新設する。設計時に選んだ案で、取り下げた) / Proプランへ上げて環境ごとのロールで分ける(費用が掛かる)  |
| K4  | リリースのPRの作成の契機        | 承認。開発者がGitHubの画面からワークフローを手動で起動し、`main`または`hotfix/<名前>`からprodへのPRをbotに作らせる。hotfixのPRも同じワークフローで作る(開発者が自分のPRを承認できないため)                                                                                                                                        | stagingへのデプロイのたびに自動で作る(リリース前から開いたPRが残り、誤ってマージしやすい)                                                                               |
| K5  | CloudflareのAPIトークンの範囲   | 承認。環境ごとに1つのトークンをOpenTofuとWranglerで共用する。同じアカウントのため、stagingのトークンがprodの資源にも権限を持つ。このリスクを受け入れ、prodの資源の削除防止・D1のTime Travel・トークンの値を表示しない運用で緩和する                                                                                               | 用途ごとに分ける(同じジョブで両方を使うため効果が小さい) / 環境ごとにアカウントを分ける(同じゾーンのカスタムドメインを使うため不可)                                     |
| K6  | デプロイの後の確認              | 承認。stagingは`@smoke`タグを付けたE2Eテストをstagingのhttpsへ実行する。prodはapi・eventの`/health`とclientのトップページの応答だけを確かめる。frontend-platformの疎通確認のE2Eに`@smoke`タグを付ける                                                                                                                             | stagingで全E2Eを実行する(Mailpitなどローカル専用の前提を持つテストが失敗する) / デプロイの後に確認しない                                                                |
| K7  | Durable Objectsの保存場所       | 変更。Durable Objectsは管轄を指定しない。レート制限のカウンタとログイン試行の記録は、ハッシュ化した短命の値だけを持つため。準拠方針・プライバシーポリシー骨子には「Durable Objectsの保存場所は保証しない」と書く。backend-platform・identity-authへの依頼は無い                                                                   | `jurisdiction("us")`で米国にそろえるよう、backend-platform・identity-authへ依頼する(設計時に選んだ案で、取り下げた)                                                     |
| K8  | stagingの`SENTRY_DSN`の登録時期 | 承認。backend-platform・frontend-platformはstagingの`secrets.required`に`SENTRY_DSN`を持ち、値の登録をlaunch-readinessとしている。stagingへの随時デプロイには最初のデプロイの前に値が要るため、本specの初回の準備で開発者がstaging用のSentryのDSNを登録する                                                                       | 上流のstagingの`secrets.required`から`SENTRY_DSN`を外す(上流の変更) / stagingの最初のデプロイをlaunch-readinessまで待つ(roadmapの随時デプロイに反する)                  |

### 横断レビューの反映(2026-10-18)

Wave 1の4spec(infra-delivery・content-processing・media-pipeline・identity-auth)の横断レビューの指摘と開発者の回答を、次のとおり反映した。

- **I-3(Workerのシークレット)**: Infisicalのキーの表と`OPTIONAL_WORKER_SECRETS`に、Wave 1の各specが宣言したキーを加えた。必須は`REKOGNITION_ACCESS_KEY_ID`・`REKOGNITION_SECRET_ACCESS_KEY`(event、media-pipeline)・`GOOGLE_NL_API_KEY`(event、content-processing)、任意は`DISIFY_API_KEY`(api・event、identity-auth)・`MEDIA_SMOKE_TOKEN`(event、media-pipeline)である。要件12.3の対象を「各specが宣言したもの」に広げた。stagingの値は、そのキーを必須にする変更をmainへマージする前に登録する(未登録のままマージすると、以後のstagingのデプロイが必須の欠落で止まる)。prodの値の登録はlaunch-readinessへ引き継ぐ。任意のシークレットを各アプリの宣言から読む形には変えず、後続specが本specの一覧へ追記する。
- **I-4(技術ドキュメントの番号)**: `infra/005`〜`007`・`operations/001`・`002`・`security/003`に固定した。
- **M-1(`CLIENT_SITE_ORIGIN`)**: 変数はcontent-processing(client・admin)とidentity-auth(api)が所有し、名前と値をそろえる。本specは3環境の値を「Supporting References」の一覧に持ち、clientのホスト名を変えるときの再検証の対象に両specを加えた。
- **M-8(保存場所の記述の分担)**: 本specは、準拠方針とプライバシーポリシー骨子のうち、Cloudflareの資源の保存場所(D1・R2・Queuesは米国、Durable Objectsは保証しない)だけを書く。Rekognition(us-east-1)への送信とその移転の根拠はmedia-pipelineが書き、互いの記述を上書きしない。2回目の横断レビューのN-1で、節単位ではなく委託先単位の分担に改めた(次の節)。
- **M-11(Durable Objectのマイグレーション)**: Wrangler設定の`migrations`は`wrangler deploy`が同じ版で適用するため、本specの導入後はmainへのマージでCIがstagingへ適用する。identity-authの`LoginAttemptThrottle`もこの経路で適用される。
- **M-9(ジョブとメッセージの名前)**: 規約はジョブ・波及処理が`<spec名>.<名詞句>`、メッセージ種別が`<ドメイン>.<動詞句>`である。本specは定期実行のジョブも波及処理もメッセージ種別も持たないため、変更は無い。GitHub Actionsのワークフローのジョブ(`ci-gate`など)はこの規約の対象外である。

### 横断レビュー2回目の反映(2026-10-18)

Wave 1の2回目の横断レビューの指摘(N-1〜N-9)と開発者の回答を、次のとおり反映した。N-8・N-9はroadmapとuser-profile-socialのbriefの修正で、親エージェントが行う。

| ID  | 本specとの関係                          | 反映した内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N-1 | 国外移転の根拠の担当                    | 国外移転の記載事項と保存場所の記載を、節単位ではなく委託先単位で分担する。本specはCloudflareの項を書く。内容は、D1・R2・Queuesを米国の管轄に置くこと、所在を限定しない処理(Durable Objects・Workerの実行・画像配信のエッジのキャッシュ・Workers Logs)は処理する国を特定できないこととその理由、移転の根拠である。根拠はEU-USデータプライバシーフレームワーク(DPF)を主とし、DPFが無効になった場合はCloudflareのDPAに含まれる標準契約条項(SCC)に拠る。AWS(Rekognition)の項はmedia-pipelineが同じ根拠の種類で書き、互いの項を書き換えない。法務文書の本文は開発者が用意し、本specは骨子と準拠方針の記載事項までを書く。要件2に受け入れ基準2.6を加え、design.mdのOut of Boundary・Modified Files・追跡表とtasks 8.5を改めた。「国外移転の記載事項はmedia-pipelineが書く」「本specは書き換えない」という節単位の記述は無くした |
| N-2 | `OPTIONAL_WORKER_SECRETS`への暗黙の依存 | media-pipelineのタスク1.3は、本specの実装の有無を確かめ、無ければ開発者へ報告して進める(止めない)。本specのタスク5.3はWave 1のキーを先に一覧へ入れるため、本specの変更は要らない。design.mdの他specへの影響の表に、この扱いを書いた。roadmapの依存には加えない                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| N-3 | 関係なし                                | 本specは日次タイムラインのジョブも、frontend-libの`server/**`からの読み込みも持たない。`apps/common-lib`はCIの導入と配置に自動で含まれる(5.3)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| N-4 | 関係なし                                | 規約は「ジョブ・波及処理は`<spec名>.<名詞句>`、メッセージ種別は`<ドメイン>.<動詞句>`」である。本specはいずれも持たないため、M-9の記録の文言だけをそろえた                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| N-5 | シークレットのキーの一覧の置き場所      | キーの一覧の正を`docs/onboardings/project-values.md`のキーの一覧の節にする。tasks 8.5でその節を作り、各specはキーを宣言する変更と同じ変更で行を足す。技術ドキュメント`operations/001`には、登録の時期・欠落時にデプロイが止まること・任意のシークレットの一覧への追記を、プレースホルダーと一般的な規則だけで書き、キーの一覧はリンクにする。要件12.3を「規則を記載し、キーの一覧は固有の値の文書に置いて参照する」に改め、design.mdとtasks 8.2・8.5・9.1を合わせた                                                                                                                                                                                                                                                                                                                                                       |
| N-6 | 関係なし                                | 運営者による代理の退会はidentity-auth・ugc-moderationの担当で、インフラの資源と手順に変更は無い                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| N-7 | 関係なし                                | アップロードの可否の差し込み口はmedia-pipeline・identity-authの担当で、インフラの資源と手順に変更は無い                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

### 横断レビュー3回目の反映(2026-10-19)

Wave 1の3回目の横断レビューの指摘(R3-1〜R3-8)と開発者の回答を、次のとおり反映した。本specの担当はR3-4・R3-5・R3-6である。R3-7はroadmapとugc-moderationのbriefの修正で、親エージェントが行う。

| ID   | 本specとの関係                                 | 反映した内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R3-1 | 関係なし                                       | セッションの読み取り専用の型`SessionView`はapi-gateway・identity-auth・media-pipelineの担当で、インフラの資源と手順に変更は無い                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| R3-2 | 関係なし                                       | identity-authの記述の修正である                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| R3-3 | 関係なし                                       | media-pipelineの記述の修正である                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| R3-4 | Cloudflareの項の所在を限定しない処理の範囲     | 所在を限定しない処理に、メール送信(Email Sending)・bot判定(Turnstile)・アクセス解析(Web Analytics)を加えた。範囲は骨子の委託先の一覧のCloudflareの用途すべてに当たる。identity-authが前提にする「Cloudflareの項(Turnstileを含む)」と一致させた。要件の用語・2.6、design.mdのOverview・Modified Files・他specへの影響の表(identity-auth)、tasks 8.5を改めた                                                                                                                                                                                                                                                                                                                                                                                                              |
| R3-5 | Google Cloudの項の担当                         | Google Cloud(Natural Language API)の項はcontent-processingが同じ形と根拠の種類で書くことを、要件の決定事項・Out of scope・Adjacent expectations、design.mdのOut of Boundary・Revalidation Triggers・Modified Files・他specへの影響の表(content-processing)、tasks 8.5に加えた                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| R3-6 | 骨子の共通の「移転の法的根拠」の行と書き方の型 | 開発者の決定(2026-10-19)により、roadmapの順で最初に骨子を改める本specが、共通の行を「DPFを主とし、DPFが無効になった場合は委託先のDPAに含まれるSCCに拠る。委託先の項がある委託先は、その項を正とする」に改める。項を持たないStripe・Sentryにもこの行が当たる。あわせて、骨子(委託先ごとの`###`の見出しと移転先・移転の根拠・委託先が講じる措置の3項目)と準拠方針(「データの保存場所」の表の下の委託先ごとの箇条)の書き方の型を示し、Cloudflareの項を見本にする。media-pipeline・content-processingは型に合わせ、共通の行を書き換えない。DISIFYとHave I Been Pwnedを対象外とする文は残すと名指しで書いた。要件に受け入れ基準2.7を加え、design.mdのBoundary・Out of Boundary・Revalidation Triggers・Modified Files・追跡表・コンポーネントの要件の列と、tasks 8.5を改めた |
| R3-7 | 関係なし                                       | roadmapとugc-moderationのbriefの修正である                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| R3-8 | 関係なし                                       | 文言規則への追加はmedia-pipeline・identity-authの担当で、本specは文言を持たない                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |

### spec横断レビューの反映(2026-10-23)

共通ドメイン5spec(admin-foundation・legal-pages・inquiry-chat・payments・ultras-subscription)の作成後の横断レビューで、後続specが宣言した変数とシークレットが本specの一覧に無かった。開発者の決定(2026-10-23)により、次のとおり反映した。

- **ホスト名から導かれる変数**: apiの`ADMIN_SITE_ORIGIN`(admin-foundation。adminのホスト名から導く)と、eventの`CLIENT_SITE_ORIGIN`(payments)の行を「Supporting References」の一覧に加え、Out of Boundary・Revalidation Triggersに所有するspecを加えた。eventのホスト名の変更はStripeのWebhook endpointに効くため、再検証の対象にpaymentsを加えた。
- **シークレット**: 必須の`STRIPE_API_KEY`(api・event)・`STRIPE_WEBHOOK_SECRET`(event)をInfisicalのキーの表に加えた。登録の時期はWave 1の必須のキーと同じで、stagingは必須にする変更をmainへマージする前、prodはlaunch-readinessである。キーの一覧の正は`docs/onboardings/project-values.md`の節のままで、paymentsが宣言と同じ変更で行を足す。技術ドキュメントにはキーの名前を列挙しない(N-5)。
- **prodで仮の値を置く公開の変数**: clientの`STRIPE_PUBLISHABLE_KEY`(payments)は、`TURNSTILE_SITE_KEY`と同じくprodに形式の検証を通る仮の値を置き、launch-readinessが置き換える。OpenTofuの資源の識別子ではないため、識別子の反映と照合の対象には加えない。「Supporting References」に表を設けた。
- **その他の変数**: `PAYMENTS_SMOKE_ENABLED`(api・event、prodは`false`)はシークレットではないため、キーの表には載せず、他specへの影響の表に記録した。ultras-subscription・inquiry-chat・legal-pagesは新しいシークレット・変数・資源を持たない。
- **タスク**: 本specのタスクは、実装の時点でmainにあるキーと変数だけを扱い、後続specの行は後続specが足すため、タスクの追加は無い。構成検査(3.1・5.2)は資源一覧の識別子だけを照合し、`ADMIN_SITE_ORIGIN`・`STRIPE_PUBLISHABLE_KEY`を照合しないため、検査の変更も無い。
- **容量の単位**: 1,024を基数とする規則(文言規則)に関わるバイト数の上限を本specは持たない。

### spec横断レビューによる承認後の改訂(改訂1、2026-10-24)

- **状態**: 要件・設計・タスクの承認の後の改訂で、cross-spec reviewの指摘による。2026-10-24に開発者が推奨どおり確定した。`requirements.md`の「承認後の改訂」の表に改訂1として記録した。
- **指摘**: Infisicalの`/`に`STRIPE_API_KEY`を1つだけ置き、`selectWorkerSecrets`が全Workerへ同じ値を渡す設計は、paymentsのQ5(承認済み。api用とevent用の制限付きキーを別々に作る)と食い違っていた(CRITICAL)。launch-readinessも仮13で同じ食い違いを申し送っていた。あわせて、後続specが要求したホスト名から導かれる変数の行と、上流spec・他specへの影響の表の行が欠けていた。
- **決定(シークレット)**: dev・staging・prodの各環境に、Workerごとのフォルダ`/workers/api`・`/workers/event`を設け、その値を同じキーの`/`の値より優先してそのWorkerにだけ渡す(要件4.10)。Workerごとに分けると定めたキーの一覧`WORKER_SCOPED_SECRETS`(初版は`STRIPE_API_KEY`)は、`/`に置いても使わず、Workerごとのフォルダに無ければ必須の欠落として止める。一覧と重ね合わせは`core/secret-scope.ts`(`WORKER_SCOPED_SECRETS`・純粋関数`layerWorkerSecrets`)に置き、`deploy-worker`(デプロイ)・`run-with-secrets --worker`(検査とローカル)・`e2e-stack`(api・eventを`run-with-secrets --scope checks --worker`を通して起動)の3つの経路で同じ規則を使う。ローカルの起動のために`run-with-secrets`へ範囲`local`(ログインせず開発者の`infisical login`を使う)を加え、オンボーディングのapi・eventの起動のコマンドを改める。フォルダは、dev・stagingは初回の準備で、prodはlaunch-readinessが空のまま作る。
- **理由**: キー名を変えずに値をWorkerごとに分けられ、payments・launch-readinessのWrangler設定と環境の検証を変えずに済む。`/`の値を捨てる一覧を持つことで、誤って共通のフォルダへ登録した制限付きキーが両方のWorkerへ渡る事故を防げる。重ね合わせを配布のスクリプトの1つの関数に置くことで、デプロイ・E2E・ローカルの優先の規則がずれない。
- **他の選択肢(記録)**:
  - Infisicalのシークレットのインポート(Workerごとのフォルダが`/`をインポートし、`infisical run --path /workers/api`で起動する): コマンドの変更は小さいが、同じキーの優先の順をCLIの挙動に委ねることになり、版による違いを確かめられていない。CIのデプロイと規則を共有できない。
  - `infisical run`の入れ子(外側で`/`、内側で`--path /workers/api`): 内側の値が外側の環境変数を上書きするかがCLIの挙動に依存する。
  - キー名を分ける(`STRIPE_API_KEY_API`など): paymentsの環境の検証とWrangler設定の宣言を変える必要があり、Workerのコードが同じ名前で読めなくなる。
- **決定(ホスト名から導かれる変数)**: 「Supporting References」の一覧に、eventの`EVENT_SITE_ORIGIN`(notifications)、apiの`IMAGES_ORIGIN`とclientの`PUBLIC_API_ORIGIN`(public-api)、client・adminの`IMAGES_ORIGIN`(frontend-platform)の3環境の値を加え、Out of Boundary・Revalidation Triggers(event・api・imagesのホスト名の変更)に所有するspecを加えた。値は各specの設計の値と同じで、変数は所有するspecがWrangler設定に書く。構成検査はこれらを照合しないため、検査の変更は無い。
- **決定(影響の表)**: 上流spec・他specへの影響の表に、notifications・public-apiの行を加え、frontend-platformの行に`IMAGES_ORIGIN`を、paymentsの行にWorkerごとのフォルダを、launch-readinessの行に仮7の承認後の条件付きの追記(`core/secret-scope.ts`の`/ci/sentry`、`commands/deploy-worker.ts`・`deploy.yml`のソースマップのアップロードの手順、新設の`core/sourcemap-upload.ts`・`commands/upload-sourcemaps.ts`)とprodのWorkerごとの登録(仮13)を加えた。
- **変えた箇所**: 要件4.10と「承認後の改訂」の表。設計のBoundary Commitments(契約・Out of Boundary)・Revalidation Triggers・Directory Structureの注記・シークレットの供給の図と説明・追跡表(4.10・6.3)・コンポーネントの表・`secret-scope.ts`と`worker-secrets.ts`の契約と説明・DeliveryCliの表(`run-with-secrets`・`e2e-stack`)・WorkerDeployer・E2eStack・`operations/001`と`security/003`の内容・Modified Files(オンボーディング)・Error Handling・Testing Strategy・Security Considerations・影響の表・Infisicalのフォルダとキーの表と注記・初回の準備の手順3・ホスト名から導かれる変数の値の表。タスク4.3・4.4・5.3・8.2・8.3・8.5。番号の変更は無い。
- **他specへの申し送り(本specは編集しない)**: backend-platform・email-delivery・launch-readinessの設計に、eventまたはapiを`infisical --telemetry=false run --env dev -- ...`で起動する記述がある。paymentsが`STRIPE_API_KEY`を必須にした後は、Workerごとのフォルダを重ねる`run-with-secrets --scope local --worker`の形でないと起動の検証が失敗するため、各specで記述を改める必要がある。
- **変更部分のタスクの検証**: kiro-spec-tasksのタスクのグラフのサニティレビューを、変更部分に絞って新しいサブエージェントによる独立した確認(independent)で行った。1回目の判定はNEEDS_FIXESだった。`WORKER_SCOPED_SECRETS`を`worker-secrets.ts`(5.3)に置くと先に動く4.3が使えないため`secret-scope.ts`へ移して4.3で置くこと、devのWorkerごとのフォルダの存在を6.3・8.5の前提にすること、`project-values.md`の実行接頭辞の記述にapi・eventの例外を書くこと、8.5の完了状態と4.4の実起動の依存の注記を加えることを直した。4.3の分割は、判定と注入の部品が同じ層で閉じるため見送った。2回目の判定はPASSで、残る指摘は無かった。`spec.json`の`updated_at`を更新し、タスクの承認を保った。

### frontend-platformの最終検証による承認後の改訂(改訂2、2026-10-28)

- **状態**: 2026-10-28に開発者が決定した改訂で、確定している。frontend-platformの実装と最終検証の後に開発者が決めた判断(Turnstileのウィジェットを非表示で使うこと、全WorkerのIP制限のキーを`HASH_PEPPER`のHMACでハッシュ化すること)を、frontend-platformのタスク10.4として本specの設計へ反映した。`requirements.md`の「承認後の改訂」の表に改訂2として記録した。受け入れ基準は変えていない。
- **Context**: frontend-platformの`TurnstileWidget`は`options.size: 'invisible'`で非表示のウィジェットを描き、画面に枠を出さない。Cloudflare側のウィジェットの種類が`managed`のままでは、判定が対話を求めた時に表示する場所が無い。また、client・adminもIP制限のキーのハッシュ化に`HASH_PEPPER`を使うため、`secrets.required`(3環境)に`HASH_PEPPER`を持つ。本設計のstagingのキーの表と初回の準備は、`HASH_PEPPER`の使うWorkerをapi・eventに限っていた。
- **決定**: `ResourceCatalog.turnstile.mode`・`cloudflare_turnstile_widget`の`mode`・`tofu test`の期待値・Supporting Referencesの資源の値を`invisible`にした。Cloudflare providerの`cloudflare_turnstile_widget.mode`の値は`managed`・`non-interactive`・`invisible`である(Cloudflareの公式文書のTurnstileの「Widget types」と、Turnstileのウィジェットの設定項目`mode`の説明「managed (default), non-interactive, or invisible」で確かめた)。`HASH_PEPPER`はInfisicalの各環境の`/`に1つの値を置き、api・event・client・adminが共有する。stagingのキーの表と初回の準備の手順10に、使うWorkerとしてclient・adminを加えた。client・adminは`/workers/*`のフォルダを持たないため、`/`の値がそのまま渡る(`selectWorkerSecrets`の`perWorker`は空)。
- **プライバシーポリシーの記述の持ち主**: 非表示のウィジェットを使う条件としてプライバシーポリシーに置く記述は、frontend-platformの第2回の判断15(2026-10-28)により、legal-pagesが公開前に確かめて骨子のCloudflareの項に加える。本specの設計・タスクはその記述を持たず、ウィジェットの種類(`invisible`)と`HASH_PEPPER`の登録先だけを持つ。Modified Filesとタスク8.5の分担の文に、Cloudflareの項のうちその記述はlegal-pagesが加えることを書いた(frontend-platformのタスク11.6)。
- **変えた箇所**: 設計のRevalidation Triggers(ウィジェットの種類)・`ResourceCatalog`の`turnstile.mode`・EdgeServicesModuleの資源と検証・frontend-platformへの影響の行・Supporting Referencesの資源の表・Infisicalのキーの表のstagingの必須の行・初回の準備の手順10。本ファイルの「確認済みのため質問しない事項」のウィジェットのモードとproviderの調査の`mode`の値。tasks.mdの2.2(計画のテストのモード)。staging・prodのサイトキーとアクセス解析のトークンの仮の値は、従来どおり本specとlaunch-readinessが置き換える。
- **参照**: [Turnstile(Cloudflare Challenges)](https://developers.cloudflare.com/cloudflare-challenges/challenge-types/turnstile/)・[Turnstile Spin](https://developers.cloudflare.com/turnstile/spin/)・[Widget configurations](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/widget-configurations/)。

### frontend-platformの第4回の判断による承認後の改訂(改訂3、2026-10-29)

- **状態**: 2026-10-29に開発者が決定した改訂で、確定している。frontend-platformの最終報告の確認事項に対する第4回の判断(判断42・47)を、frontend-platformの第4回の判断の反映として本specの設計とタスクへ反映した。`requirements.md`の「承認後の改訂」の表に改訂3として記録し、6.4に開発サーバーとビルド後のプレビューの両方での実行を加えた。
- **Context**: frontend-platformの要件1.1は、画面を持つアプリが開発サーバーとビルド後のプレビューの両方で動くことを求める。本specの検査のE2E(`e2e-stack`)はclient・adminをビルド後のプレビューだけで起動していた。また、frontend-platformはclient・adminに型生成のスクリプト(`cf-typegen`・`cf-typegen:check`)を置き、生成した`Env`と環境の検証スキーマの型の照合を`cf-typegen:check`に含めることにした。
- **決定**: ルートに置くコマンド`test:e2e:dev-and-preview`(dev-toolingの承認後の改訂2)が、client・adminを開発サーバーで起動してE2Eを実行し、止めてからビルド後のプレビューで起動してE2Eを実行する。`e2e-stack`はMailpit・api・eventだけを起動し、そのコマンドを呼ぶ。client・adminが起動しない時の表示(6.5)はそのコマンドが行う。生成物と設定の検査の表(`APP_CHECKS`)にclient・adminの`cf-typegen:check`を加える。
- **変えた箇所**: 要件の「承認後の改訂」の表と6.4、設計のRevalidation Triggers・コマンドの表(`app-checks`・`e2e-stack`)・E2eStackのサービスの表と準備・ワークフローの`e2e`のジョブ・frontend-platformへの影響の行、タスク4.2・4.4。`spec.json`の承認の状態は変えていない。

### 実装の検証の後の改訂(改訂5、2026-10-30)

- **状態**: 2026-10-30に開発者が決定した改訂で、確定している。`requirements.md`の「承認後の改訂」の表に改訂5として記録し、5.5の受け入れ基準を改めた。
- **Context**: 実装の検証(`/kiro-validate-impl`)で、`audit`が上流のアプリの依存パッケージの重大度が高の脆弱性で失敗し、`checks / ci-gate`が成功しないことが分かった。また、TruffleHogの`--results=verified,unknown`は検証の仕組みを持たない検出器の結果(`unverified`)で失敗せず、その範囲が要件にも改訂4にも明示されていなかった。
- **決定**: 既知の脆弱性の確認は`bun audit --audit-level=critical`で、重大度が最大の脆弱性だけで失敗させる。重大度が高以下の脆弱性は依存パッケージの更新で解消する。TruffleHogの判定は変えず、未検証の結果では失敗させないことを仕様として明記し、検証できない種類の秘密値はコミット時の検出器(Betterleaks)が受け持つ。
- **変えた箇所**: 要件の「承認後の改訂」の表と5.5、設計の要件トレーサビリティ(5.5)・コマンドの表(`audit`)・`infra/007`の記載事項、`core/audit-exceptions.ts`の`AUDIT_LEVEL`と`audit`の表示、`infra/007`。

## Research Log

### Cloudflare providerの版と管轄の対応

- **Context**: Q3で米国の管轄を採用したため、OpenTofuで`jurisdiction = "us"`を指定できるかを最初に確かめる(親エージェントの指示)。
- **Sources Consulted**: OpenTofu Registryの版の一覧(`api.opentofu.org/registry/docs/providers/cloudflare/cloudflare/index.json`)、Terraform Registryの版の一覧、`cloudflare/terraform-provider-cloudflare`のタグ`v5.27.0`の`docs/resources/{d1_database,r2_bucket,queue,workers_custom_domain,turnstile_widget,web_analytics_site,email_sending_subdomain,dns_record}.md`。
- **Findings**:
  - 版の公開日(OpenTofu Registry): 5.28.0は2026-10-13T18:08Z、5.27.0は2026-10-03T04:06Z、5.26.0は2026-09-26。Terraform Registryは5.27.0を2026-10-05と表示するが、本プロジェクトはOpenTofu Registryから取得するため、そちらの日付で判断する。
  - `cloudflare_d1_database.jurisdiction`: 値は`"eu"`・`"fedramp"`・`"us"`。指定するとロケーションヒントは無視される。`read_replication.mode`は`"auto"`・`"disabled"`。
  - `cloudflare_r2_bucket.jurisdiction`: 値は`"default"`・`"eu"`・`"fedramp"`・`"us"`。importの識別子は`<account_id>/<bucket_name>/<jurisdiction>`。`location`は最初の作成時だけ効くベストエフォートの指定である。
  - `cloudflare_queue.jurisdiction`: 値は`"eu"`・`"us"`・`"fedramp"`。
  - `cloudflare_workers_custom_domain`: `account_id`・`hostname`・`service`が必須で、`zone_id`を指定できる。`environment`は非推奨。
  - `cloudflare_turnstile_widget`: `domains`・`mode`(`managed`・`non-interactive`・`invisible`)・`name`が必須で、`secret`はsensitiveな計算値、`sitekey`は計算値。
  - `cloudflare_web_analytics_site`: `auto_install`を`false`にし、`host`を指定すると手動のスクリプト用のサイトになる。`site_token`が計算値。
  - `cloudflare_email_sending_subdomain`: `zone_id`・`name`が必須で、`preview_enabled`・`drop_suppressed_recipients`を持つ。`dkim_selector`・`return_path_domain`が計算値。
  - Queuesのイベントの購読の資源は無い(Q7の前提どおり)。
- **Implications**: Cloudflare provider 5.27.0を採用する。管轄はすべてOpenTofuの属性で指定でき、Wrangler・APIで作ってimportする代替は要らない。送信ドメインの`preview_enabled = false`でemail-deliveryの手作業(プレビューの無効化)をOpenTofuへ取り込む。

### Cloudflareの管轄の仕様

- **Sources Consulted**: Cloudflare Docs「[R2 Data location](https://developers.cloudflare.com/r2/reference/data-location/)」、Changelog「New `us` jurisdiction for R2」(2026-08-17)、「[D1 Data location](https://developers.cloudflare.com/d1/configuration/data-location/)」、Changelog「United States jurisdiction」(D1、2026-10-02)、「[Queues Data location](https://developers.cloudflare.com/queues/configuration/data-location/)」、「[Dead Letter Queues](https://developers.cloudflare.com/queues/configuration/dead-letter-queues/)」、Changelog「Queues now supports EU, US, and FedRAMP jurisdictions」(2026-10-12)、「[Durable Objects Data location](https://developers.cloudflare.com/durable-objects/reference/data-location/)」、Changelog「New `us` jurisdiction for Durable Objects」(2026-06-26)。
- **Findings**:
  - R2: 管轄付きのバケットをWorkersから使うには、Wrangler設定の`r2_buckets`に`jurisdiction`を書く。S3 APIの接続先は`https://<ACCOUNT_ID>.<管轄>.r2.cloudflarestorage.com`で、管轄の接続先からは他の管轄の資源に届かない。Logpushは管轄付きのバケットへ直接出力できない。Data Access Logsは管轄の無いバケットだけで使える。作成後に管轄は変えられない。
  - D1: 管轄付きのデータベースにも、Workersは世界中から接続できる。作成後に管轄は変えられない。
  - Queues: 管轄付きのQueueにも、Workersはどこからでも送受信できる(バインディングに管轄の指定は無い)。デッドレターキューは送り元と同じ管轄でなければならず、存在しない名前を指定すると送り元と同じ管轄で自動作成される。作成後に管轄は変えられない。Queuesの管轄は公開から6日しか経っておらず、Email Sendingのイベントの購読が管轄付きのQueueへ届くかは文書に記載が無い。
  - Durable Objects: `env.<名前空間>.jurisdiction("us")`で米国の管轄の名前空間を得る。コードで指定するもので、Wrangler設定やOpenTofuでは指定しない。
- **Implications**: R2のバインディングへの`jurisdiction: "us"`の追記を、本specがapi・eventのWrangler設定のstaging・prodに行う(上流の再検証の対象)。Queueの管轄はK1のとおり`us`とし、stagingで購読の到達を最初に確かめる。Durable Objectsは管轄を指定せず、準拠方針には保存場所を保証しないと書く(K7)。

### InfisicalのproviderとCLI

- **Sources Consulted**: OpenTofu Registryの`infisical/infisical`の版の一覧、`Infisical/terraform-provider-infisical`のタグ`v0.19.38`の`docs/index.md`・`docs/ephemeral-resources/secret.md`、Infisical Docs「[OIDC Auth for GitHub](https://infisical.com/docs/documentation/platform/identities/oidc-auth/github)」「[infisical login](https://infisical.com/docs/cli/commands/login)」。
- **Findings**:
  - 版の公開日(OpenTofu Registry): 0.20.5・0.20.4は2026-10-16、0.20.0〜0.20.3は2026-10-07〜09、0.19.39は2026-10-05、0.19.38は2026-10-03T03:47Z。2週間以上経った最新は0.19.38である。
  - 0.19.38は`ephemeral "infisical_secret"`(`name`・`env_slug`・`workspace_id`・`folder_path`)を持つ。providerの認証は`auth`ブロックか環境変数(`INFISICAL_AUTH_METHOD`に`oidc`・`universal`・`token`など、`INFISICAL_MACHINE_IDENTITY_ID`・`INFISICAL_AUTH_JWT`・`INFISICAL_UNIVERSAL_AUTH_CLIENT_ID`/`SECRET`)で指定でき、`host`は`INFISICAL_HOST`でも指定できる。
  - OIDC認証の主体は、JWTの`sub`・`aud`・任意のクレーム(`job_workflow_ref`など)をglobで縛れる。GitHubのsubjectは、Environmentを使うジョブでは`repo:<owner>/<repo>:environment:<名前>`、pushでは`repo:<owner>/<repo>:ref:refs/heads/<ブランチ>`、プルリクエストでは`repo:<owner>/<repo>:pull_request`になる。
  - CLIは`infisical login --method=oidc-auth --machine-identity-id <ID> --jwt <JWT> --silent --plain`でアクセストークンだけを出力し、以降のコマンドは`INFISICAL_TOKEN`を読む。本プロジェクトのInfisicalはEUリージョン(`https://eu.infisical.com`)である(オンボーディング)。
- **Implications**: `infisical` provider 0.19.38を採用する。providerの`auth`ブロックは書かず`host`だけを書き、CIはOIDC、障害時のローカルの操作は有効期限の短いUniversal Authの資格情報を環境変数で与える(Requirement 4.9)。

### InfisicalのCLIのフォルダの取り出し(4.3、2026-10-29)

- **Sources Consulted**: 開発コンテナのInfisical CLI 0.44.8の`infisical export --help`・`infisical login --help`、開発者のログインでのdevの環境への`infisical export`の実行(値を表示せず、件数・項目の名前・終了コード・標準エラー出力だけを確かめた。staging・prodには接続していない)、GitHubの`Infisical/cli`のタグ`v0.44.8`の`packages/cmd/export.go`・`packages/util/helper.go`。
- **Findings**:
  - `infisical --telemetry=false export --format=json --env=dev --path=/ --projectId=<ID> --domain=https://eu.infisical.com --silent`は、終了コード0で、`key`・`value`のほかに`_id`・`type`・`secretPath`・`tags`・`comment`などを持つオブジェクトの配列を標準出力へ出す。
  - 存在しないフォルダ(`--path=/workers/api`。devのWorkerごとのフォルダは2026-10-29時点で未作成)は、終了コード1で、標準出力は空、標準エラー出力に要求のURLと`404 Not Found`・`Folder with path '<フォルダ>' in environment '<環境>' was not found`を出す。値は含まれない。
  - 空のフォルダ(作成済みで値が無い)は、終了コード0で標準出力に`[]`を出す。2026-10-30に開発者がdevへ`/workers/api`・`/workers/event`を作った後に確かめ、`run-with-secrets --scope local --worker api|event -- true`も成功した。CLIのソースでは、取り出した一覧を件数を確かめずに`json.Marshal`へ渡すため、空のスライスが`nil`なら`null`になり得る。
  - 認証は`--token`、`INFISICAL_UNIVERSAL_AUTH_ACCESS_TOKEN`、`INFISICAL_TOKEN`の順に読み、どれも無ければ開発者の`infisical login`のセッションを使う。
- **Implications**: `parseInfisicalExport`は`[]`と`null`を空の一覧として取り込む。取り出しの失敗(終了コードが0以外)は、標準出力・標準エラー出力を表示せず、環境とフォルダの名前と終了コードだけを示して止める(4.7・4.10)。空のフォルダの実際の出力は`[]`であることを確かめた。`run-with-secrets --scope checks`は`INFISICAL_TOKEN`が無ければ取り出さずに失敗し、検査の主体の代わりに開発者のセッションを使わない。

### InfisicalのFreeプランの制約

- **Sources Consulted**: Infisical「[Pricing](https://infisical.com/pricing)」、Infisical Docs「[Role-based access controls](https://infisical.com/docs/documentation/platform/access-controls/role-based-access-controls)」、第三者の料金の解説(2026-09)。
- **Findings**: Freeプランは主体5つ(人間と機械の合計)・プロジェクト数無制限・プロジェクトあたり環境3つで、独自のロールは使えない。組み込みのロール(Admin・Member・Viewer)はプロジェクト全体に効き、環境ごとに権限を分けられない。監査ログは保持されない。
- **Implications**: 既存の1つのプロジェクトのdev・staging・prodの環境を使う(K3)。主体は開発者・`ci-checks`・`ci-deploy-staging`・`ci-deploy-prod`の4つで、機械の主体にはViewerを与える。Viewerはプロジェクト全体に効くため、機械の主体はどれも全環境のシークレットを読める。各コマンドが取り出す環境を自分の範囲に限り、主体をOIDCのクレームで縛ることで、読み取りの経路を狭める(Risks)。主体を範囲ごとに分けておくのは、Proプランなどで環境ごとのロールが使えるようになったときに、ロールの変更だけで環境を分離できるようにするためである。Viewerを機械の主体にFreeプランで割り当てられることを、初回の準備で確かめる(Risks)。

### OpenTofuの機能

- **Sources Consulted**: OpenTofu Docs「[State and Plan Encryption](https://opentofu.org/docs/language/state/encryption/)」「[tofu plan](https://opentofu.org/docs/cli/commands/plan/)」、`security/001-secret-management.md`。
- **Findings**:
  - 暗号化の設定は変数とlocalsを参照でき、`tofu init`の時点で解決できる値に限る。`pbkdf2`のパスフレーズは16文字以上。`state`と`plan`のそれぞれに`enforced = true`を付けると、鍵が無いときに暗号化していないデータを書かない。
  - `tofu plan`・`tofu apply`は`-exclude=<アドレス>`を受け付け、除いた資源とそれに依存する資源を計画しない。`-concise`は進捗の表示を抑える。
  - `tofu output -json`はsensitiveな出力の値も平文で出す。計画のJSON(`tofu show -json`)も値を含む。
- **Implications**: 秘密値はOpenTofuの出力にしない。計画はファイルへ暗号化して保存し、表示は資源のアドレスと操作の種類だけに要約する。ホスト名の割り当ては`-exclude=module.worker_routing`で1回目の適用から外す。

### Email Sendingと配信不能イベントの購読

- **Sources Consulted**: Cloudflare Docs「[Domains](https://developers.cloudflare.com/email-service/configuration/domains/)」「[Subdomains](https://developers.cloudflare.com/email-service/configuration/subdomains/)」「[Event subscriptions](https://developers.cloudflare.com/email-service/reference/event-subscriptions/)」「[Queues Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/queues/)」。
- **Findings**:
  - ダッシュボードで送信ドメインを登録すると、`cf-bounce.<ドメイン>`のMX・SPF・DKIMと`_dmarc.<ドメイン>`のDMARCをEmail Serviceが作ってロックする。APIで登録した場合にレコードが作られるかは文書に記載が無い。
  - 購読は送信ドメインごとで、イベントは`message.delivered`・`deferred`・`bounced`・`failed`・`rejected`・`complained`。
  - `wrangler queues subscription create <QUEUE> --source email.sending --events <カンマ区切り> --zone-id <ID> --domain <ドメイン> --name <名前>`で作り、`wrangler queues subscription list <QUEUE> --json`で一覧を得る。
- **Implications**: 送信ドメインのDNSレコードはEmail Serviceに任せ、OpenTofuで重複して定義しない。APIでの登録でレコードが作られない場合の対処(`cloudflare_dns_record`で作る)はRisksに記録する。購読の操作は、Dockerfileの`WRANGLER_VERSION`(4.152.0)と同じ版のWranglerで行う(アプリのWranglerはテストと同じ4.124.0に固定され、`--zone-id`・`--domain`の対応を保証しないため)。

### WorkersのカスタムドメインとWranglerのデプロイ

- **Sources Consulted**: Cloudflare Docs「[Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)」「[Configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)」(Source of truth)、「[Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)」、「[Workers commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/)」、「[Rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)」、「[Preview URLs](https://developers.cloudflare.com/workers/previews/custom-domains/)」。
- **Findings**:
  - カスタムドメインには、有効なゾーンと呼び出すWorkerが要る。既存のCNAMEレコードがあるホスト名には作れない。作成するとDNSレコードと証明書が自動で作られる(2階層以上のサブドメインも、カスタムドメインごとの証明書で賄われる)。
  - Wrangler設定に`route`・`routes`を書かず`workers_dev = false`にすると、Wranglerはダッシュボードなど外部で設定したルートを上書きしない。`preview_urls`は書かないと既存の設定を変えず、明示すれば変える。
  - `wrangler deploy`は`--tag`・`--message`で版に情報を付け、`--secrets-file`(JSONまたは.env形式)で同じ版にシークレットを反映する(ファイルに無いシークレットは前の版から引き継ぐ)。`secrets.required`のキーが揃っていないとデプロイは失敗する。`wrangler deployments status --json`・`wrangler versions view <ID> --json`で現在の版とその情報を得られる。
  - ロールバックは直近100版まで。Durable Objectのクラスのライフサイクルの変更をまたぐ場合、対象の版が参照するR2・KV・Queueが無くなった場合は戻せない。Workerにつながる資源は戻らない。
- **Implications**: ホスト名の割り当ては2段階の適用で後回しにする。4アプリのWrangler設定に`workers_dev: false`・`preview_urls: false`を追記し、`routes`を書かない(構成検査で確かめる)。直前のリリースは、clientのWorkerの現在の版のタグ(コミット)から特定する。

### GitHubの挙動

- **Sources Consulted**: GitHub Docs(Automatic token authentication「Using the GITHUB_TOKEN in a workflow」、About code owners、Available rules for rulesets、Using environments for deployment、OpenID Connect reference)、既存のルールセット「Block main&prod push/delete」(ID 22452803、調査担当が2026-10-18に確認)。
- **Findings**:
  - `GITHUB_TOKEN`で作ったイベントは、`workflow_dispatch`・`repository_dispatch`を除き新しいワークフローを起動しない。プルリクエストの必須チェックは、そのhead SHAに報告されたチェックで判定される。
  - コードオーナーは書き込み権限を持つユーザーまたはチームで、GitHub AppとBotはなれない。CODEOWNERSはプルリクエストのベースブランチのものが使われる。
  - ルールセットの「Require approval of the most recent reviewable push」は、最後にpushした人以外の承認を求める。mainへのマージ(開発者の操作)もpushとして数えられ、main→prodのPRのheadの最後のpushが開発者になるため、有効にすると開発者自身の承認が数えられなくなる。
  - Environmentのデプロイ対象ブランチの制限は公開リポジトリの無料プランで使える。OIDCのトークンの`job_workflow_ref`は、再利用ワークフローでは呼ばれたワークフローのパスとrefになる。
  - フォークからのプルリクエストには、シークレットもOIDCのトークンも渡らない。
- **Implications**: 必須チェックは再利用ワークフローの1つの総合結果(`checks / ci-gate`)にし、pushとプルリクエストの両方で同じ名前で報告する。prodのルールセットはコードオーナーの承認・古い承認の取り消しを有効にし、「最後のpushの承認」は無効にする。stagingとprodの主体は、Environmentのsubjectと`deploy.yml`の`job_workflow_ref`で縛る。

### Claude設定の拒否と、AIエージェントによる承認の経路

- **Sources Consulted**: `.claude/settings.json`。
- **Findings**: `*tofu apply*`・`*tofu import*`・`*tofu state rm*`・`*tofu force-unlock*`・`*wrangler deploy*`(`--dry-run`を含む)・`*wrangler rollback*`・`*wrangler secret*`・`*wrangler d1 * --remote*`・`*wrangler d1 time-travel restore*`・`infisical secrets set`・`infisical secrets folders create`・`gh workflow run`・`gh pr merge`・`gh secret set`・`gh variable set`、`*.tfstate*`・`*.tfvars*`の読み書きが拒否されている。`gh pr review`と`gh api`は拒否されていない。開発コンテナの`gh`は開発者の認証情報でログインしている(オンボーディング)。
- **Implications**: AIエージェントは開発者の名義でbot作成のPRを承認し、`gh api`でマージできてしまう。`Bash(gh pr review*)`・`Bash(gh api*)`をdenyへ加えるよう開発者に報告する(本specは`.claude/`を編集しない)。tfvarsに頼らず、変数は環境変数と資源一覧のJSONで与える。

### Bunの組み込みの解析器

- **Sources Consulted**: Bun 1.4.2で`Bun.JSONC.parse`・`Bun.YAML.parse`・`bun audit --help`を実行した。
- **Findings**: JSONC(コメント・末尾のカンマ)とYAMLを追加のパッケージなしに解析できる。`bun audit`は`--audit-level`・`--ignore`(GHSAまたは番号)・`--json`を持つ。
- **Implications**: Wrangler設定とワークフローの検査を、新しいパッケージを入れずにルートのTypeScriptで書く。脆弱性の確認は`bun audit --audit-level=critical`と、理由を書いた除外の一覧で行う(改訂5で`high`から改めた)。

### dev-toolingからの申し送りとCIの実行環境

- **Sources Consulted**: `.kiro/specs/dev-tooling/tasks.md`の申し送り(5.2・5.3・5.6・6.2・8.1)、`docs/GUIDES/tech/coding/003-shared-directories.md`「CIでのコピー配置」、`docs/GUIDES/tech/testing/001-test-strategy.md`、`Dockerfile`。
- **Findings**:
  - CIでは、ルートと各アプリで`CI=true bun install --frozen-lockfile`→`shared-dirs:place`→`check`をテストより先に実行する。`SHARED_DIRS`の配置元のうち`package.json`を持つもの(`apps/db`など)も導入する。
  - Playwrightの実行にはNode 22.5.0以上(推奨24)と、`CHROMIUM_PATH`またはPlaywrightが期待するChromiumのリビジョンが要る。`wrangler types --check`で生成物の鮮度を確かめられる。lcovの`SF:`は実行ディレクトリ基準で、`coverage/unit/lcov.info`を明示する。
  - アプリのスクリプトと設定は`/workspace/.wrangler/state`などの絶対パスを使う。
  - DockerfileはBun 1.4.4(`oven/bun:1.4.4-slim`)・OpenTofu 1.13.2・Wrangler 4.152.0・Infisical CLI 0.44.8・Mailpit 1.32.0・Playwright 1.64.1を固定する。TruffleHogは含まない。
- **Implications**: CIのランナーで`/workspace`を`$GITHUB_WORKSPACE`へのシンボリックリンクにして絶対パスをそろえる。導入の対象は`config/workspace-layout.ts`から導き、`apps/common-lib`(content-processingが追加)を含む新しい共有ディレクトリにも自動で追随する。

### 未確認の版(実装時に固定する)

- GitHubへの外部アクセスがこのセッションでは許可されず、GitHub Actionsのアクション(`actions/checkout`・`oven-sh/setup-bun`・`actions/setup-node`・`opentofu/setup-opentofu`・`actions/upload-artifact`・`trufflesecurity/trufflehog`)とTruffleHog本体・Node 24の版を確認できなかった。実装時に、公開から2週間以上経った版をコミットSHAで固定し、tech-stack.mdへ記載する。
- 実装で固定した版(tasks 6.2・6.3): checkout v7.0.1・setup-bun v2.2.0・setup-node v7.1.0・setup-opentofu v2.0.2・upload-artifact v7.0.2・TruffleHogのアクションv3.99.2(いずれもコミットSHA。setup系は軽量タグのコミット)、TruffleHogのイメージ`3.99.2`(タグ)、Node 26.12.1(G1)。

### 実装で判明した事実(tasks 1.1〜8.5、9.1でまとめた)

- **Sources Consulted**: 各タスクの実装と単体テスト、開発コンテナのツールの実行(OpenTofu 1.13.2・Wrangler 4.124.0(アプリ)・Playwright 1.64.1・Bun 1.4.4・Infisical CLI 0.44.8)、`Infisical/cli`のリリースの配布物の一覧。Cloudflare・Infisical(dev以外)・GitHubのランナーへは接続していない。
- **Findings**:
  - OpenTofu 1.13.2の`tofu output -json <名前>`は値だけを出し、sensitiveの印を落とす(sensitiveな値も平文で出る)。名前を指定しない`tofu output -json`は、出力ごとに`sensitive`・`type`・`value`を持つ。そのため`reconcile-ids`は全出力を取り込み、`sensitive`が`false`でない出力の値に触れない。
  - OpenTofu 1.13.2はbackendの設定に`sensitive`な変数を使うと`tofu init`で拒否する(`validate`・`tofu test`では現れない)。`check`ブロックの失敗は警告で、計画を止めない。モックのproviderは`ephemeral`リソースに対応する。
  - Wrangler 4.124.0はデプロイ先(`routes`・カスタムドメイン・`workers_dev`)の無いWorkerを「No targets deployed」のログだけでデプロイし、失敗しない。カスタムドメインは2段目の適用で割り当てるため、最初のデプロイが失敗しないことの前提になる。
  - Wrangler 4.124.0は、アプリのディレクトリにビルドの転送先の設定`.wrangler/deploy/config.json`があると、`deployments status --json`などの標準出力の先頭へ案内の行を出し、JSONとして解析できなくなる。apiのデプロイ(直前のリリースの特定)をclientのビルドより前に置けば起きない。初回のデプロイでは`deployments status`が「no deployments」で失敗する(「特定できない」として続ける)。版の`annotations["workers/tag"]`に`--tag`の値が入る。
  - Wrangler 4.124.0の`wrangler rollback --message`は確認の問い合わせを省かない(Cloudflare Docsの記述と異なる。版を上げたら確かめ直す)。
  - `wrangler queues subscription list <Queue> --json`は購読の配列(`name`・`enabled`・`source`(`type`・`zone_id`・`domain`)・`events`)を返す形として実装し、購読が無い場合の`null`も空として扱った。一覧は既定で1ページ20件である。実際のアカウントでの出力の形は、Cloudflareへ接続していないため、最初のstagingのデプロイで確かめる。
  - `gh pr list --head <ブランチ>`はブランチ名だけで絞り込み、フォークの同名のブランチからのPRも返す。`--json isCrossRepository`で同じリポジトリのPRを見分けられる。`gh`は`persist-credentials: false`のチェックアウトでも残る`origin`のURLからリポジトリを解決する。
  - Infisical CLIのリリースのチェックサムのファイルは`checksums.txt`である(`cli_<版>_checksums.txt`ではない)。CLIのログインのJWTは`--jwt=<JWT>`の引数で渡した(環境変数で渡せるかは確かめていない)。
  - Playwright 1.64.1の`--grep`は、依存のsetupプロジェクト(到達確認)を絞り落とさない。どのテストにも合わない`--grep`ではsetupも外れて0件になり、`--pass-with-no-tests`で成功する。`--grep @smoke --list`は到達確認2件と疎通確認23件の25件である。`verify`はこのため`--list --reporter=json`のタグで`@smoke`の件数を数え、0件を失敗にする(「Decision: 9.1後の任意の強化」)。
  - `Bun.Glob`は、波括弧の中に`/`を含むパターン(`apps/infra/{live,modules/*}/*.tf`)で0件を返す。パターンを分ける。
  - Bunの型定義では`expect().rejects`が待てる値(Promise)を返さないため、`await expect(...).rejects`が静的解析の違反になる。拒否の確認は補助関数(`test-fixtures/rejection.ts`)で書く。
  - `wrangler dev`はworkerdを孫プロセスとして起動するため、子プロセスだけへのシグナルでは止まらない。`Bun.spawn`の`detached: true`で新しいプロセスグループを作り、グループへシグナルを送ると止まる。
  - `HttpProbe`はリダイレクトを追わず(`redirect: 'manual'`)、待ち合わせる対象の状態コードそのものを見る。
  - 2026-10-29時点の実リポジトリで`bun audit --audit-level=high`は終了コード1(api 9・event 9・frontend-lib 4(critical 1)・client 10・admin 10件。zod・undici・sharp・Storybook・launch-editor)。開発者は対応を保留した(tasks 4.1)。
- **Implications**: いずれもdesign.mdの該当するコンポーネントの記述へ反映した。CIのランナーとstagingで初めて確かめられる事項は、tasks 9.1の報告で開発者の手作業として挙げた。

### 参照したスキル

- `cloudflare:wrangler`: APIトークンは操作に必要な最も狭い範囲にする、`wrangler secret put`は新しい版を即時にデプロイする、ロールバックの前に制約を確かめる。
- `ecc:deployment-patterns`: 環境ごとの設定はシークレット管理サービスから注入する、ロールバックの手順をstagingで試す、ヘルスチェックによるデプロイ後の確認。

## Architecture Pattern Evaluation

| Option                                        | Description                                                              | Strengths                                                                    | Risks / Limitations                                                         | Notes  |
| --------------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------ |
| 単一のルートと環境ごとのbackend設定・資源一覧 | `apps/infra/live`を1つにし、`init`のbackend設定と`environment`変数で選ぶ | stagingとprodの定義が食い違わない。prodの定義をstagingの運用で毎回検査できる | 環境を切り替えるたびに`init -reconfigure`が要る(CIは毎回新しい環境)         | 採用   |
| 環境ごとのルートディレクトリ                  | `envs/staging`・`envs/prod`に同じ内容を置く                              | 環境ごとに独立して変えられる                                                 | 内容の複製が食い違う                                                        | 不採用 |
| Terragruntなどのラッパー                      | 環境ごとの設定をラッパーで生成する                                       | 大規模な構成に強い                                                           | 新しいツールの導入と保守。資源の数が少なく利点が小さい                      | 不採用 |
| Wranglerの`routes`でカスタムドメインを作る    | Wrangler設定に`custom_domain: true`を書く                                | Workerの作成と同時に作れる                                                   | Wrangler設定は上流specが所有する。briefがOpenTofuでの管理を求めている       | 不採用 |
| 開発コンテナのイメージでCIを動かす            | Dockerfileをビルドし、ジョブを同じイメージで実行する                     | ツールの版が完全に一致する                                                   | ビルドの時間とキャッシュの管理。ホステッドランナーのsetupアクションで足りる | 不採用 |

## Design Decisions

### Decision: 資源一覧をJSONで持ち、OpenTofuとTypeScriptで共有する

- **Context**: 要件1.2・1.10・11.1〜11.4。資源の名前は上流specのWrangler設定と一致する必要があり、後続specが資源を追加する。
- **Alternatives Considered**:
  1. HCLの`locals`に書く — 構成検査(TypeScript)からHCLを解析する必要がある。
  2. tfvarsファイル — Claude設定が`*.tfvars*`の読み書きを拒否し、AIエージェントが編集できない。
  3. `apps/infra/environments/<環境>.json` — OpenTofuは`jsondecode(file())`で、TypeScriptは`JSON.parse`で読める。
- **Selected Approach**: 3。資源の名前・識別子・管轄・ホスト名・Infisicalのプロジェクトと主体・GitHubのEnvironmentを1ファイルにまとめる。秘密値は含めない。
- **Trade-offs**: JSONはコメントを書けないため、各項目の意味はdesign.mdの型定義と技術ドキュメントに書く。

### Decision: 4つの子モジュールと2段階の適用

- **Context**: 要件1.1・1.9・1.10・7.3。カスタムドメインはWorkerの存在が前提で、データを持つ資源は削除を防ぎたい。
- **Selected Approach**: `storage`(D1・R2)・`messaging`(Queues)・`edge_services`(Turnstile・Web Analytics・送信ドメイン)・`worker_routing`(カスタムドメイン)に分ける。1回目の適用は`-exclude=module.worker_routing`、Workerのデプロイの後に2回目の全体の適用を行う。`storage`と`edge_services`のTurnstileは`prevent_destroy`を持つ。
- **Rationale**: 変更の頻度と影響(データの消失・公開URL)でモジュールを分けると、後続specの追加先が明確になり、除外の指定がモジュール単位で済む。

### Decision: シークレットの2つの経路

- **Context**: 要件3.2・4.1〜4.7。OpenTofuの暗号化の鍵とbackendの認証情報は`tofu init`の前に必要で、`ephemeral`リソースから得られない。
- **Selected Approach**:
  - 起動前に要る値(stateのパスフレーズ・stateの保管先のR2トークン)と、Wranglerが使う値(`CLOUDFLARE_API_TOKEN`)は、Infisical CLIの`infisical run`で、そのコマンドだけの環境変数として渡す。
  - OpenTofuのCloudflare providerの資格情報は、`ephemeral "infisical_secret"`で取得する(stateと計画に残らない)。
  - Workerの実行時のシークレットは、デプロイのスクリプトが`infisical export`で取り出してメモリに持ち、`wrangler deploy --secrets-file`へ渡す。対象はWrangler設定の`secrets.required`と、スクリプトの任意のシークレットの一覧に限る。
  - Infisicalのフォルダは、Workerの実行時のシークレット(`/`)、OpenTofuの起動前の値(`/ci/tofu`)、Cloudflareのトークン(`/ci/cloudflare`)に分け、各コマンドに必要なフォルダだけを渡す。
- **Trade-offs**: 同じCloudflareのトークンを2つの経路で受け取るが、OpenTofuの経路はbriefと`security/001`の決定(`ephemeral`とOIDC)に従う。

### Decision: stateの保管先の鍵は環境変数で渡す(2026-10-29に開発者が決定)

- **Context**: 要件3.1・4.7、tasks 2.3。設計では`backend "s3"`の`access_key`・`secret_key`を`sensitive`な変数(`TF_VAR_state_access_key_id`・`TF_VAR_state_secret_access_key`)で受けるとしていた。OpenTofu 1.13.2で`tofu init`(backendあり)を実行すると、`Error: Backend config contains sensitive values`で拒否された。表示された理由は、backendの設定が`.terraform/terraform.tfstate`と計画ファイルに保存されるため、秘密の資格情報はbackend専用の環境変数で渡すよう推奨する、というものだった。`init -backend=false`・`tofu validate`・`tofu test`ではこの失敗は現れない。
- **Alternatives Considered**:
  1. backend専用の環境変数`AWS_ACCESS_KEY_ID`・`AWS_SECRET_ACCESS_KEY`で渡し、backendの設定に鍵を書かない
  2. 変数のまま`sensitive`を外す(鍵が`.terraform/terraform.tfstate`に平文で残り、要件4.7の「リポジトリ内のファイルに書き出さない」と衝突する)
- **Selected Approach**: 1。ルートモジュールの変数は`environment`と`state_passphrase`(`sensitive`のまま。暗号化の設定は`sensitive`な変数を受け付ける)だけにし、Infisicalの`/ci/tofu`のキーを`TF_VAR_state_passphrase`・`AWS_ACCESS_KEY_ID`・`AWS_SECRET_ACCESS_KEY`にする。
- **Rationale**: OpenTofuの推奨に従い、鍵を作業ディレクトリのファイルにも計画にも残さない。
- **Follow-up**: スクラッチのコピーで、接続先を`http://127.0.0.1:9`、鍵を環境変数のダミーにして`tofu init`を実行した。sensitiveのエラーは出ずに接続の段階まで進んだ(接続の拒否で終了)。パスフレーズが無いときは暗号化の設定を解決できずに失敗する(3.3)。

### Decision: preflightでCloudflareのアカウントID・ゾーンIDの仮の値を止める(2026-10-29に開発者が決定)

- **Context**: 要件8.3、tasks 1.2・5.1。資源一覧の`cloudflare.accountId`・`zoneId`とbackendの部分設定の`endpoints.s3`は全桁0の仮の値で、設計の初回の準備に記入の手順が無かった。仮の値のまま進むと、stateの保管先への接続か資源の作成で、原因の分かりにくい失敗になる。
- **Alternatives Considered**:
  1. `preflight`で仮の値を止め、記入先のファイルを示す
  2. `tofu`の初期化・計画の失敗に任せる
- **Selected Approach**: 1。`preflight`は`isPlaceholderId`でアカウントID・ゾーンIDを判定し、アカウントIDは資源一覧と`apps/infra/backends/<env>.s3.hcl`の`endpoints.s3`、ゾーンIDは資源一覧を記入先として示して失敗する。prodでは主体のIDと同じく「launch-readinessの準備が必要」を加える。初回の準備の手順5に、stagingの資源一覧とbackendの部分設定へ記入する作業を加えた。
- **Rationale**: デプロイの最初の段階で、開発者の次の作業(どのファイルへ何を記入するか)を示せる。
- **Follow-up**: 構成検査のC7は、資源一覧のアカウントIDが仮でbackendの接続先がR2の形の時に違反としないため、両方が仮の間はこの検査だけが止める。

### Decision: 適用が失敗した時だけOpenTofuの診断を表示する(2026-10-29に開発者が決定)

- **Context**: 要件4.7・7.12、tasks 5.1。適用の出力を資源の行と完了の行だけに絞ると、適用が失敗した時に原因(`Error:`の診断)が表示されず、失敗した手順と終了コードしか分からなかった。
- **Alternatives Considered**:
  1. 適用が0以外で終わった時に限り、取り込んだ標準エラー出力(誤りの診断)を表示する
  2. 常に資源の行と完了の行だけにし、原因はCIの外での操作で調べる
- **Selected Approach**: 1。計画・`show -json`の失敗時と同じ扱いにする。成功時は従来どおり資源の行と完了の行だけを表示する。
- **Rationale**: 開発者がCIのログだけで失敗の原因を判断できる。
- **Follow-up**: OpenTofu 1.13.2の出力の向きをスクラッチの構成で確かめた。`-no-color`の`tofu plan`で、誤りの診断(`Error:`の塊)は標準エラー出力へ、計画の本文・警告(`Warning:`の塊)・「Planning failed.」の行は標準出力へ出た。警告の診断は`sensitive`でない属性の値を引用するため(例: `terraform_data.x.input is "..."`)、標準出力は失敗時も表示しない。誤りの診断も`sensitive`でない値を引用し得るが、`sensitive`な値は`(sensitive value)`と伏せられる。`tofu apply`はClaude設定のdenyで実行できなかったため、適用の診断も同じ向きであること(OpenTofuの同じ診断の表示の部品を使う)は、最初のstagingのデプロイで開発者が確かめる。

### Decision: デプロイのワークフローの直列化・順序・Chromiumの導入(2026-10-30に開発者が決定)

- **Context**: tasks 6.4のレビュー。`deploy.yml`のジョブの`concurrency`だけでは、同じブランチへ続けてpushした時に検査が並行に走り、古いコミットの検査が後に終わると古い版が新しい版の後にデプロイされ得た。また`infisical-login`を`preflight`より前に置くと、主体のIDが仮の値の時にログインの失敗で止まり、`preflight`の仮の値の案内に届かなかった。prodの確認はヘルスチェックだけで、Chromiumを使わない。
- **Selected Approach**:
  1. `delivery.yml`の最上位に`concurrency: { group: delivery-${{ github.ref_name }}, cancel-in-progress: false }`を置き、同じブランチの検査とデプロイを到着順に直列にする。
  2. `deploy.yml`の順を`preflight`→`infisical-login`にする。`infisical-login`には`id`を付けず、`id`の並びは`DEPLOY_STAGES`のまま保つ(W8)。
  3. Chromiumの導入は`if: inputs.environment == 'staging'`でstagingだけにする。
- **Rationale**:
  1. 古いコミットが後からデプロイされると、古いIaCの適用で新しいコミットが加えた資源が消え得る。直列にすれば古い実行が新しい実行の後に走らない。GitHubの`concurrency`の待機は1件だけで、待機中の古い実行は新しい実行の到着で取り消されるが、新しいコミットは古いコミットを含むため、取り消しで失われる変更は無い。
  2. `preflight`は秘密値を使わないため、ログインより先に実行しても秘密値の扱いは変わらない。仮の値の案内(Infisicalの識別子・CloudflareのアカウントID・ゾーンID)をまとめて出してから止められ、5.1の決定の意図に合う。
  3. スモークテストを実行するのはstagingだけのため、prodのデプロイで不要な取得と実行時間を省く。`if:`の式は`run`への展開でないため、W6の対象外である。

### Decision: 9.1後の任意の強化(2026-10-30に開発者が決定)

- **Context**: tasks 9.1の報告で、実装しなかった任意の強化を開発者の判断事項として挙げた。開発者は次の4件を採用し、2件を採用しなかった。
- **Selected Approach(採用)**:
  1. `verify`は、stagingのスモークのE2Eの前に同じ絞り込みと環境変数で`bun run test:e2e --grep @smoke --list --reporter=json`を取り込み、`@smoke`のタグを持つテストを数え、0件なら絞り込みと理由を標準エラーと手順の要約に示して終了コード1で失敗する。一覧の作成の失敗・読めない形も実行せずに失敗にする。
  2. 手順を持つ全ジョブに`timeout-minutes`を付ける(`checks.yml`はsecret-scan 15・quality 30・tests 30・e2e 45・rehearsal 30・ci-gate 5、`release-pr.yml`は10。`deploy.yml`は既存の60)。`release-pr.yml`は`env`に`GH_REPO: ${{ github.repository }}`を加え、ジョブに`if: github.ref == 'refs/heads/main'`を付ける。
  3. `live.tftest.hcl`で、両環境の`web_analytics_host`・`email_sending_domain`・`account_id`・`zone_id`・`jurisdiction`が資源一覧どおりに各モジュールへ渡ることを確かめる。`migrate`・`deploy-worker`(デプロイ・ビルド・直前のリリースの読み取り)・`ensure-email-subscription`のWranglerの子プロセスへ、資源一覧の`cloudflare.accountId`を`CLOUDFLARE_ACCOUNT_ID`として`CLOUDFLARE_API_TOKEN`と並べて渡す。
  4. `repo-contract.unit.test.ts`のHCLの検査の探索を`apps/infra/**/*.tf`(`.terraform/`配下を除く)へ広げ、resourceブロックの外ではTurnstileの資源の`secret`への参照と資源全体の参照を全面的に禁じる。
- **採用しなかった項目**:
  1. TruffleHogのアクションはコミットSHA、イメージはタグ`3.99.2`のまま固定し、ダイジェストで固定しない(要件11.5・W1のとおり)。
  2. 子プロセスへの`INFISICAL_TOKEN`の引き継ぎは今のまま維持する(設計が受け入れたリスク。Security Considerationsの「アクセストークンの受け渡し」)。
- **Rationale**:
  1. `test:e2e`は`--pass-with-no-tests`付きのため、タグの付け忘れや絞り込みの誤りで0件になってもスモークテストが成功してしまう。Playwright 1.64.1の`--grep`は依存のsetupプロジェクト(到達確認)を絞り落とさず、`--list`の「Total: 25 tests in 3 files」も到達確認の2件を含む。合計から到達確認の件数を引く方法は対象のアプリの数に依存するため、JSONの報告の`specs[].tags`(先頭の`@`を除いた`smoke`)を持つテストを数える。`--list`はテストを実行せず、`E2E_CLIENT_URL`・`E2E_ADMIN_URL`が無くても既定のURLで一覧を作れる(実行と同じ値を渡して設定をそろえる)。どのテストにも合わない`--grep`では`suites`が空になり0件と数える。
  2. 止まった子プロセス(待ち合わせ・ブラウザ・Wrangler)がランナーとOIDCのトークンの有効な時間を使い続けないようにする。`workflow_dispatch`は任意のブランチを選んで起動でき、チェックアウトしたそのブランチの配布のスクリプトを`pull-requests: write`の権限で実行するため、mainから起動した時だけ動かす(hotfixのブランチは入力`head`で選べる)。ワークフローの定義そのものを書き換えたブランチからの起動は`if`では防げず、pushの権限を持つ者の操作として受け入れる。`gh`の操作先をチェックアウトの`origin`のURLに頼らず明示する。いずれも`run`への展開でないため、W6の対象外である。
  3. `tofu test`のassertは子モジュールの変数・資源を参照できず、出力だけを参照できる(OpenTofu 1.13.2で`module.<名前>.<資源>`の参照が「Unsupported attribute」になることを確かめた)。そのため各モジュールに、計画した資源の属性から読む出力`placement`を加えた。子モジュールの出力はルートの出力に含めないため、状態の出力と`reconcile-ids`に影響しない。誤った結線(取り違え・別の値)を一時的に入れて、両環境のテストが失敗することを確かめた。ただし資源一覧のアカウントIDとゾーンIDが同じ仮の値(全桁0)の間は、`live`のテストでは両者の取り違えを区別できない(各モジュールのテストは異なる値で確かめる)。アカウントIDは、トークンが複数のアカウントに届いてもWranglerが操作先を選べるように渡す。秘密値ではないがトークンと同じ経路で渡す。仮の値は`DEPLOY_STAGES`の先頭の`preflight`が止めるため、各コマンドでは重ねて確かめない。`rehearse`はトークンを使わない`--dry-run`のため渡さない。
  4. 波括弧の中に`/`を含むパターンは`Bun.Glob`で0件になるが、`**`のパターンは深い場所のファイルと`.terraform/`配下(`dot: true`のため)の両方を返す。`.terraform/`は`tofu init`が取得したモジュールの写しで、リポジトリの定義ではないため除く。出力だけを見る検査は`local`や`module`の引数を経由した出力を検出できないため、参照の起点を禁じる。資源全体の参照も`secret`の属性を含むため同じく禁じる。
- **Trade-offs**: `verify`はPlaywrightのJSONの報告の形(`suites`・`specs`・`tags`・`tests`・`errors`)に依存し、形が変わると「数えられない」として失敗する(安全側)。Playwrightの版を上げる時に確かめ直す。

### Decision: 直前のリリースはWorkerの版のタグで特定する

- **Context**: 要件7.4・7.5、api-gateway Q3(新しいリソースを使わない)。
- **Alternatives Considered**:
  1. GitHub Deploymentsの記録 — Environmentを使うジョブが自動で作るが、ロールバック(`wrangler rollback`)を反映しない。
  2. Workerの版のタグ — デプロイ時に`--tag <コミット>`を付け、現在稼働している版のタグを読む。
- **Selected Approach**: 2。clientのWorkerの現在の版(配信率100%)のタグを読み、40桁の16進でリポジトリに存在するコミットなら`graphql:allowlist --previous-ref`に渡す。clientとadminは同じコミットからデプロイするため、clientだけを読む。
- **Rationale**: 実際に稼働しているフロントエンドの操作を許可するという目的に直結し、ロールバックの後も正しい。

### Decision: リリースのPRとコードオーナーによる承認の保証

- **Context**: Q5・要件9。
- **Selected Approach**:
  - `release-pr.yml`(手動起動)が`GITHUB_TOKEN`で`main`または`hotfix/<名前>`からprodへのPRを作る。作成者はbotなので、開発者が承認できる。
  - CODEOWNERSで全ファイルのコードオーナーを開発者にし、prodのルールセットで「コードオーナーの承認」「承認数1」「push時に古い承認を取り消す」「必須チェック`checks / ci-gate`」を有効にする。botはコードオーナーになれないため、ワークフローの承認は条件を満たさない。
  - 必須チェックは、PRのheadのコミットに対するpush(mainへのマージ、`hotfix/**`へのpush)の検査結果で満たす(botのPRは新しいワークフローを起動しないため)。
  - prodへのデプロイのジョブは、Environment`prod`(デプロイ対象をprodブランチに限る)とprodの主体(subjectと`job_workflow_ref`で縛る)でだけシークレットに届く。
- **Rejected**: 承認者が人間であることを確かめる独自の必須チェックのジョブ。コードオーナーの規則と効果が重なり、`pull_request_review`での起動とチェックの名前の偽装への対策で構成が複雑になる。
- **Follow-up**: 最初のリリースのPRのベース(prod)にはCODEOWNERSが無い。最初のマージでCODEOWNERSがprodへ入った後に、prodのルールセットの「コードオーナーの承認」が効くことを確かめる。

### Decision: 構成検査とワークフローの検査をTypeScriptで自作する

- **Context**: 要件11。
- **Alternatives Considered**: actionlint(新しいツールの導入が必要)、Wranglerの`unstable_readConfig`(ルートはWranglerを依存に持たず、Bun Workspacesを使わない)。
- **Selected Approach**: `Bun.JSONC.parse`と`Bun.YAML.parse`で読み、確かめる規則(管轄・公開URL・名前の一致・SHAの固定・権限・段階の順序・ツールの版)だけを実装する。Wranglerの環境の継承は、検査に使うキーに限って再現する。
- **Trade-offs**: Wranglerの継承の規則の全体は再現しない。対象のキーを増やすときは継承の扱いを確かめる。

### Generalization・Build vs Adopt・Simplification

- **Generalization**:
  - 資源の追加は「資源一覧のmapに項目を足す」に一般化し、Queue・R2・カスタムドメインを`for_each`で作る。後続specはHCLを書き換えずに資源を追加できる。
  - 構成検査は、特定のバインディング名の表ではなく「Wrangler設定のstaging・prodが参照するすべてのD1・R2・Queue・Service Bindingsの名前が資源一覧にあり、資源一覧の資源がどれかのWorkerから参照される」という双方向の照合にする。
  - デプロイの段階は1つの定数(`DEPLOY_STAGES`)で表し、ワークフローの手順の順序と照合する。
- **Build vs Adopt**:
  - 採用: OpenTofu・Cloudflare provider・`infisical` provider、Infisical CLI、Wrangler、TruffleHog(公式のアクション)、Mailpit(公式の配布物)、`bun audit`、GitHubのルールセット・Environment・OIDC。
  - 自作: `scripts/delivery`のスクリプト(Infisicalのログイン・OpenTofuの実行と計画の要約・識別子の照合・Workerのデプロイ・購読の確認・デプロイ後の確認・E2Eの起動・カバレッジの合算・構成検査・リリースのPR)。いずれもCLIの呼び出しと判定の組み合わせで、既製品はこの組み合わせに合わない。
  - 不採用: 汎用REST APIのprovider(Q7)、Terragrunt、actionlint、Infisicalの公式アクション`Infisical/secrets-action`(全シークレットを以降の全手順の環境変数に出すため、手順ごとにフォルダを絞れない)。
- **Simplification**:
  - ルートは1つにし、環境はbackend設定と変数で選ぶ。
  - stagingとprodで1つのワークフロー(`deploy.yml`)を使い、環境を入力で選ぶ。
  - 承認者の検査ジョブ、OpenTofuによるリポジトリ設定のコード化、送信ドメインのDNSの重複定義は作らない。

## Risks & Mitigations

- **ワークフローの承認を許可する設定**(Q5で残るリスク): リポジトリ設定「GitHub ActionsにPRの作成と承認を許可」を有効にすると、`pull-requests: write`を持つワークフローは他人のPRを承認できる。緩和: botはコードオーナーになれないため、コードオーナーの承認を必須にしたprodでは条件を満たさない。ワークフローの既定の権限を読み取りにし、`pull-requests: write`は`release-pr.yml`だけに与え、構成検査で確かめる。mainは承認数0のため、この設定でmainの保護は弱まらない。
- **AIエージェントが開発者の認証情報で承認する**: 開発コンテナの`gh`は開発者の名義で、`gh pr review --approve`と`gh api`(マージのAPIを含む)が拒否されていない。botが作ったprodのPRを開発者の名義で承認・マージできてしまう。緩和: `Bash(gh pr review*)`・`Bash(gh api*)`をClaude設定のdenyへ加えるよう開発者に依頼し、承認とマージはGitHubの画面で人間が行う運用を文書化する。設定が入るまでは残存リスクとして扱う。
- **同じアカウントのCloudflareのトークン**(K5): 承認数0のmainへマージされたコードは、stagingのトークンで実行され、同じアカウントのprodの資源にも権限が及ぶ。緩和: prodのデータの資源は`prevent_destroy`、D1はTime Travel、トークンの値はマスクして表示しない、ワークフローの変更はPRで開発者が確認する。
- **Queuesの管轄とメールイベントの購読**(K1): 管轄付きのQueueへEmail Sendingのイベントが届くかが未確認である。緩和: stagingの最初のデプロイで、購読の作成と配信不能イベントの到達を確かめる手順を置く。届かなければK1を「管轄を指定しない」へ切り替え(Queueは作り直す。メッセージは一時的なもの)、準拠方針とプライバシーポリシー骨子のCloudflareの項(Queuesを所在を限定しない処理へ移す)を改める。
- **国外移転の根拠の前提**(N-1): DPFは、Cloudflareの認証の継続と、EU-USの十分性認定の有効性を前提にする。また、所在を限定しない処理は米国以外の国のデータセンターでも行われ得る。DPFは米国への移転の仕組みのため、この部分にどの根拠が当たるかは骨子の範囲では決めていない。緩和: 骨子には開発者の決定どおり「DPFを主とし、無効になった場合はDPAに含まれるSCCに拠る」と書く。法務文書の本文を用意するときに、開発者がDPFの認証の一覧でのCloudflareの状況と、DPAに含まれるSCCが米国以外の処理を含むかを確かめる。全委託先に共通の「移転の法的根拠」の行も同じ根拠に改める(R3-6)ため、項を持たないStripe・SentryのDPFの認証とDPAのSCCも、同じときに開発者が確かめる。
- **APIによる送信ドメインの登録とDNSレコード**: OpenTofuで登録したときに`cf-bounce`のMX・SPF・DKIMと`_dmarc`のレコードが作られない場合がある。緩和: stagingの最初の適用の後にレコードを確かめる。作られなければ、送信ドメインの資源の計算値(`dkim_selector`・`return_path_domain`)とEmail ServiceのAPIで得た値から`cloudflare_dns_record`を`edge_services`に加える。
- **`--secrets-file`への標準入力**: Wranglerが`/dev/stdin`を読めない場合、シークレットを一時ファイルに書く必要がある。緩和: 実装時に確かめ、読めなければ`$RUNNER_TEMP`に権限0600のファイルを作り、`finally`で消す(ランナーはジョブごとに破棄される)。この場合は`security/003`に例外として記載する。
  - 確認の結果(2026-10-30、tasks 5.3): Wrangler 4.124.0の`--secrets-file`は、`path.resolve`したパスを`readFileSync`で読み、JSONとして解析できなければ.env形式として読む。`bun x wrangler`はWranglerをNodeで動かすため、`CommandRunner`の`stdin`(パイプ)で渡した内容をNodeの`readFileSync(path.resolve('/dev/stdin'))`で読めること(約200KBまで)を開発コンテナのLinuxで確かめた。代替の一時ファイルは採用せず、`security/003`への例外の記載も要らない。`wrangler deploy`そのものはClaude設定のdenyで実行していないため、最初のstagingのデプロイで、シークレットが版に反映されることを確かめる。
- **Wranglerの自動作成**: 資源の識別子が無いバインディングは、`wrangler deploy`が資源を自動で作る。管轄の無いR2などが黙って作られる。緩和: デプロイの前にOpenTofuの適用と構成検査(全バインディングが資源一覧にある)を必ず通す。
- **1つのプロジェクトで全環境を読める主体**(K3で受け入れたリスク): FreeプランのViewerはプロジェクト全体に効くため、`ci-checks`・`ci-deploy-staging`・`ci-deploy-prod`のどれもがdev・staging・prodのすべてのシークレットを読める。同じリポジトリへブランチをpushできる者(開発者と、開発者の認証情報を使うAIエージェント)は、ワークフローを書き換えたPRの検査で`ci-checks`として認証し、stagingとprodの値を読み出せる。承認数0のmainへマージされたコードも、stagingのデプロイの主体でprodの値を読める。Freeプランでできる緩和:
  - prodの値はlaunch-readinessがリリース時に登録する(Q6)。それまでprodの環境は空で、読み出せる値が無い。
  - 主体のOIDCの縛りを保つ。`ci-deploy-prod`はEnvironment`prod`のsubject・`deploy.yml@refs/heads/prod`の`job_workflow_ref`・Environmentのデプロイ対象ブランチ(prod)で縛り、ほかのワークフローとブランチからはその主体で認証できない。フォークのPRと他のリポジトリには、どの主体のトークンも渡らない。
  - 各コマンドは自分の範囲の環境(検査はdev、デプロイはその環境)だけを取り出し、取り出した値を使う前にマスクする。
  - 機械の主体はViewerで書き込めず、アクセストークンの有効期限を短くし、長期の認証情報を作らない。
  - 主体は範囲ごとに分けてあるため、Proプランへ上げれば、各主体に環境ごとのロールを割り当てるだけで環境を分離できる。
  - ワークフローと`scripts/delivery`の変更は、PRの差分で開発者が確かめる。
- **Viewerロールの割り当て**: FreeプランでViewerを機械の主体に割り当てられない場合、CIの主体が書き込めてしまう(Q7)。緩和: 初回の準備で確かめ、割り当てられなければ開発者に報告して判断してもらう。
- **Infisicalの監査ログが無い**: Freeプランでは読み取りの記録が残らない。緩和: 主体をOIDCのクレームで狭く縛り、長期の認証情報を作らない。
- **providerのドリフトの不具合**(roadmapの指摘): Cloudflare provider v5はドリフトの報告が続く。緩和: 版を完全に固定し、計画の要約で想定外の`update`・`replace`を確かめ、`prevent_destroy`で消失を止める。
- **カスタムドメインの証明書の発行待ち**: 初回は証明書の発行に時間が掛かり、デプロイ後の確認が失敗し得る。緩和: 確認は`/health`の200を最大10分待ってから行う。
- **公開リポジトリのログ**: Actionsのログは誰でも読める。緩和: Infisicalから受け取った値を起動時に`::add-mask::`で伏せ、計画は要約だけを出し、`tofu output`の値は秘密でない識別子だけを扱う。
- **空のWorkerごとのフォルダの取り出し**(改訂1): `infisical export --path`が空のフォルダで空の一覧を返すか、存在しないフォルダで失敗するかは版で確かめていない。緩和: フォルダは初回の準備とlaunch-readinessで必ず作り、4.3の実装でCLIの挙動を確かめて、空のフォルダは空の一覧、取り出しの失敗はフォルダの名前だけを出して止める扱いに合わせる。4.3で、存在しないフォルダは終了コード1で失敗することを確かめ、`[]`と`null`の両方を空の一覧として扱った。空のフォルダの出力が`[]`であることは、devのフォルダの作成後(2026-10-30)に確かめた(「InfisicalのCLIのフォルダの取り出し」)。

## References

- [R2 Data location](https://developers.cloudflare.com/r2/reference/data-location/) — 管轄・S3の接続先・制約
- [D1 Data location](https://developers.cloudflare.com/d1/configuration/data-location/) — 管轄とロケーションヒント
- [Queues Data location](https://developers.cloudflare.com/queues/configuration/data-location/) — Queueの管轄
- [Dead Letter Queues](https://developers.cloudflare.com/queues/configuration/dead-letter-queues/) — デッドレターの管轄の一致
- [Durable Objects Data location](https://developers.cloudflare.com/durable-objects/reference/data-location/) — `jurisdiction("us")`
- [Custom Domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/) — カスタムドメインの前提
- [Wrangler Configuration](https://developers.cloudflare.com/workers/wrangler/configuration/) — ルートの管理の境界・`secrets`
- [Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/) — `--secrets-file`
- [Rollbacks](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/) — ロールバックの制約
- [Email Service Domains](https://developers.cloudflare.com/email-service/configuration/domains/) — 送信ドメインのDNSレコード
- [Email Sending Event subscriptions](https://developers.cloudflare.com/email-service/reference/event-subscriptions/) — 購読のイベント
- [Queues Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/queues/) — 購読の作成と一覧
- [OpenTofu State and Plan Encryption](https://opentofu.org/docs/language/state/encryption/) — 暗号化の設定
- [OpenTofu plan](https://opentofu.org/docs/cli/commands/plan/) — `-exclude`
- [Infisical OIDC Auth for GitHub](https://infisical.com/docs/documentation/platform/identities/oidc-auth/github) — 主体の縛り方
- [Infisical Pricing](https://infisical.com/pricing) — Freeプランの制約
- [Infisical Role-based access controls](https://infisical.com/docs/documentation/platform/access-controls/role-based-access-controls) — 組み込みのロール

---

## 実装前のギャップ分析(2026-10-29)

`/cc-sdd:kiro-validate-gap`による再分析である。設計時(2026-10-18)は上流の5spec(dev-tooling・backend-platform・api-gateway・email-delivery・frontend-platform)が未着手だったが、本日時点で5specのタスクはすべて完了している(dev-tooling 47件・backend-platform 57件・api-gateway 52件・email-delivery 34件・frontend-platform 97件)。本節は、設計とタスクが前提にした上流の成果物を実装済みのコードと照合し、食い違いと未決の点を挙げる。`apps/infra`・`.github`・`scripts/delivery`は未作成で、本specのタスク44件はすべて未着手である。

### 分析の範囲と前提

- `.kiro/steering`には`roadmap.md`だけがあり、`product.md`・`tech.md`・`structure.md`が無い。プロジェクトの文脈はCLAUDE.md・tech-stack.md・`docs/onboardings/project-values.md`から補った。
- Cloudflare・Infisical・GitHubの外部仕様は設計時の調査(本書の「Research Log」)から変えていない。版の固定(Cloudflare provider 5.27.0・`infisical` provider 0.19.38)は本日も公開から2週間以上の条件を満たす。

### 設計の前提どおりだった項目

| 前提                                                                                                                                                                                                             | 確かめた場所                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 資源の名前(D1 1つ・R2 3つ・Queue 3つ・Worker 4つ)と、Wranglerの環境による`-staging`・`-prod`の接尾辞、Service Bindingsの接続先                                                                                   | 4アプリの`wrangler.jsonc`・`project-values.md`の「Workerとリソースの名前と識別子」     |
| staging・prodの識別子の仮の値(D1の`database_id`・`TURNSTILE_SITE_KEY`・`WEB_ANALYTICS_TOKEN`)と、`workers_dev`・`preview_urls`・R2の`jurisdiction`・`routes`が未記載であること                                   | 同上                                                                                   |
| stagingの`secrets.required`(`HASH_PEPPER`・`TURNSTILE_SECRET_KEY`・`SENTRY_DSN`・`EMAIL_ALLOWED_RECIPIENTS`)が「Infisicalのフォルダとキー」の表と一致すること                                                    | 同上                                                                                   |
| ルートの`check`・`test:all:{unit,browser,worker}`・`test:e2e`・`test:e2e:dev-and-preview`・`shared-dirs:place`                                                                                                   | ルートの`package.json`                                                                 |
| apiの`cf-typegen:check`・`graphql:check`・`graphql:allowlist`(`--previous-ref`を省くと警告を出して現行の操作だけで生成する)・`db:migrations:check`・`test:smoke`・`db:migrate:local`                             | `apps/api/package.json`・`apps/api/scripts/graphql/build-allowlist.ts`                 |
| カバレッジの出力先`coverage/{unit,browser,worker}/lcov.info`(アプリごと)                                                                                                                                         | `bunfig.toml`・`apps/*/bunfig.unit.toml`・`config/vitest/test-kind-preset.ts`          |
| `CHROMIUM_PATH`が無い環境ではPlaywrightが導入したブラウザを使うこと                                                                                                                                              | `config/vitest/browser.ts`の`resolveBrowserLaunchOptions`                              |
| E2Eの対象のURLを`E2E_CLIENT_URL`・`E2E_ADMIN_URL`で切り替えられること(スモークテストの宛先に使う)                                                                                                                | `e2e/support/targets.ts`                                                               |
| 開発コンテナのOpenTofu 1.13.2・Wrangler 4.152.0・Infisical CLI 0.44.8・Playwright 1.64.1・Mailpit 1.32.0・Bun 1.4.4                                                                                              | `Dockerfile`の`ARG`                                                                    |
| Claude設定の拒否(`*tofu apply*`・`*wrangler deploy*`・`*wrangler secret*`・`gh workflow run*`・`gh pr merge*`・`infisical secrets set*`など)                                                                     | `.claude/settings.json`                                                                |
| `*.tfstate`・`.terraform`・`coverage`がGit管理外であること                                                                                                                                                       | `.gitignore`                                                                           |
| 追記先の既存文書の現状(シークレット管理の文書に`ephemeral`とOIDCの節がある、骨子の共通の行が「標準契約条項等の該当するもの」のまま、文書番号`infra/005〜007`・`operations/001〜002`・`security/003`が空いている) | `docs/GUIDES/tech/security/001-secret-management.md`・`docs/GUIDES/service/legal/`ほか |

### 要件と既存の資産の対応(食い違いと未決の点)

凡例: **Missing**は設計またはタスクに無いもの、**Constraint**は既存のコードが課す制約、**Unknown**は確かめが要るもの。

| #   | 要件          | 種別       | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --- | ------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| G1  | 11.5・6.4     | Constraint | 開発コンテナのNodeは26.12.1(`Dockerfile`の`NODE_VERSION`、tech-stack.mdも「Node.js v26」)で、設計の「Node 24」と食い違う。11.5は開発コンテナとの版の一致を求めるため、CIのNodeは26.12.1にする必要がある。あわせて、tech-stack.mdのとおりBun上の`wrangler dev`はHTTPに応答しないため、CIのE2Eの起動(`e2e-stack`)もWranglerをNodeで動かす前提になる                                                                                                                                                                                                                                                                                                                                    |
| G2  | 11.5          | Constraint | 開発コンテナはMailpitを「チェックサムが非公開のため未検証で取得する」。設計の「Mailpitは公式の配布物をSHA-256で検証して導入」は、公式のチェックサムが無いと成り立たない                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| G3  | 5.2・5.6      | Constraint | ルートの`check`(`scripts/tooling/run-all.ts`の`CHECK_STEPS`)は、`shared-dirs:verify`・テストの命名・整形・静的解析に加え、全アプリの`cf-typegen:check`と`graphql:check`(許可リストの鮮度を含む)と`check:contract-copies`を既に実行する。設計の`APP_CHECKS`のうち`cf-typegen`の検査と`graphql:check`は重複する。また、設計が書くapi・eventの`cf-typegen --check`は、実際には専用のスクリプト`cf-typegen:check`である                                                                                                                                                                                                                                                                  |
| G4  | 5.3・6.1・6.2 | Missing    | `config/workspace-layout.ts`の`APPS`は`frontend-lib`をアプリとして含む(`test:unit`・`test:browser`・`storybook:build`を持ち、Wrangler設定を持たない)。設計には`frontend-lib`の記述が無い。導入の対象(`resolveInstallTargets`)ではAPPSとSHARED_DIRSの配置元が重なるため重複を除く必要があり、カバレッジの合算(`mergeLcov`)では`apps/frontend-lib`の前置が要る。構成検査はWorkerを持つ4アプリだけを対象にする必要がある                                                                                                                                                                                                                                                                |
| G5  | 8.2・12.4     | Constraint | 上流の単体テストが識別子の仮の値を期待値として固定している。`apps/api/test/config/wrangler-config.unit.test.ts`がapiとeventのstagingの`database_id`を、`apps/client/test/config/wrangler-config.unit.test.ts`と`apps/admin/test/config/wrangler-config.unit.test.ts`がstagingの`TURNSTILE_SITE_KEY`(clientは`WEB_ANALYTICS_TOKEN`も)を、仮の値として期待する。タスク9.2の完了状態「上流のWrangler設定の単体テストが成功」は、これらの期待値も同じ変更で直さないと満たせない。`project-values.md`の識別子の行と変数の値の表の「(仮の値)」も同時に直す必要がある。タスク7.1については、apiのテストのR2のスキーマが`z.object`(未知のキーを許す)のため、`jurisdiction`を加えても壊れない |
| G6  | 11.1・13.5    | Missing    | ホスト名から導かれる値のうち、apiの`TURNSTILE_EXPECTED_HOSTNAMES`(client・adminのホスト名)と、eventの`send_email`の`allowed_sender_addresses`・`EMAIL_FROM_ADDRESS`(送信ドメイン)が、設計の「ホスト名から導かれる変数の値」の一覧にも、構成検査の規則C1〜C8にも無い。資源一覧のホスト名や送信ドメインを変えたときに、食い違いを検出できない                                                                                                                                                                                                                                                                                                                                          |
| G7  | 12.2・2.2     | Unknown    | email-deliveryの手順(`docs/GUIDES/tech/external/001-email-sending.md`の「購読とQueueの作成」「送信ドメインの登録」、`project-values.md`の「開発者が管理画面で行う」)で、stagingのメールイベント用Queue・購読・送信ドメインが既に作られているかは分からない。管理画面の手順は管轄を指定していないため、Queueが既にあれば米国の管轄ではない可能性が高い。管轄は作成後に変えられないため、その場合は`import`による取り込みでは2.2を満たせず、削除して作り直すことになる(購読も作り直しになる)                                                                                                                                                                                           |
| G8  | 13.7          | Missing    | 本specの導入で手作業の手順が変わる上流の文書が、設計の「Modified Files」に無い。`docs/GUIDES/tech/external/001-email-sending.md`の管理画面でQueueと購読を作る手順、`project-values.md`の「デプロイ先のメールイベント用Queueと配信不能イベントの購読、送信ドメインの登録は、開発者が管理画面で行う」の一文、オンボーディングの「stagingのメールのシークレット」節の、CIのデプロイの導入までは暫定としてWranglerのシークレットのコマンドで設定するという記述である(CLAUDE.mdの水平展開の規則)                                                                                                                                                                                          |
| G9  | 5.4           | Unknown    | コミット時の検出はBetterleaksで、誤検知は`.betterleaksignore`のFingerprintで除外する。CIのTruffleHogは別の規則と別の除外の仕組みを持つため、Betterleaksで誤検知と判断した値がCIで失敗する場合と、逆に片方だけが検出する場合があり得る。設計には2つの除外の扱いの記述が無い                                                                                                                                                                                                                                                                                                                                                                                                           |
| G10 | 7.10          | Unknown    | `@smoke`を付ける予定の`e2e/{client,admin}/system-status.e2e.test.ts`は、「ビルド後の対象でのみ」の分岐を含む。E2Eの補助にはローカル前提のもの(`e2e/support/scheduled-trigger.ts`はWranglerのローカルの経路`/cdn-cgi/local/scheduled`を使う)もある。stagingでは本物の非表示のTurnstile・Sentry・Web Analyticsが動くため、どのテストをスモークに含められるかは実際にstagingで確かめないと決まらない                                                                                                                                                                                                                                                                                    |
| G11 | 3.1           | Missing    | `.gitignore`に計画のファイルが無い。計画は暗号化されるが、ローカルで`-out`に書いた計画を誤ってコミットしないよう、名前を決めて除外するのが安全である                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| G12 | —             | Missing    | design.mdの「Existing Architecture Analysis」と本書の「Summary」が「上流は実装が未着手」のままである                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

### 実装の進め方の選択肢

本specは新しく作るもの(`apps/infra`・`.github`・`scripts/delivery`)が大半で、既存のファイルの変更はWrangler設定・E2Eのタグ・文書に限られる。設計は承認済みのため、選択肢は上の食い違いをどこで吸収するかで分ける。

#### 選択肢A: 設計とタスクを先に直してから実装する(既存の設計の拡張)

- G1〜G12をdesign.md・tasks.mdへ反映してから、タスク1から実装する。G3では`APP_CHECKS`をapiの`db:migrations:check`・`test:smoke`に絞り、`cf-typegen:check`・`graphql:check`は`check`に任せる。G6では一覧に3つの値を加え、送信ドメインの照合を構成検査の規則に加えるかを決める。G5・G8は該当するタスク(7.1・8.x・9.2)の作業と完了状態に加える。
- ✅ 実装中に設計との差分を溜めず、タスク9.1(設計との食い違いの修正)が軽くなる
- ✅ 開発者の判断が要る点(G2・G6・G7・G9)を実装の前に決められる
- ❌ 実装の開始が遅れる。承認済みの文書の改訂(改訂4)として記録する手間が要る

#### 選択肢B: 設計どおりに実装し、食い違いはタスク9.1でまとめて直す

- タスクの順に実装し、上流の実体に合わない箇所(Nodeの版・`frontend-lib`・`APP_CHECKS`)は実装で実体に合わせ、最後のタスク9.1でdesign.mdとresearch.mdに反映する。
- ✅ 今すぐ着手できる。9.1が元々この作業を想定している
- ❌ G5(9.2の完了状態が満たせない)・G7(取り込みか作り直しか)・G8(上流の文書の更新)はタスクに無いため、実装中に判断を迫られて止まる
- ❌ 構成検査(タスク3.x)の規則を先に作るため、G6を後から加えるとテストを書き直すことになる

#### 選択肢C: 判断が要る点だけ先に決め、機械的な食い違いは実装で吸収する(組み合わせ)

- 先に開発者がG2(Mailpitの検証の方法)・G6(送信ドメインとbot判定のホスト名を構成検査に加えるか)・G7(stagingのメールの資源が既にあるか)・G9(2つの検出器の除外の方針)を決め、決定をrequirements.mdの改訂の表とdesign.mdへ記録する。
- G1・G3・G4・G11・G12は実装で実体に合わせ、タスク9.1で設計へ反映する。G5・G8は該当するタスクへ作業を1行ずつ足す。
- ✅ 判断待ちで実装が止まる点だけを先に潰し、文書の改訂を最小にできる
- ❌ 機械的な食い違いの反映を9.1まで持ち越すため、途中の設計書は実装と一部食い違う

### 規模とリスク

- **規模: L(1〜2週間)**。新しく作るものが大半(OpenTofuの4モジュール・TypeScriptのコマンド約20個と単体テスト・ワークフロー5つ・技術文書6つ)だが、上流のコマンドと設定が揃い、設計とタスクが細かく決まっているため、XLには当たらない。
- **リスク: 高**。Cloudflare・Infisical・GitHubの3つの外部サービスを結び、AIエージェントは適用・デプロイ・CIの実行を確かめられない(Claude設定の拒否)。管轄は作成後に変えられないため、最初の適用の誤りは作り直しになる(G7)。CIでの実際の動作は、開発者がmainへマージした後の最初の実行まで分からない。

### 設計フェーズ(改訂)への申し送り

- 推奨: 選択肢C。G7とG5は実装中に必ず手が止まる点で、G2・G6・G9は開発者の方針の判断だからである。
- 決める必要がある点:
  - G2: Mailpitの配布物を、初回に取得した値から算出したSHA-256を固定して検証するか、開発コンテナと同じく検証しないか
  - G6: eventの送信元アドレスとapiの`TURNSTILE_EXPECTED_HOSTNAMES`を、構成検査の照合の対象に加えるか、値の一覧への記載だけにするか
  - G7: stagingのメールイベント用Queue・購読・送信ドメインを開発者が既に作ったか。作った場合、Queueの管轄の有無と、作り直すかどうか
  - G9: TruffleHogの除外を`.betterleaksignore`とどう対応させるか(TruffleHogを検証済みの結果だけで失敗させるか、除外のファイルを別に持つか)
- Research Needed:
  - TruffleHogの公式アクションの版と、誤検知の除外の指定方法(G9)
  - 管理画面で作ったQueueの管轄の確かめ方(`wrangler queues info`の出力に管轄が出るか)と、購読ごと作り直す手順(G7)
  - stagingで動かせるスモークテストの範囲(G10)。最初のstagingのデプロイの後に確かめる
  - OpenTofu 1.13.2のモックのproviderが`ephemeral`リソースに対応するか(設計時からの持ち越し。タスクで確かめる)。tasks 2.3で確かめ、対応すると分かった。`mock_provider "infisical"`で`ephemeral "infisical_secret"`を含むルートモジュールを`command = plan`で計画できるため、代替の検査ではなく`apps/infra/live/tests/live.tftest.hcl`で両環境の結線を確かめる

### 開発者の決定と反映(改訂4、2026-10-29)

選択肢Cで進めることにし、判断が要る4点を1件ずつ開発者に確かめた。決定はrequirements.mdの「承認後の改訂」の表に改訂4として記録した。受け入れ基準は変えていない。

| #   | 提示した選択肢                                                                             | 決定                                     | 反映                                                                                                                                                                                                                       |
| --- | ------------------------------------------------------------------------------------------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G2  | 公式のDockerイメージをdigestで固定する(推奨)/自前で算出したSHA-256を固定する/検証しない    | 検証しない                               | 開発コンテナと同じく、GitHubのリリースの配布物を検証せずに取得する。design.mdの技術スタックと複合アクション、tasks 6.2                                                                                                     |
| G6  | 構成検査に照合の規則を足す(推奨)/値の一覧に書くだけ                                        | 値の一覧に書くだけ                       | design.mdの「ホスト名から導かれる変数の値」に表を加え、Out of Boundary・Revalidation Triggers・他specへの影響の表(backend-platform・email-delivery)に所有するspecを書いた。構成検査の規則C1〜C8は変えない                  |
| G7  | まだ作っていない/作った(Queueは作り直す)/作ったか分からない                                | まだ作っていない                         | design.mdの「Migration Strategy」を、最初の適用で米国の管轄のQueueと送信ドメインを作る形に改めた。後から手作業の資源が見つかった場合の取り込みと、管轄を持たない資源の作り直しの規則を残す                                 |
| G9  | 検証済みと未確定の検出で失敗させる(推奨)/検証済みだけで失敗させる/すべての検出で失敗させる | 検証済みと未確定の検出で失敗させる(推奨) | `--results=verified,unknown`と、`.betterleaksignore`とは別の除外のファイル`.github/trufflehog-exclude-paths.txt`。design.mdのディレクトリ構成・`checks.yml`・`infra/007`の記載事項・オンボーディングの更新、tasks 6.3・8.5 |

選択肢Cのうち、実装前に反映した機械的な食い違いは次のとおりである。

- G1: design.mdのNodeの版を26.12.1に改め、WranglerをNodeで動かす前提をExisting Architecture Analysisに書いた。tasks 6.2にも版を書いた。
- G3: design.mdのapi・eventの`cf-typegen --check`を、実際のスクリプト名`cf-typegen:check`に改めた。開発者の指示(2026-10-29)により、`check`との重複も実装前に解消した。`APP_CHECKS`はapiの`db:migrations:check`・`test:smoke`だけにし、全アプリの`cf-typegen:check`・`graphql:check`は`quality`ジョブで先に実行する`check`に任せる。design.mdの`app-checks`の行・要件の対応表(5.6)・frontend-platformへの影響の行、tasks 4.2と1.1の前提、requirements.mdの改訂4の行を改めた。`check`は失敗しても止めずにすべての段階を実行し、失敗があれば終了コードで失敗を返すため、5.2の「失敗した時点で後続の段階を実行しない」は`check`の後の段階について成り立つ。
- G5: tasks 9.2に、上流のWrangler設定の単体テストのstagingの期待値と`project-values.md`の値を同じ変更で改める作業を加え、design.mdのModified Filesと他specへの影響の表に書いた。
- G8: tasks 8.5とdesign.mdのModified Filesに、メール送信の技術ドキュメントの手作業の手順、`project-values.md`の注記、オンボーディングの暫定の手順の更新を加えた。
- G12: design.mdのExisting Architecture Analysisと本書のSummaryを、上流の実装が完了した状態に改めた。
- tech-stack.mdのCI/CDの節の「Infisical(staging環境)を注入」を、決定Q4のとおりdevに改め、CI内のE2Eとstagingのスモークテストを加えた。

- G11: 開発者の指示(2026-10-29)により実装前に対応した。計画のファイルの名前を`apps/infra/live/<env>.tfplan`に決めてdesign.mdの`tofu`の呼び出しに書き、`.gitignore`に`*.tfplan`を加えた。ルートの`gitignore.unit.test.ts`で、OpenTofuの状態・計画・変数・クラッシュログが管理外で、`.terraform.lock.hcl`が管理対象であることを確かめる(先に計画のファイルの判定だけが失敗することを確かめてから`.gitignore`を直した)。

G4(`frontend-lib`の扱い)・G10(スモークテストの範囲)は、選択肢Cのとおり実装で吸収し、タスク9.1で設計へ反映する。

- G4の結果(9.1で反映): `frontend-lib`は導入の対象(重複を除いた7件)とカバレッジの合算の対象に入り、構成検査はWorkerを持つ4アプリだけを対象にする。design.mdの`install`の行と「CiInstaller・AuditGate…」の節に書いた。
- G10の結果(9.1で反映): `@smoke`は両アプリの疎通確認のE2Eの最上位の`test.describe`3つずつ(疎通確認の画面・存在しないページ・中継の経路)に付け、到達確認2件と合わせて25件になった。ローカルの開発サーバーでは25件が成功した。stagingで実行できるか(CSPの違反の検査・IP単位のレート制限・本物の非表示のTurnstile)は、最初のstagingのデプロイで確かめる。design.mdのModified Files・SmokeTag・PostDeployVerifierに書いた。
