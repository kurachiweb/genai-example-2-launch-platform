# Research & Design Decisions

## Summary

- **Feature**: `infra-delivery`
- **Discovery Scope**: Complex Integration(`apps/infra`と`.github`はリポジトリに無い。上流の5spec(dev-tooling・backend-platform・api-gateway・email-delivery・frontend-platform)はタスク一覧まで承認済みで、実装は未着手である。Cloudflare・Infisical・GitHubの3つの外部サービスを結ぶ)
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
| Q2  | 他の用途と共有している可能性があるゾーン`kurachiweb.com`の、ゾーン全体に効くルールの管理 | brief Desired Outcome・DNSのSOA・要件定義書2.4(ゾーンはFreeプラン)・tech-stack.mdのWAF・FR-RLMIT-008                                                     | 推奨案。OpenTofuは本プロジェクトのホスト名に閉じた資源(カスタムドメイン、送信ドメインとそのDNS、Turnstile、Web Analytics)だけを扱い、ゾーン全体の防御は無償マネージドルールセット、レート制限はアプリ側に任せる。briefの「WAF・レート制限ルール」はこの範囲に読み替える                                                                                                            |
| Q3  | D1とR2の配置場所(ロケーションヒントまたは管轄)                                           | DR-007・`legal/001-compliance-policy.md`「データの保存場所」・NFR-PERF-003・D1とR2の配置は作成後に変えられない                                           | 推奨案(`apac`のロケーションヒント)ではなく「米国の管轄で保証」を採用。`jurisdiction = "us"`で米国内での保存を保証し、プライバシーポリシー骨子・準拠方針の保存場所の記述に反映する                                                                                                                                                                                                  |
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
- Turnstileのウィジェット: 環境ごとに1つとし、client・adminの両ホスト名を登録する。モードは`managed`とする。
- stagingの公開: READMEにstagingのURLが載っており、frontend-platform Q3もstagingで疎通確認の画面を公開すると決めているため、アクセス制限は掛けない。
- デプロイの順序: マイグレーション→APIサーバー→フロントエンドの順。api-gatewayとfrontend-platformで決定済み。
- 直前のリリースの特定: api-gateway Q3で「新しいリソースを使わない」と決まっている。手段は設計で決める(Workerの版のタグ)。
- ブランチ保護: briefで、コード化せずに文書化すると決まっている。既存のルールセットへ必須チェックなどを足す手順を書く。
- ロールバック: NFR-AVAIL-005が求めるのは「ロールバックできること」である。`wrangler rollback`を逆順(フロントエンド→api→event)で実行する手順を文書化し、CIでは自動ロールバックしない。Durable Objectsのライフサイクルの変更をまたぐロールバックはできない。D1は巻き戻さない(NFR-AVAIL-008のExpand/Contract)。
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
  - `cloudflare_turnstile_widget`: `domains`・`mode`(`managed`など)・`name`が必須で、`secret`はsensitiveな計算値、`sitekey`は計算値。
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
- **Implications**: Wrangler設定とワークフローの検査を、新しいパッケージを入れずにルートのTypeScriptで書く。脆弱性の確認は`bun audit --audit-level=high`と、理由を書いた除外の一覧で行う。

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
