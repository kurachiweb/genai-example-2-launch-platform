# Research & Design Decisions

## Summary

- **Feature**: `launch-readiness`
- **Discovery Scope**: Complex Integration(本番リリースの前の横断の検証と運用準備。上流の28spec(dev-tooling〜data-export)の設計は承認済みで、実装はdev-toolingだけが済んでいる。本specは機能を足さず、infra-deliveryのデプロイの仕組みと手順(`operations/001`・`002`)、backend-platformのログ・エラートラッキング・定期実行の要約、frontend-platformのブラウザの計測とセキュリティヘッダーと`runAxe`、admin-foundation・identity-authと各ドメインspecのE2Eの補助、paymentsの`operations/004`の上に、検証の道具・回帰テスト・監査・監視の設定内容・運用ドキュメント・本番準備のチェックリストを足す)
- **Key Findings**:
  - 上流の各specは、prodのシークレットの登録・prodのStripeの価格と設定・prodの識別子の反映・最初のprodのデプロイ・監視とソースマップ・データ量を増やした性能の検証・送信者情報とDKIMの確認・法務文書の初版の公開・機能フラグの順序を本specへ申し送っている(「上流specの申し送りの集約」)。AIエージェントはprodへのデプロイ・Infisicalへの書き込み・リモートのD1への書き込みと復元・`gh workflow run`を禁じられているため(Claude設定のdeny)、これらは全て開発者の作業としてチェックリストにまとめ、エージェントは秘密でない値の反映のPR・検証の道具・記録・文書を受け持つ。
  - 4:21の定期実行は、Cron Triggers(1時間以上の間隔)の実時間とCPU時間の上限がともに15分で、backend-platformの`ScheduledDispatcher`は登録順にジョブを直列に動かし、ジョブごとの結果と所要時間の要約を`info`で出す。roadmapの帯の表では30のジョブ(user-profile-socialのorphaned-file-sweepの追加を含む)が4:21に載る。予算を決める仕組みは無く(content-processing・media-pipelineのM-5)、本specは仮1で予算と上限を置き、要約のログから判定する道具で検証する。超過の警告の仕組みはbackend-platformへの申し送りにする。
  - paymentsのQ5(承認済み)はapi用とevent用の制限付きキーを別々に作ると決めたが、infra-deliveryのシークレットの配布は`/`の同じキー名(`STRIPE_API_KEY`)の値を全Workerへ渡すため、別々の値を登録できない。本specは仮13でQ5に従う案を採り、infra-deliveryへの変更を申し送る。
  - 新しいツールは負荷試験の道具(仮6)とソースマップのアップロードの道具(仮7)だけである。アクセシビリティの自動の検査は、frontend-platformが採用済みの`axe-core` 4.13.0を同じ版でルートのE2Eから使い、新しいパッケージを要さない。

## 要件フェーズ前の確認事項(2026-10-24)

本specは開発者に質問できない一括の作成で作った。開発者の判断を要する論点を次の表に記録し、要件定義書・サービス仕様・上流specに最も整合する案を「仮」として採用した。**仮1〜仮13は2026-10-24に開発者が全て確定した(仮12だけは推奨と異なる案を選んだ)。** 決定は`requirements.md`の「要件フェーズでの仮決定」にも記録する。roadmapの「Requirement Ambiguities」の表のうち、本specが担当に含まれる行は「4:21の直列実行のジョブ全体の時間の予算と上限」(担当はbackend-platform、検証は本spec)だけで、仮1で扱う。新しいツール・パッケージを要する仮6・仮7は、承認までそれに依存するタスクを保留するとしていた(2026-10-24に確定し、保留は解けた)。本specは4:21のジョブとユーザーライフサイクルの波及処理を持たないため、roadmapの帯(2200番台)を使わない。

| #    | 論点                                             | 根拠                                                                                                                                                                                                                                                                        | 選択肢                                                                                                                                                                                               | 推奨と採用                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 仮1  | 4:21の日次バッチの時間の予算と上限               | roadmapの「Requirement Ambiguities」の行(担当backend-platform、検証launch-readiness)、content-processing・media-pipelineのM-5、Cron Triggersの上限(1時間以上の間隔で実時間15分・CPU時間15分)、backend-platformの`ScheduledDispatcher`(直列・要約のログ)、帯の表の30のジョブ | (A)予算5分・上限10分・各ジョブ30秒を目安とし、想定規模のstagingで実測する / (B)上限15分だけを守り予算を設けない / (C)4:21を複数の時刻に分ける                                                        | 推奨・採用は(A)。上限15分ちょうどを目標にすると、データの増加や外部の遅延で打ち切られ、後ろのジョブ(帯の大きいspec)が毎日動かなくなる。上限の3分の2を上限とし、さらに半分を予算とすれば、ジョブの増加とデータの増加に2倍の余裕がある。30のジョブで5分なら1つあたり10秒で、目安の30秒は重い1つのジョブを早めに見つけるための値である。(C)は日次タイムラインの改訂(4:21が1つの時刻である前提)と帯の割り当ての見直しが要り、上流の全specへ波及する。予算の決定と超過の警告(エラートラッキングへの`warning`)は担当のbackend-platformへ申し送る(2026-10-24に開発者が確定) |
| 仮2  | 性能の検証に使うデータの規模                     | 要件定義書に件数の定めが無い。directory-discovery(勝利10万件)・engagement(返信500件)・sponsorship(広告1,000件)・ugc-moderation・content-reporting・notifications・data-exportのresearch.mdの申し送り                                                                        | (A)上流が挙げた値+1年目の想定(利用者5万・プロダクト2万・コメント20万・フォロワー1万・案件5,000・監査ログ10万・上限まで投稿した利用者1人) / (B)上流が挙げた項目だけ / (C)開発者が事業計画の値を与える | 推奨・採用は(A)。上流が挙げた値は各specが設計の判断(写しのテーブル・ページ分けなど)の閾値として使っており、そのまま検証する。挙げていない項目も、一覧・検索・日次バッチの件数に効くため、同じ桁の規模を置く。1年目の想定は、1日の予選の勝利数百件(directory-discovery)から逆算した登録の規模である。(C)の値が得られれば置き換える(2026-10-24に開発者が確定)                                                                                                                                                                                                          |
| 仮3  | FCPを確かめるページと計測の条件                  | NFR-PERF-001(Observatoryで確認)、UI-001(レスポンシブ)、frontend-platform(FCPの実測はlaunch-readinessがObservatoryで行う)、モックアップの4画面とページ配置                                                                                                                   | (A)利用者側6ページのモバイルとデスクトップ+管理者側2ページのデスクトップ、リリース前は合成テスト、リリース後は実利用者の75パーセンタイル / (B)デスクトップだけ / (C)本番の実利用者の計測値だけ       | 推奨・採用は(A)。リリース前は実利用者がいないため、合成テストで判定するしかない。利用者側は携帯端末の閲覧が想定され、モバイルの条件(遅い回線の模擬)が厳しい方の判定になる。管理者側はデスクトップでの業務の画面である。リリース後は実利用者の値で確かめ直す(2026-10-24に開発者が確定)                                                                                                                                                                                                                                                                                |
| 仮4  | GraphQLのp95のリリース前の確かめ方               | NFR-PERF-003(`@sentry/tanstackstart-react`のBrowser Tracing、10回に1回)、frontend-platformの`tracesSampleRate`と`tracePropagationTargets`、stagingではbot判定が実際のウィジェットであること                                                                                 | (A)stagingで未ログインの閲覧の流れを繰り返し、エラートラッキングの計測で主要な公開の操作ごとに200件以上で判定する / (B)負荷試験の道具の計測値で代える / (C)本番リリース後にだけ確かめる              | 推奨・採用は(A)。要件は計測の方法をエラートラッキングのブラウザの計測と定めており、負荷試験の道具はブラウザの描画と中継の時間を含まない。10回に1回の割合のまま200件を集めるには1つの操作を約2,000回呼ぶ必要があり、E2Eの道具で閲覧の流れを60〜90分繰り返せば足りる。ログイン中の操作はstagingのbot判定のためにブラウザで自動化できず、リリース後のアラートで見張る(2026-10-24に開発者が確定)                                                                                                                                                                         |
| 仮5  | 同時接続100人の負荷の掛け方                      | NFR-PERF-002、backend-platformのWorker単位のIP制限(100回/10秒)、stagingのbot判定(自動化できない)、match-engine(同時のUpvoteはlaunch-readinessで確かめる)、Claude設定のdeny(`gh workflow run`)                                                                               | (A)複数の送信元(GitHub Actionsの手動起動のジョブの並列)で合計100人、送信元ごとにIP制限を下回る。書き込みの同時実行はローカル / (B)1つの送信元で制限を下回る量だけ / (C)検証の間だけ制限を緩める      | 推奨・採用は(A)。100人が数秒〜十数秒ごとに要求すると合計で毎秒10件を超え、1つの送信元ではIP制限で拒否される。(B)は100人の同時接続にならない。(C)は検証の対象の設定を変え、戻し忘れの危険がある。GitHubのホストのランナーは並列のジョブごとに送信元が分かれるため、5並列で各20人にすれば制限を下回る。手動の起動は開発者が行う。書き込みはbot判定のために、テスト用のキーが使えるローカルで確かめる(2026-10-24に開発者が確定)                                                                                                                                         |
| 仮6  | 負荷試験の道具(新しいツール)(2026-10-24確定)     | tech-stack.mdに負荷試験の道具が無い。CLAUDE.md(新しいパッケージは候補を挙げて質問する)                                                                                                                                                                                      | (A)k6 / (B)Artillery / (C)autocannon / (D)Bunで自作する                                                                                                                                              | 推奨は(A)。仮想の利用者と待ち時間・段階的な負荷・95パーセンタイルの閾値での合否を標準で持ち、Grafanaが継続して保守している。単体の実行ファイルで、アプリの依存に加わらない。(B)はnpmで導入でき同等の機能を持つが依存が大きい。(C)はHTTPの一定の負荷に向き、待ち時間のある利用者の模擬に向かない。(D)は合否の集計と負荷の段階を自作することになる。承認まで負荷試験の台本・ワークフロー・実行のタスクを保留するとしていた(確定により解除。2026-10-24に開発者が確定)                                                                                                   |
| 仮7  | ソースマップのアップロードの道具(2026-10-24確定) | infra-deliveryの申し送り(ソースマップのアップロードの手順の追加はlaunch-readiness)、Wranglerのバンドル(esbuild)とViteのビルド                                                                                                                                               | (A)`@sentry/cli` / (B)`@sentry/vite-plugin`と`@sentry/esbuild-plugin`の組                                                                                                                            | 推奨は(A)。ViteとWranglerの両方のビルドの出力に、同じ手順(デバッグIDの埋め込み→アップロード)を掛けられ、ビルドの設定にプラグインを足さずに済む。(B)はclient・adminのVite設定へプラグインを足せるが、api・eventはWranglerが内部でバンドルするためプラグインを差し込めず、2つの方式になる。承認までデプロイの仕組みへのアップロードの追加のタスクを保留するとしていた(確定により解除。2026-10-24に開発者が確定)                                                                                                                                                        |
| 仮8  | 縮退運転の確かめ方                               | NFR-AVAIL-002、各specの外部サービスの失敗の扱い(content-processingの縮退索引、paymentsの`payments_unavailable`、email-deliveryの再試行と日次上限、identity-authの漏洩照合とDISIFYの未判定、media-pipelineの判定の再試行)、上流のWorkers統合テストの`fetchMock`              | (A)対応表と上流の自動テスト+ローカルで鍵・宛先を無効にして読み取りの回帰を通す / (B)stagingで鍵を無効にしてデプロイする演習 / (C)対応表だけ                                                          | 推奨・採用は(A)。障害の種類ごとの振る舞いは上流の自動テストが`fetchMock`で確かめており、重複して書かない。サービス全体の主張(読み取りが外部サービスに依存しない)は、外部サービスを止めた状態の通しの確認でしか示せない。ローカルでは各Workerの環境の値を起動の時に差し替えられる。(B)はstagingへの変更がmainへのマージを要し、戻すまでstagingの他の検証が止まる(2026-10-24に開発者が確定)                                                                                                                                                                            |
| 仮9  | 通知先と死活監視の対象                           | NFR-AVAIL-003(運用担当者へ通知)、SW-007、FlareWardenの無料の範囲(監視15件・複数の地域・ステータスページ)、backend-platformの`/health`、frontend-platformの`/system/status`(prodでは404)                                                                                     | (A)開発者のメール、prodとstagingの5つずつの対象、ステータスページはprodの3つ / (B)チャットツールへのWebhook / (C)管理者側もステータスページに載せる                                                  | 推奨・採用は(A)。運用担当者は開発者1人で、FlareWarden・Sentryの両方がメールの通知を標準で持ち、新しいツールが要らない。ヘルスチェックはデータベースを読まないため、利用者側のトップの内容の確認でデータベースと中継の障害も検知する。管理者側は利用者に関係しないため公開しない。監視10件は無料の範囲に収まる(2026-10-24に開発者が確定)                                                                                                                                                                                                                              |
| 仮10 | アクセシビリティ監査の範囲と方法                 | UI-003(WCAG 2.2 AA)、frontend-platformの`runAxe`と`frontend/004`、各specのブラウザテストの違反0件、自動の検査で検出できる達成基準は一部であること                                                                                                                           | (A)全経路の自動の検査+キーボードのE2E+チェックリストでのブラウザの確認+開発者のスクリーンリーダーの確認 / (B)自動の検査だけ / (C)外部の監査                                                          | 推奨・採用は(A)。部品ごとのブラウザテストは部品の単位で、ページの組み立て(見出しの構造・ランドマーク・フォーカスの移動)を確かめていない。自動の検査はWCAGの一部しか検出できないため、残りをチェックリストで確かめる。スクリーンリーダーの実機の確認はエージェントが行えない(2026-10-24に開発者が確定)                                                                                                                                                                                                                                                                |
| 仮11 | リリースを止める指摘の基準                       | briefのDesired Outcome(指摘を解消済み)、`.claude/rules/common/code-review.md`の重大度、roadmapの方針(個別の不具合は担当specで直す)                                                                                                                                          | (A)要件に反する指摘と重大・高のセキュリティの指摘だけをリリース前に解消する / (B)全ての指摘をリリース前に解消する                                                                                    | 推奨・採用は(A)。要件に反しない改善の提案まで全て解消を待つと、終わりの条件が定まらない。要件に反するものはbriefの「解消済み」に含め、改善の提案は記録して担当specへ申し送る(2026-10-24に開発者が確定)                                                                                                                                                                                                                                                                                                                                                               |
| 仮12 | 画像変換の有償枠                                 | media-pipelineの申し送り(無料枠は月5,000件の一意な変換、stagingとprodで共有、費用の判断はlaunch-readiness)                                                                                                                                                                  | (A)リリース前に有償プランを契約する / (B)無料枠で始め8割で契約する                                                                                                                                   | 推奨は(A)(採用は(B))。無料枠を超えると新しい変換が失敗し、プロダクトのロゴやスクリーンショットが表示されなくなる(NFR-AVAIL-002の主要な読み取りに当たる)。stagingの検証(合成データ・回帰テスト)が無料枠を使う。従量の費用は小さい(2026-10-24に開発者が確定。開発者の回答の記号はCで、本表の(B)無料枠で始め8割で契約する案を採用した。推奨と異なる)                                                                                                                                                                                                                    |
| 仮13 | Stripeの制限付きキーのWorkerごとの登録           | paymentsのQ5(承認済み、api用とevent用の制限付きキーを別々に作る)、paymentsの要件15.2、infra-deliveryの`selectWorkerSecrets`(`/`の同じキー名の値を全Workerへ渡す)                                                                                                            | (A)Q5に従い別々の値を登録し、Workerごとの値を区別できる配布をinfra-deliveryへ申し送る / (B)eventの権限を持つ1つのキーを共用する                                                                      | 推奨・採用は(A)。Q5は開発者が承認した決定で、最小の権限の原則にも合う。(B)はapiが不要な返金・定期課金の書き込みの権限を持つ。同じ食い違いはstagingにもあり、上流の変更として報告する(2026-10-24に開発者が確定)                                                                                                                                                                                                                                                                                                                                                       |

### 確認済みのため質問しない事項

- AIエージェントの禁止事項: prodへのデプロイ・`wrangler deploy`・`wrangler rollback`・`wrangler d1 * --remote`・`wrangler d1 time-travel restore`・`tofu apply`・`infisical secrets set`・`gh workflow run`・`gh pr merge`はClaude設定のdenyで拒否される。prodの作業・stagingのデータベースの投入と復元・ロールバックの演習・負荷試験の手動の起動は開発者の作業とする(CLAUDE.md、roadmapのOut)。
- prodのシークレットの登録の時期: 各specが宣言したprodの値は本specがリリース時に登録する(roadmapの「Workerのシークレット」、infra-deliveryのQ6)。キーの一覧の正は`docs/onboardings/project-values.md`の節で、技術ドキュメントには列挙しない(N-5)。
- prodの資源の作成と識別子の反映: infra-deliveryの`operations/001`の「prodの準備の手順」(8.4)に従い、1回目のリリースで資源を作り、`reconcile-ids`が示す識別子を反映するPRの後の2回目のリリースでWorkerをデプロイする(infra-deliveryのQ6)。
- Sentryのプロジェクト: stagingのプロジェクトはinfra-deliveryのK8で開発者が先に作る。prodは別のプロジェクトを作り、Infisicalのprodの`SENTRY_DSN`に登録する。4つのWorkerとブラウザは同じDSNを使い、`SENTRY_ENVIRONMENT`で環境を区別する(backend-platform・frontend-platform)。
- 疎通確認の画面`/system/status`はローカルとstagingだけで表示され、prodでは404になる(frontend-platform)。本specはprodで確かめるだけである。
- WAF: ゾーンが他の用途と共有の可能性があり、ゾーン全体のカスタムルールとレート制限ルールは持たず、無償マネージドルールセットとアプリ側のレート制限に任せる(infra-deliveryのQ2、承認済み)。本specは有効であることを確かめるだけである。
- 監視サービスのアカウント: FlareWarden・Sentryのアカウントと設定は開発者が行う(brief)。Cloudflare系のMCPサーバー(cloudflare-observabilityなど)は現時点で未認証で、使う場合は開発者が先に認証する。
- 疎通確認の購入種別: `PAYMENTS_SMOKE_ENABLED`はprodで`false`(payments)。本specは設定を確かめるだけである。
- 機能フラグの順序: prodでStripeの価格・Portal・税の設定を確かめた後に、最上位管理者が`/settings`で有料プランへの導線をオンにする(ultras-subscriptionの仮2、承認済み)。
- 最初の最上位管理者: 開発者が招待の発行コマンドを`--target prod`で実行する(admin-foundationのQ1、承認済み)。
- 法務文書とヘルプ記事の本文: 起草は対象外で、開発者が管理画面で公開し、本specは公開されたことを確かめる(legal-pagesのQ6、help-center)。
- E2Eの規約: E2Eは`e2e/<対象名>/`の下にだけ置き、対象はclientとadminの2つ。対象のURLは`E2E_CLIENT_URL`・`E2E_ADMIN_URL`で上書きでき、`@smoke`はstagingのhttpsで実行できるテストだけに付ける(dev-tooling・infra-delivery)。管理者のログインは`signInAsNewAdmin`、ローカルのD1への投入は`executeLocalD1`(admin-foundation)、メールは`mailpit.ts`(identity-auth)を使う。
- 決済のE2E: Stripeのsandboxのキーと`stripe listen`の転送が揃う環境だけで実行し、揃わなければ対象外である旨を表示する(paymentsの規約)。
- steering: `.kiro/steering`にはroadmap.mdだけがあり、product.md・tech.md・structure.mdは無い。CLAUDE.md・tech-stack.md・上流specで代替する。

## 要件のレビュー(2026-10-24)

- 機械的な確認: 19の要件の見出しがすべて数字のIDを持ち、118件の受け入れ基準がすべてEARSの形式(`When`・`If … then`・`While`・`Where`・`The … shall`)であることをスクリプトで確かめた。技術名は要件定義書の用語(Observatory・FlareWarden・Sentry・Web Analytics・D1 Time Travel・WCAG・Expand/Contract・JSON)と、上流の契約の名前(シークレットのキー名・`operations/004`・`--target prod`・`.example`)に限った。
- 判断のレビューの1回目で、(1)GraphQLのp95の標本をstagingのbot判定のために未ログインの公開の操作に限る必要があり、ログイン中の操作の扱いが抜けていた(2.1を直し2.6を加えた)、(2)負荷試験のログイン中の照会はstagingの利用者のセッションを作れないため外した(3.1)、(3)paymentsのQ5とinfra-deliveryの配布の食い違いを仮13として加えた(16.4)。2回目で問題は無かった。
- 要件定義書・サービス仕様で決まらない論点は仮1〜仮13として記録し、要件の範囲の推測は加えていない。

## Research Log

### 上流specの申し送りの集約

- **Context**: briefのDesired Outcomeと、コントローラーの指示(全specのdesign.md・research.mdから「launch-readiness」とprod限定・後回しの項目を集める)。
- **Sources Consulted**: 全28specの`design.md`・`research.md`・`requirements.md`・`tasks.md`の「launch-readiness」の記載(約150行)、「手作業」「開発者が行う」「DKIM」「Observatory」「FlareWarden」「WAF」「Time Travel」「縮退」「リリース時」の記載、infra-deliveryのSupporting References(資源一覧の値・Infisicalのフォルダとキー・主体とOIDC・初回の準備・ホスト名から導かれる変数・prodで仮の値を置く変数)。
- **Findings**(申し送った元のspec → 項目):
  - infra-delivery: prodのstateのバケットとR2トークン・CloudflareのAPIトークン・Infisicalのprodのフォルダと主体`ci-deploy-prod`・`prod.json`の主体の識別子・1回目のリリースでの資源の作成・識別子(D1・Turnstileのサイトキー・Web Analyticsのトークン)の反映・2回目のリリースでのデプロイ・prodのルールセットのコードオーナーの承認が効くことの確認・Sentryのソースマップのアップロードの手順の追加・監視とアラート。
  - backend-platform: prodの`HASH_PEPPER`・`TURNSTILE_SECRET_KEY`・`SENTRY_DSN`、外部の死活監視(`/health`)、ログはWorkers Logs(7日)。
  - frontend-platform: Sentryのプロジェクトと値、FCPとアクセシビリティの全体の検証、疎通確認の画面がprodで404、Permissions-Policy・CSPの値。
  - api-gateway: GraphQLのクライアント観測の応答時間の計測、セキュリティヘッダーの値。
  - email-delivery: 日次上限の到達と引き上げの申請、送信ドメインのDNS(MX・SPF・DKIM・DMARC)。
  - content-processing: prodの`GOOGLE_NL_API_KEY`(APIの制限を掛けたキー)。
  - media-pipeline: prodの`REKOGNITION_ACCESS_KEY_ID`・`REKOGNITION_SECRET_ACCESS_KEY`(IAMとAIサービスのオプトアウトは開発者)、prodに`MEDIA_SMOKE_TOKEN`を登録しない、画像変換の有償枠の判断。
  - identity-auth: prodの`DISIFY_API_KEY`(任意)。
  - admin-foundation: 最初の最上位管理者の招待を`--target prod`で発行。
  - legal-pages: prodで3文書の初版を本番公開の前に公開したことの確認。
  - payments: prodの`STRIPE_API_KEY`(api・event)・`STRIPE_WEBHOOK_SECRET`(event)、`STRIPE_PUBLISHABLE_KEY`(`pk_live_`の仮の値)のライブモードの公開キーへの置き換え、ライブモードのWebhook endpoint(API版`2026-09-30.endive`・15種の購読)・価格・Customer Portal・税の登録・決済手段、`PAYMENTS_SMOKE_ENABLED`がprodで`false`。
  - ultras-subscription: prodの価格`ultras_monthly`・Portal・再試行・顧客向けメールの停止・制限付きキーの権限を確かめた後に機能フラグをオン。
  - tournament-week・tournament-year・sponsorship: prodの価格`week_tournament_entry`・`year_tournament_entry`・`sponsorship_legend_daily`・`sponsorship_gold_daily`・`sponsorship_silver_daily`。
  - notifications: prodの送信者情報の設定(未設定なら通知メールを送らない、仮3)、prodの`EVENT_SITE_ORIGIN`、受信したメールの`List-Unsubscribe`・`List-Unsubscribe-Post`とDKIMの署名の対象(`h=`)の確認。
  - help-center: 本番のヘルプ記事の本文の投入、全体のE2E回帰にヘルプの流れ。
  - public-api: prodの`PUBLIC_API_ORIGIN`の確認、公開APIの負荷と回数の制限、`/api-docs`のアクセシビリティ。
  - directory-discovery(勝利10万件)・engagement(1スレッド500件)・sponsorship(広告1,000件)・ugc-moderation(部分一致の検索)・content-reporting(案件の一覧の`EXISTS`)・notifications(フォロワーの収集の時間)・match-engine(同時のUpvote)・data-export(大きいエクスポートのCPU時間・メモリ・実時間とダウンロードの中継の時間切れ)の性能の検証。
- **Implications**: チェックリスト(design.mdのSupporting References)に、実施者・順序・確認方法・元のspecとともに全項目を載せる。性能の検証の対象(要件4.2)も上の申し送りから決める。

### AIエージェントの禁止事項と開発者の作業の切り分け

- **Context**: CLAUDE.md・`.claude/settings.json`のdeny、brief(prodへのデプロイは人間の承認が必須)。
- **Findings**: denyは`wrangler deploy`・`rollback`・`versions deploy`・`d1 * --remote`・`d1 time-travel restore`・`secret`、`tofu apply`、`infisical secrets set`、`gh workflow run`・`gh pr merge`、`.claude/**`の編集などを拒否する。ローカルのD1への`--local`の書き込み、HTTPの読み取りの要求、ファイルの編集とPRの作成は拒否されない。
- **Implications**: stagingの合成データの投入(リモートのD1)・Time Travelの復元・ロールバックの演習・負荷試験のワークフローの起動・監視サービスの設定・ObservatoryとWorkers Logsの管理画面の確認は開発者の作業にする。エージェントは、合成データのSQLの生成、検証の道具、E2E、記録の整理、秘密でない値の反映のPRを行う。prodへのHTTPの読み取りの確認(セキュリティヘッダー)は、prodの状態を変えないためエージェントが行ってよいが、実行の可否は開発者の指示に従う。

### 定期実行の制限とローカルでの時刻の指定

- **Context**: 要件5・要件14.5。
- **Sources Consulted**: Cloudflare Docs「Limits」(Cron Triggersの実時間15分、CPU時間は1時間未満の間隔で30秒・1時間以上で15分)、「Cron Triggers」(ローカルの`/cdn-cgi/local/scheduled?cron=<式>&time=<ミリ秒>`で`scheduledTime`を指定できる)、backend-platformの`ScheduledDispatcher`・`createCronRegistry`・`toUtcCronExpression`。
- **Findings**: 4:21(UTC 12:21)は1日1回で、実時間とCPU時間の上限は15分。ジョブの所要時間は`ScheduledDispatcher`の最後の`info`の要約に出る。ローカルでは時刻を指定して定期実行を起動でき、業務日付は`scheduledTime`から決まる。現行のWranglerの文書のローカルの経路は`/cdn-cgi/local/scheduled`である(上流のbackend-platformの文書の旧い経路は、spec横断レビューで改訂2として直された)。
- **Implications**: 予算の判定は要約のログ(JSON)を読む道具で行う。E2Eの時刻の制御は、固定したWranglerの版が受け付ける経路を実装時に確かめて補助へ閉じ込める。実際の時刻(`Clock`)で受け付けを判定する処理は、上流のE2Eと同じくローカルのD1への投入で状態を合わせる。

### 監視サービスの機能

- **Context**: 要件9・要件10。
- **Sources Consulted**: FlareWardenの製品のページ(無料の範囲で監視15件・複数の地域・ステータスページ・メールとWebhookの通知・StatusPage互換のAPI)、frontend-platformのresearch.md(Observatoryは実利用者の計測値を表示し、合成テストも持つ)、backend-platform・frontend-platformのSentryの初期化(`SENTRY_ENVIRONMENT`・`tracesSampleRate`・`sendDefaultPii: false`)。
- **Findings**: FlareWardenは内容の確認付きのHTTPの監視と、監視に連動するステータスページを無料の範囲で持つ。Sentryの性能のメトリクスのアラートはプランにより使えない場合がある。
- **Implications**: 監視とアラートの定義は文書(チェックリストと固有の値)に置き、開発者が画面で設定する。GraphQLのp95のアラートが使えないプランなら、週に1回の確認の手順を運用ドキュメントに置く(リスク)。

## Architecture Pattern Evaluation

| Option                                  | Description                                                                 | Strengths                                            | Risks / Limitations                                        | Notes                        |
| --------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------- | ---------------------------- |
| 検証の道具+E2E+文書を本specが持つ(採用) | 純粋な判定の道具・E2E・記録・チェックリストを足し、修正は担当specへ依頼する | 上流の境界を変えない。判定を単体テストで確かめられる | 修正の依頼と再検証の往復が要る                             | brief・roadmapのApproach     |
| 監視の設定をコード化する                | FlareWarden・SentryのAPIで監視とアラートを作る                              | 再現性                                               | APIの資格情報の管理が増え、無料の範囲のAPIの可否が不確か   | 不採用。手順と定義の表にする |
| 検証用の常設のテストをapiとeventへ足す  | 縮退や負荷をWorkers統合テストで本specが持つ                                 | 自動化                                               | 上流のアプリの内部に本specのテストが入り、所有が曖昧になる | 不採用                       |
| stagingの設定を検証の間だけ変える       | IP制限・計測の割合を一時的に変える                                          | 計測が容易                                           | 検証の対象の設定が本番と変わり、戻し忘れの危険             | 不採用(仮4・仮5)             |

## Design Decisions

### Decision: 検証は道具と記録、修正は担当spec

- **Context**: briefのApproach(個別機能の不具合は担当specの範囲で修正し、本specのタスクから参照する)。
- **Alternatives Considered**:
  1. 本specが不具合を直す
  2. 本specは検出・記録・依頼・再検証だけを行う
- **Selected Approach**: 2。指摘は検証の記録に状態と参照を持たせ、本specのタスクの完了の条件を「リリースを止める指摘が0件」にする。
- **Rationale**: 上流の境界と所有を変えず、修正のテストと文書が担当specに残る。
- **Trade-offs**: 担当specへの依頼の往復で時間が掛かる。
- **Follow-up**: 依頼の形(担当spec・要件の番号・再現の手順)を記録の様式に含める。

### Decision: 合成データはapiの側で上流のテーブル定義から生成する

- **Context**: 要件4.1、admin-foundationの`apps/api/scripts/admin/invitation-sql.ts`の前例(`sqlStringLiteral`)。
- **Alternatives Considered**:
  1. ルートの道具で列を書き写したSQLを生成する
  2. apiの`scripts`に置き、Drizzleのテーブル定義から列を得てリテラルのINSERT文を生成する
  3. ローカルで画面やGraphQLを通して作る
- **Selected Approach**: 2。`apps/api/scripts/readiness/`にデータセットごとの生成を置き、ローカルの新しいD1へ適用して検証してから、開発者がstagingへ投入する。
- **Rationale**: テーブル定義の変更で生成が型検査で壊れ、書き写しの食い違いを防げる。3は10万件の作成に時間が掛かり、bot判定と回数制限に当たる。
- **Trade-offs**: 集計値・索引文書などの派生のデータも生成で整合させる必要がある(Risks)。

### Decision: 時刻に依存する回帰は時刻を指定した定期実行で進める

- **Context**: 要件14.1・14.5。
- **Selected Approach**: `e2e/support/scheduled-trigger.ts`で、apiのローカルの定期実行を業務時刻と業務日付で起動する(spec横断レビューにより、補助はbackend-platformの改訂2が`triggerScheduled`として持ち、本specはそれを使う)。実際の時刻で判定する境界は上流のE2Eの補助(`match-fixtures.ts`など)でローカルのD1の状態を合わせる。
- **Rationale**: 予選・トーナメントの1日単位の進行を、待たずに1回のテストで通せる。

### Decision: アクセシビリティの全経路の検査は経路の一覧と生成されたルートの木を照合する

- **Context**: 要件12.1(全ての画面の経路)。
- **Selected Approach**: `e2e/support/route-inventory.ts`に経路ごとの代表の状態と用意の方法を持ち、単体テストでclient・adminの生成されたルートの木の全経路が一覧にあることを確かめる。
- **Rationale**: 後から加わった経路が監査から漏れない。

### Decision: 採らなかった案

- 監視とアラートのコード化: 資格情報とAPIの可否が増え、無料の範囲で確かでない。
- stagingの設定の一時的な変更による計測: 検証の対象が本番と変わる(仮4・仮5)。
- 4:21の分割: 日次タイムラインと帯の割り当ての改訂が上流の全specへ波及する(仮1)。
- `@axe-core/playwright`の追加: 採用済みの`axe-core`をページへ注入すれば足り、新しいパッケージを避けられる。

## Synthesis

- **Generalization**: 計測・演習・監査は「対象の一覧→計測または確認→基準での判定→指摘の記録→担当specでの修正→確認し直し」の同じ形で、違いは判定の基準と計測の手段だけである。判定は`scripts/readiness/core`の純粋な関数(予算・p95・応答の集計)と、E2Eの検査(アクセシビリティ・セキュリティヘッダー)で表し、記録は検証の記録の同じ様式に集める。一般の問題として「性能の検証(FCP・応答時間・負荷・合成データと復元・定期実行の予算)」を`testing/003`、「複数のアプリにまたがる回帰と全経路の監査」を`testing/004`、「監視とアラート」を`security/009`、「障害対応」を`operations/005`、「本番準備と演習」を`operations/006`に記す。
- **Build vs. Adopt**: 監視(FlareWarden・Sentry・Web Analytics)・FCPの計測(Observatory)・復元(D1 Time Travel)・ロールバック(infra-deliveryの手順)・アクセシビリティの規則(`axe-core`)・E2E(Playwright)は既存のサービスと道具を使う。負荷試験(仮6)とソースマップのアップロード(仮7)だけが新しい道具で、承認を待っていた(2026-10-24に確定)。判定の集計(予算・p95)は数十行の純粋な関数で、道具を足さずに作る。
- **Simplification**: 監視の設定はコード化しない。検証用のアプリの常設の経路やテストを上流のアプリへ足さない。検証の記録とチェックリストは文書2つにまとめる。性能の改善は本specで作り込まず、上流specが記録した対策の要否の判断と依頼にとどめる。

## Risks & Mitigations

- 合成データの派生の値(集計値・最新の勝利・索引文書)が整合せず、計測が実際と異なる — データセットごとに、上流の書き込みの規則(集計値の求め直し・索引文書の行)を生成で再現し、ローカルのD1へ適用した後に画面とGraphQLで件数を確かめる。整合しない列は、上流の日次の再計算のジョブ(あれば)を起動して直す。
- stagingの合成データが他の検証(回帰のスモーク・開発者の確認)を妨げる — 投入の前のTime Travelの時点を記録し、計測の後に復旧の演習として戻す(要件4.6・8.1)。投入から復元までの間は他の変更をstagingへマージしない旨を手順に書く。
- 画像変換の無料枠を合成データの閲覧で使い切る — 合成データのプロダクトは画像を持たないか、少数の共通の画像を参照する。仮12の確定(無料枠で始める)により、検証の前後の使用量をS-21で記録し、AL-10の通知または確認で8割に達したら有償プランを契約する。
- 負荷試験の送信元が同じ出口のIPになり制限に当たる — 結果の429の件数で検知し、並列の数を増やして1つあたりの負荷を下げる。
- GraphQLのp95のメトリクスのアラートがSentryのプランで使えない — 運用ドキュメントに週1回の確認の手順を置き、チェックリストでプランの可否を確かめる。
- 4:21の予算の超過を本番で検知する仕組みが無い — backend-platformの改訂2(確定)で警告が加わり、アラートAL-09で通知する。上限までの余裕と各ジョブの目安は、要約のログを週1回確かめる手順を運用ドキュメントに置く。
- `/cdn-cgi/local/scheduled`の経路と`time`の引数がWranglerの版で異なる — backend-platformの共有の補助の1箇所に閉じ込められ、上流が実装時に固定の版で確かめる。
- E2Eの回帰が上流の補助の変更で壊れる — 上流の補助だけを使い、同等の補助を作らない。壊れたら担当specへ依頼する(Revalidation Triggers)。
- paymentsのQ5とinfra-deliveryの配布の食い違い(仮13) — infra-deliveryの改訂1とpaymentsの仮7(確定)で解消した。チェックリストB-06は`/workers/api`・`/workers/event`へ別々の値を登録する。

## References

- `docs/requirements/README.md` — 5章(UI-001・UI-003・SW-006・SW-007・SW-021)、6章(NFR-PERF・NFR-SECUR・NFR-AVAIL・NFR-OBLOG)、DR-008、I18N-001
- [Cloudflare Workers: Limits](https://developers.cloudflare.com/workers/platform/limits/) — Cron Triggersの実時間とCPU時間
- [Cloudflare Workers: Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/) — ローカルの定期実行の起動と`time`の引数
- [FlareWarden: Features](https://flarewarden.com/features)・[Status Pages](https://flarewarden.com/status-pages) — 監視・ステータスページ・通知
- [Cloudflare: Observatory](https://developers.cloudflare.com/speed/observatory/) — 合成テストと実利用者の計測
- `docs/GUIDES/service/overview/007-daily-timeline.md` — 4:21の日次バッチ
- 上流specの`design.md`・`research.md`(「上流specの申し送りの集約」の一覧)
- `.claude/settings.json` — AIエージェントのdeny

## 仮決定(2026-10-24に開発者が確定)

要件と設計の作成中に生じた、開発者の判断を要する論点である。要件定義書と上流specに最も整合する案を採用して要件・設計・タスクを作った。**仮1〜仮13は2026-10-24に開発者が全て確定した(仮12は推奨と異なる案で、要件・設計・タスクを合わせた)。** `requirements.md`の「要件フェーズでの仮決定」にも同じ行がある。

| #    | 論点                           | 採用した案                                                                                                     | 他の選択肢                                      | 影響する箇所                                                                                               |
| ---- | ------------------------------ | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 仮1  | 4:21の予算と上限               | 予算5分・上限10分・各ジョブの目安30秒、想定規模のstagingで実測、値の記載と警告はbackend-platformの改訂2が提供  | 上限15分だけ / 4:21の分割                       | 要件5、`CronBudgetJudge`、`operations/006`、backend-platformの改訂2(2026-10-24に開発者が確定)              |
| 仮2  | 性能の検証のデータの規模       | 上流が挙げた値+1年目の想定                                                                                     | 上流の項目だけ / 事業計画の値                   | 要件1.2・4・5.1、`ScaleProfile`・`SyntheticDataGenerator`(2026-10-24に開発者が確定)                        |
| 仮3  | FCPのページと条件              | 利用者側6ページ×モバイル・デスクトップ、管理者側2ページ×デスクトップ、リリース後は実利用者のp75                | デスクトップだけ / 実利用者だけ                 | 要件1、`testing/003`、チェックリストE-14(2026-10-24に開発者が確定)                                         |
| 仮4  | GraphQLのp95の確かめ方         | stagingの未ログインの閲覧の繰り返し、ブラウザの計測で操作ごとに200件以上                                       | 負荷試験の値 / リリース後だけ                   | 要件2、`LatencyReport`、`browse-traffic`のE2E(2026-10-24に開発者が確定)                                    |
| 仮5  | 同時接続100人の負荷            | 5並列の送信元で各20人、IP制限を下回る。書き込みはローカルの100人                                               | 1つの送信元 / 制限を緩める                      | 要件3、`LoadScenario`・`LoadWorkflow`・`concurrent-upvotes`のE2E(2026-10-24に開発者が確定)                 |
| 仮6  | 負荷試験の道具                 | k6(2026-10-24に開発者が承認して確定)                                                                           | Artillery / autocannon / 自作                   | 要件3.1〜3.3・3.6、`scripts/readiness/load`・`readiness-load.yml`、tech-stack.md(2026-10-24に開発者が確定) |
| 仮7  | ソースマップのアップロード     | `@sentry/cli`(2026-10-24に開発者が承認して確定)                                                                | `@sentry/vite-plugin`と`@sentry/esbuild-plugin` | 要件10.3・10.4、`SourcemapPublisher`、`infra/007`、tech-stack.md(2026-10-24に開発者が確定)                 |
| 仮8  | 縮退運転の確かめ方             | 対応表と上流の自動テスト+ローカルの縮退の起動での読み取りの回帰                                                | stagingの演習 / 対応表だけ                      | 要件6、`DegradedOverrides`・`degraded-reads`のE2E(2026-10-24に開発者が確定)                                |
| 仮9  | 通知先と監視の対象             | 開発者のメール、M-01〜M-10、ステータスページはprodの3つ                                                        | Webhook / 管理者側も公開                        | 要件9・10、Supporting Referencesの監視とアラート、`security/009`(2026-10-24に開発者が確定)                 |
| 仮10 | アクセシビリティ監査           | 全経路の自動の検査+キーボードのE2E+チェックリスト+開発者のスクリーンリーダー                                   | 自動だけ / 外部の監査                           | 要件12、`RouteInventory`・`A11yScan`・a11yのE2E(2026-10-24に開発者が確定)                                  |
| 仮11 | リリースを止める指摘           | 要件に反する指摘と重大・高のセキュリティの指摘                                                                 | 全ての指摘                                      | 要件13.7・17.6・18.3、検証の記録の指摘の様式(2026-10-24に開発者が確定)                                     |
| 仮12 | 画像変換の有償枠               | 無料枠で始め、使用量の8割(月4,000件)の通知(AL-10)で有償プランを契約(2026-10-24に開発者が確定。推奨と異なる案)  | リリース前に契約(当初の推奨)                    | 要件10.7・10.8・16.10、AL-10、チェックリストA-03・S-09・S-21、`operations/006`・`security/009`             |
| 仮13 | Stripeのキーのworkerごとの登録 | paymentsのQ5に従い別々の値、配布はinfra-deliveryの改訂1(`/workers/api`・`/workers/event`)とpaymentsの仮7が提供 | 1つのキーの共用(Q5の改訂)                       | 要件16.4、チェックリストA-08・B-06、`operations/004`の本番の節(2026-10-24に開発者が確定)                   |

## 要件定義書の改訂が必要な箇所

**2026-10-25に要件定義書(`docs/requirements/README.md`)へ適用済み。** 以下は適用前に記録した改訂の内容である。

要件定義書(`docs/requirements/README.md`)は本specでは編集しない(roadmapのOut)。次の改訂を推奨する。

| 要件ID                  | 内容                                                                                                                     | 根拠     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------ | -------- |
| NFR-PERF-001            | 計測の対象のページと条件(モバイルとデスクトップ、リリース前は合成テスト、リリース後は実利用者の75パーセンタイル)を加える | 仮3      |
| NFR-PERF-002            | 同時接続の負荷の条件(待ち時間・時間・誤りの基準)と、検証のデータの規模を加える                                           | 仮2・仮5 |
| NFR-PERF-003            | 判定に要する標本数(操作ごとに200件以上)を加える                                                                          | 仮4      |
| SW-005(またはNFRの新設) | 同じ時刻に直列で動く日次バッチの全体の時間の予算と上限を加える                                                           | 仮1      |
| NFR-AVAIL-003           | 通知先(運用担当者のメール)と監視の対象の範囲、外部ステータスページに公開する範囲を加える                                 | 仮9      |
| UI-003                  | 監査の方法(全経路の自動の検査と手動の確認)を加える                                                                       | 仮10     |

## 上流・後続specへの影響

- backend-platform(上流、提供済み): 4:21の予算と上限の値(仮1)の`infra/003`と`project-values.md`への記載、`ScheduledDispatcher`が1回の起動の合計の所要時間を予算と比べて超えたらエラートラッキングへ`warning`(タグ`cron`と所要時間)を送る変更、ローカルの定期実行の経路の`/cdn-cgi/local/scheduled`への修正、共有の補助`e2e/support/scheduled-trigger.ts`は、spec横断レビューでbackend-platformの改訂2として採られた(roadmapの「Requirement Ambiguities」の行の担当)。仮7の承認後に本specがapi・eventのWrangler設定へ`upload_source_maps: true`を加える(追加のキーで、設定の検査は変わらない)。Sentryの伏せ字の範囲(backend-platformの改訂1の「範囲の外」)は、2026-10-24に開発者が広げると決定し、backend-platformの改訂3で例外の値・イベントのメッセージ・パンくずのメッセージにも適用された。本specはチェックリストA-09で、ダミーのキーを含む例外がstagingのSentryで伏せられて届くことを確かめる。
- infra-delivery(上流): (1)提供済み: Workerごとの値を区別して配布できるシークレットの登録先(`/workers/api`・`/workers/event`の値が`/`の同名の値より優先され、`WORKER_SCOPED_SECRETS`の`STRIPE_API_KEY`は`/`の値を使わない)とローカルの起動の入口(`run-with-secrets --scope local --worker <api|event>`)は、spec横断レビューでinfra-deliveryの改訂1として採られた(仮13。stagingの登録もその手順に従う)。(2)本specが行う追記(仮7の承認後): `deploy-worker`のソースマップのアップロード、`secret-scope`の`/ci/sentry`、`deploy.yml`の手順。`checkWorkflowPolicy`・`repo-contract`の再検証を求める。(3)本番リリースのときに、本specが`prod.json`の主体の識別子と4アプリのWrangler設定のprodの識別子を反映する(手順どおり)。
- payments(上流、提供済み): `operations/004`の制限付きキーの登録先をWorkerごとに直す変更は、paymentsの仮7として採られた(本specは本番の節を追記するだけで、既存の節は変えない)。paymentsのQ5を共用へ改める案を採る場合は、要件15.2の改訂が要る。
- frontend-platform(上流): 仮7(2026-10-24確定)により本specがclient・adminのVite設定の`build.sourcemap`を`'hidden'`にする。配信物の`.map`はアップロードの後に削除する。
- 全てのドメインspec(上流): 検証の指摘による修正の依頼を受ける。E2Eの補助の関数の形を変えるときは本specのE2Eを確かめ直す。
- roadmap: 帯の割り当ての表の本specの「使用中の値」は「—」のままである(4:21のジョブとユーザーライフサイクルの波及処理を持たない)。「Requirement Ambiguities」の「4:21の直列実行のジョブ全体の時間の予算と上限」の行の「解決」の列へ、本specの仮1を加える。本specはroadmapを編集しないため、コントローラーへ報告する。

## 設計のレビュー(2026-10-24)

- `/kiro-spec-design launch-readiness -y`の手順で、要件を承認し(`-y`による自動の承認)、設計の下書きを作った。参照したスキルはcc-sddの`kiro-spec-design`の規則(design-principles・design-discovery-full・design-synthesis・design-review-gate)とテンプレート。外部の調査は、Cron Triggersの上限とローカルの定期実行の起動(Cloudflareの文書)、FlareWardenの機能に絞った。
- 機械的な確認: 要件の118件の受け入れ基準の番号がすべて追跡表にあることを、スクリプトで確かめた。境界の4節(This Spec Owns・Out of Boundary・Allowed Dependencies・Revalidation Triggers)は空でない。全コンポーネントの置き場所がFile Structure Planにある(上流への追記は「Modified Files」)。
- 1回目の判断のレビューで、(1)画像配信は名前付きエントリポイントで`/health`を持たないため、監視M-05を見本の画像の経路に直した、(2)デプロイ先の定期実行は手動で起動できないため、4:21の計測を投入の後の最初の実行を待つ形に直した、(3)合成データの出力先`tmp`のGit管理外の指定(`.gitignore`)が抜けていたため加えた、(4)外部ステータスページの導線の判断(9.6)を設計に書いた、(5)追跡表のE2Eの参照をファイルの名前にそろえた。2回目で問題は無かった。
- 境界の確認: 上流のアプリの業務のコード・テーブル・テストを変えない。上流のファイルへの変更は、ルートの`package.json`・`.gitignore`、`operations/004`の本番の節、承認後のソースマップの手順と設定、本番リリースのときの秘密でない値だけである。backend-platform(予算の警告)とinfra-delivery(Workerごとのシークレット)への変更は申し送りで、本specは実装しない。
- 技術ドキュメントの番号: 完了済みspecのdesign.mdの計画は`backend`001〜023、`frontend`001〜021、`db`001〜008、`security`001〜008・010〜012、`infra`001〜008、`external`001〜008、`operations`001〜004、`coding`001〜004、`testing`001〜002である(`security/009`はnotificationsとtournament-weekがdirectory-discoveryの番号と想定したが、どのspecも使っていない空き番号である)。本specは最小の空き番号の`testing/003`・`testing/004`・`security/009`・`operations/005`・`operations/006`を取る。

## タスクの計画の検証(1回目の実行、2026-10-24)

- `/kiro-spec-tasks launch-readiness -y`の手順で、要件と設計を承認し(`-y`による自動の承認)、タスクの計画の下書きを作った。要件の118件の受け入れ基準の番号がすべてタスクにあることを、スクリプトで確かめた。
- タスクのグラフのサニティレビューを、新しいサブエージェントによる独立した確認(independent)で行った。1回目の判定はNEEDS_FIXES(必須9件・軽微12件)だった。指摘は、投入から復元までmainへマージしない規則とロールバックの演習・再計測の順序の矛盾、負荷試験の保留で復元が止まること、復元の手順が演習の後に書かれること、E2Eのタスクの完了の条件と一括の実行のタスクの重なり、`cli.ts`を共有する`(P)`、合成データの入口の所有、ソースマップと負荷試験の隠れた前提(stagingの`/ci/sentry`、k6の導入)、大きすぎる2つのタスクであった。全てに従って直した。
- 2回目の判定(新しいサブエージェント)もNEEDS_FIXES(必須7件)だった。うち3件は設計の欠落であった: (1)ログインが要る画面(管理画面の検索・通報の一覧)・データエクスポート・公開APIをstagingで計測する手段が無い、(2)`@smoke`の基線の検査がinfra-deliveryのスモーク(clientとadminのURLだけを渡す)でapi・event・画像配信をローカルとして検査し失敗する、(3)縮退の対応表の単体テストが証跡の無い行で失敗し、完了の条件と矛盾する。スキルの規則(2回目がPASSでなければtasks.mdを書かずに止める)に従い、この実行ではtasks.mdを書かず、設計へ戻した。
- 設計へ戻した修正: 要件4.3をログインが要る画面はデータベースの分析(所要時間300ms以内・読み取りの行数)で判定する形に、要件4.4を開発者の検証用のアカウントに結び付けたデータで計測する形に改めた。設計に、開発者の作業S-14〜S-18(エクスポートの計測・管理画面の操作とデータベースの分析・stagingのAPIキー・ロールバックの後の再デプロイ・ログイン中の操作の参考値)、生成の基準日と`--export-user-id`、基線の検査の対象外の扱い、対応表の証跡なしの扱い、リリースのPRの作成の起動者と説明の文案の時期を加えた。設計のレビューの規則で機械的な確認(追跡表の全番号・境界の4節・コンポーネントの置き場所)をやり直し、問題は無かった。

## タスクの計画の検証(2回目の実行、2026-10-24)

- 設計の修正の後に、`/kiro-spec-tasks launch-readiness -y`の手順をやり直した。要件の118件の受け入れ基準の番号がすべて下書きのタスクにあることを、スクリプトで確かめた。
- 1回目の判定(新しいサブエージェントによる独立した確認)はNEEDS_FIXES(必須2件・軽微9件)だった。指摘は、保留の6のタスクが順序で7〜9を止めること、手動のアクセシビリティの確認表とスクリーンリーダーの手順の作成者がいないことであった。6の見出しに7〜9が6に依存しない旨を書き、7.12の依存を直し、1.6に確認表と手順を加えた。軽微の指摘(無停止デプロイの確認のマージの依頼(S-19を設計に追加)、演習の失敗のやり直し、計測の割合の確認を7.9へ、7.9の分割、境界の注記、監視の設定の前倒し、シークレットの注入の接頭辞、設計の矛盾2件)にも従った。
- 2回目の判定(新しいサブエージェント)もNEEDS_FIXESだった。必須の指摘は、(1)負荷試験の手動起動のワークフローは既定のブランチに無いと起動できず、マージの停止の期間と合わない・見本のハンドルをCIが読めない、(2)チェックリストの段階A〜Cの開発者の作業の結果を記入するタスクが無い、(3)フォロワー1万人の開催通知の収集の時間の計測の出どころ(ログの書き出し)が無い、の3件で、いずれもタスクの計画の中で直せるものだった。
- スキルの規則(2回目の判定がPASSでなければ`tasks.md`を書かず、承認しない。やり直しを重ねない)に従い、`tasks.md`を書かず、タスクを承認しなかった。2回目の判定の指摘(必須3件と軽微の一部)は、未承認の下書き`tasks-draft.md`に反映し、(3)のために設計のS-05を広げた。下書きは再レビューを受けていない。次は開発者が`/kiro-spec-tasks launch-readiness`を実行し、下書きを起点に新しい独立したレビューを受ける。

## タスクの計画の検証(3回目の実行、2026-10-24)

- コーディネーターの指示で、`/kiro-spec-tasks launch-readiness -y`の手順を、未承認の下書き`tasks-draft.md`を起点(merge context)にやり直した。上流の3件(infra-deliveryのWorkerごとの`STRIPE_API_KEY`の配布、backend-platformの4:21の予算の超過の警告とローカルの定期実行の経路)はコントローラーのspec横断レビューで扱うため、本specは上流specを編集せず、タスクの前提(1.1の注記と、2.3・3.1・7.10・8.3・9.1)で上流の変更として扱う形にした。あわせて、E2Eのタスクの指摘の記録を7.1へ集め、全ての経路のヘッダーの確認を5.1・5.2へ、画面の幅の確認を全経路へ広げた(設計のE2Eの表も合わせた)。
- 1回目の判定(新しいサブエージェント、S-05の設計の変更の確認を含む)はNEEDS_FIXES(必須1件)だった。フォロワー1万人の開催通知の収集は0:00の朝の枠で動くため、基準日(投入の当日)のマッチでは投入の後に収集が起きず、S-05のログが得られないという指摘で、そのマッチを翌業務日にし、S-05と設計の流れの注記と生成の規則を「投入の後の最初の0:00の朝の枠」に直した。軽微の指摘(4.3のCPU時間とメモリの判定、マージの停止の8への注記、6の例外の一覧、期待のジョブの順序の出どころ、4.5の依存)にも従った。
- 2回目の判定(新しいサブエージェント)もNEEDS_FIXES(必須2件)だった: (1)設計のS-05の要件の列に4.3が無い、(2)開催通知の受信設定(既定は受信しない)の有効化と、0:00の開始で`live`になるマッチの状態を生成する記述が無く、2.3の完了の確認とS-05の計測が成り立たない(stagingの宛先の許可の一覧で`.example`への送信が拒否として記録されることの周知も無い)。
- 規則(2回目がPASSでなければ`tasks.md`を書かず承認しない)に従い、`tasks.md`を書かず、タスクの承認を設定しなかった。2回目の指摘(必須2件と軽微の一部: 2.3の上流の経路の注記とeventの起動、生成と投入の同じ業務日と境界の回避、翌業務日のマッチの所有を2.2に、6の例外へ9.1のB-03、6.2での`infra/004`の参照、7.13の`@traffic`と基線での代替、メモリの判定の言い換え)は、設計と`tasks-draft.md`に反映した。下書きは再レビューを受けていない。

- 4回目の実行(2026-10-24): 本specの要件11.2を、stagingで実行できるE2E(閲覧の繰り返しとセキュリティの基線)で確かめる形に改めた(回帰のE2Eはローカル専用で、要件14.8と矛盾していたため。要件定義書の改訂ではない)。

## タスクの計画の検証(4回目の実行、2026-10-24)

- コーディネーターの指示で、`/kiro-spec-tasks launch-readiness -y`の手順を`tasks-draft.md`を起点にやり直した。独立したレビューは、3回目の実行の未レビューの変更(設計のS-05と生成の規則、下書きの1.1・2.1〜2.3・6.2・6の見出し・7.8・7.10・7.13)を最初に確かめ、全て反映済みで上流の事実(通知の受信設定の既定・0:00の朝の枠・23:45のペアリングが組み済みのローンチを飛ばすこと)とも整合すると判定した。
- 1回目の判定(新しいサブエージェント)はNEEDS_FIXES(必須1件)だった。設計のS-14と流れの注記がデータエクスポートのメモリの判定(要件4.3・4.4)を求めていなかった。S-14に処理の結果(メモリの上限の超過による打ち切りの有無)と要件4.3を加えた。軽微の指摘(要件11.2の代替の記録、7.8のマージの停止と投入の時刻、アラートの規則のIDを`AL-01`〜`AL-08`へ改めチェックリストの`A-`と分けること、6.2と8.4の`infra/004`の順、2.3の前提、900,000msの境界)にも従った。
- 2回目の判定(新しいサブエージェント)もNEEDS_FIXES(必須2件)だった: (1)合成データの確認に使うローカルのD1が定まらず(管理者のログインとローカルのD1への投入の補助は共有の状態`/workspace/.wrangler/state`に固定)、確認の後の初期化も無いため、回帰のE2Eの再現性(14.6)を壊し得る、(2)7.13が検索する基線のE2Eのログが保持期間(7日)を過ぎている見込みが高い。
- 規則に従い`tasks.md`を書かず、タスクの承認を設定しなかった。2回目の指摘(必須2件と軽微: S-05と7.11のメモリの言い換え、9.4でprodの各URLを渡すこと、要件11.2そのものの改訂、6.1と6.4と6.2と8.5の同じファイルへの追記の注記、A-01の記入を8.6へ、設計の`AvailabilityProbe`の名前、RTOの起点を要件8.3にそろえること)は、要件・設計・`tasks-draft.md`に反映した。要件11.2の改訂はspec内の修正で、要件の承認は`-y`の流れのまま維持している。下書きは再レビューを受けていない。

## spec横断レビューによる修正(2026-10-24)

- **状態**: cross-spec reviewの指摘による修正で、2026-10-24に開発者が確定した(上流の改訂の確定とともに)。要件・設計は承認済み(`-y`の流れ)のまま、spec内の整合として直した。
- **上流の変更の受け入れ**: 本specが申し送っていた上流の変更が、spec横断レビューで次のとおり採られた。本specはそれを「提供済み」として扱い、タスクの前提(1.1)に含めた。
  - backend-platformの改訂2: 4:21の予算と上限の値の`infra/003`・`project-values.md`への記載、`ScheduledDispatcher`の予算の超過の`warning`(タグ`cron`と所要時間)、ローカルの定期実行の経路の`/cdn-cgi/local/scheduled`への修正、共有の補助`e2e/support/scheduled-trigger.ts`(`triggerScheduled`・`businessDateOf`・`addBusinessDays`・`isNearBusinessDayBoundary`)。
  - infra-deliveryの改訂1: Workerごとのフォルダ`/workers/api`・`/workers/event`(`/`の同名の値より優先、`WORKER_SCOPED_SECRETS`の`STRIPE_API_KEY`は`/`の値を使わない)と、api・eventのローカルの起動の入口`run-with-secrets --scope local --worker <api|event>`。
  - paymentsの仮7: `operations/004`のWorkerごとの制限付きキーの登録先。
- **決定と変えた箇所**:
  - 本specの`ScheduledTrigger`(`e2e/support/scheduled-trigger.ts`)を設計のThis Spec Owns・File Structure Plan・コンポーネントの表・追跡表から外し、業務日付の処理はbackend-platformの共有の補助へ移した(上流が業務時刻の部品を読み込み、規則を複製しない)。設計の節は「定期実行の起動(上流の共有の補助)」に置き換えた。下書きの3.1は`ReadinessTargets`だけのタスクにし(要件13.2・13.3)、4.1は`triggerScheduled`を使い3.1への依存を外した。
  - 仮1と仮13の行(要件・本書)、要件5.6(申し送りの記録から、上流の値と警告が仮1と一致することの確認へ)、Adjacent expectations、設計のOut of Boundary・Allowed Dependencies・Revalidation Triggers・上流への影響の表・既存のアーキテクチャの分析・`CronBudgetJudge`の注記・`operations/006`(週1回の確認を上限までの余裕と各ジョブの目安へ)・`operations/004`の本番の節・チェックリストB-06(`/workers/api`・`/workers/event`へ登録)を、上流の改訂に合わせた。
  - アラートの規則にAL-09(定期実行の予算の超過、`warning`・タグ`cron`、S3)を加えた。上流が送る警告の通知先が無かったため。E-09と`project-values.md`の範囲をAL-01〜AL-09にした。
  - 縮退の起動のコマンド(`degraded-env`)と下書きの1.5・2.3の起動を、infra-deliveryの改訂1のWorkerごとの起動の入口の形にした(素の`infisical run`では`STRIPE_API_KEY`が渡らない)。
  - 本書の調査の記録から、ローカルの定期実行の旧い経路の文字列を除いた。
- **追加したリリースの確認(要件16.12、チェックリストA-09)**(2026-10-24の開発者の決定により、判断の依頼から確認の実施へ置き換えた。末尾の「Sentryの伏せ字の範囲の決定の反映」を参照): backend-platformの`REDACTION_PATTERNS`は、Sentryでは`SentryScrubber`がパンくずの`data`の値にだけ適用し、例外のメッセージ・`message`・パンくずの`message`には適用しない(backend-platformのresearch.mdの改訂1の「範囲の外」と「開発者の判断待ちの論点」)。この判断を本番リリースの前に開発者が行うことをチェックリストA-09とし、範囲を広げる判断なら、backend-platformの修正のstagingへのデプロイの後に、stagingのエラートラッキングのイベントを値の形で検索して伏せられていることを確かめる。下書きでは、7.4で判断を依頼し(判断が無ければリリースを止める指摘)、7.13で確かめ、9.1で記入する。
- **理由**: 上流が提供する補助と仕組みを本specが重ねて作らないため。開発者の判断待ちの論点がリリースまで残らないようにするため。

## タスクの計画の検証(5回目の実行、2026-10-24)

- コーディネーターの指示で、上の「spec横断レビューによる修正」を未承認の下書き`tasks-draft.md`へ反映したうえで、`/kiro-spec-tasks launch-readiness -y`の手順を、下書きを起点(merge context)にやり直した。要件の119件の受け入れ基準の番号(要件16.12を含む)がすべてタスクにあることを、スクリプトで確かめた。
- 1回目の判定(新しいサブエージェントによる独立した確認)はNEEDS_FIXES(必須1件・軽微6件)だった。4回目の実行の未レビューの修正(共有のローカル状態の確定と初期化、7.13のログの保持期間ほか)は全て反映済みで、spec横断の変更も上流の事実と整合すると判定した。必須の指摘は、4.5(縮退の差し替えでのapi・eventの起動し直し)と4.6(合成データの適用と初期化)が`(P)`のまま共有のローカル状態と固定のポートを使い、並行するローカルのE2Eを壊すことで、`(P)`を外し、他のローカルのE2Eの実行と重ねない旨を書いた。軽微の指摘(2.1・2.2の共有の状態の初期化、1.1の保留の対象への3.1・4.5の追加、A-09の確認が抜ける経路を7.15で引き受けることと0件の検索だけを証明にしないこと、7.10の`warning`の確認の担当(設計のS-05に追加)、設計のImpactの補助の数)にも従った。
- 2回目の判定(新しいサブエージェント)はPASSだった。軽微の指摘(9.1のA-09の写し元に7.15を加えること、7.15のやり直しの間のマージの停止を6・8の注記と7.15に書くこと、2.3のデータエクスポートの確認にログインできる利用者を登録して`--export-user-id`で渡す前提を書くこと)に従って直した。
- PASSのため、下書きから`tasks.md`を書き(見出しの「未承認の下書き」と注記を除いた)、`tasks-draft.md`を削除し、タスクを承認した(`approvals.tasks.approved: true`、`-y`による自動の承認)。仮1〜仮13と、本specが依存する上流の改訂(backend-platformの改訂2、infra-deliveryの改訂1、paymentsの仮7)は、その後の2026-10-24に開発者が確定した(末尾の「決定の記録」)。

## 決定の記録

- 2026-10-24: 開発者が仮6(負荷試験の道具にk6)と仮7(ソースマップのアップロードに`@sentry/cli`)を承認し、確定した。コントローラーがtech-stack.mdへ記載した(k6はテスト、`@sentry/cli`はモニタリングのSentryの下)。設計の承認待ちの記述と、タスクの6.1〜6.4・7.12・7.15・8.4・8.6・9.3・9.5の保留と条件付きの分岐を外した。`@sentry/cli`は導入先がルートだけで、`coding/002`の主要パッケージの一覧の条件(複数の導入先で版をそろえる)に当たらないため一覧に加えず、版を明示して完全固定で加える。k6はnpmのパッケージでないため、開発コンテナとCIの導入をinfra-deliveryの版の照合で同じ版にそろえる。他の仮(仮1〜仮5・仮8〜仮13)は、同日の後の回答で確定した(下の行)。
- 2026-10-24: 上の変更のタスクの部分を、新しいサブエージェントによる独立したレビューで確かめ、1回目の判定はPASSだった。軽微の指摘(設計の技術スタックの表の括弧の残り、`@sentry/cli`の版の照合の扱いの統一、`coding/002`の手順の準用の明記、ルートの`package.json`と`bun.lock`の同時の変更の注記、研究の記録の古い文言)に従って直した。タスクの承認は維持した。

## Sentryの伏せ字の範囲の決定の反映(2026-10-24)

- **状態**: 2026-10-24に開発者が、APIキーなどの秘密の値を例外のメッセージに現れた場合も伏せると決定した。backend-platformが承認後の改訂3(確定)として、`REDACTION_PATTERNS`の適用先を例外の値と種類・イベントのメッセージ(`logentry`を含む)・パンくずのメッセージ・トランザクションとスパンへ広げた。本specの記録はcross-spec reviewとコーディネーターの指示による。
- **変えた箇所**: 要件16.12とチェックリストA-09を、開発者の判断を求める形から、ダミーの公開APIのキー(`lsk_`と43文字の固定の文字列)を含む例外を意図的に起こし、stagingのSentryのプロジェクトにキーが`[REDACTED]`になって届くことを確かめる形に改めた。開発者の作業S-20(一時的な経路を含むapiをstagingの`SENTRY_DSN`でローカルに起動して経路を呼ぶ)を加え、Revalidation Triggers・Allowed Dependencies・追跡表の16.12の行を合わせた。タスク7.4は判断の依頼から確認の実施へ改め、7.13と7.15からA-09の項目と要件16.12を外し(7.13の`_Depends:_`を7.9だけに戻した)、9.1のA-09の写し元を7.4に、1.6の写す作業をS-01〜S-20に、9.5の報告を確認の結果にした。
- **確認の方法の判断**: デプロイ済みのstagingのWorkerに意図的に例外を投げさせるには、コミットしてprodへも配信される診断の経路が要り、攻撃面を増やす。そのため、最新のmainから起動したローカルのapiに、コミットしない一時的な経路を置いて例外を投げ、stagingのSentryのプロジェクトへ同じSDKの設定(`beforeSend`の除去処理)で送る形にした。stagingの`SENTRY_DSN`の注入は開発者が行う(AIはstagingのシークレットを取り出さない)。デプロイ済みのWorkerでの確認が必要と判断されれば、backend-platformに診断の経路を加える改訂が要る。
- **起動の方法(変更部分のタスクのレビューの1回目による具体化)**: ローカルの`wrangler dev`は最上位の`secrets.required`のキーだけを環境変数から読み、最上位の`SENTRY_ENVIRONMENT`は`vars`の`local`であるため、`SENTRY_DSN`を注入するだけではイベントが送られない。そこで、AIが`origin/main`から作った一時的なworktreeに、例外を投げる経路と最上位の`secrets.required`への`SENTRY_DSN`の追加をコミットせずに置き、開発者がstagingの`SENTRY_DSN`だけを自分で取り出して環境変数に設定し、`run-with-secrets --scope local --worker api -- bunx wrangler dev --var SENTRY_ENVIRONMENT:staging ...`で起動する(stagingの他のシークレットは注入しない)。開発者は届いたイベントの例外のメッセージの表示をAIへ渡し、課題を解決済みにする(Sentryを読むMCPサーバーは無い)。確認の後にAIがworktreeを削除する。意図的な誤りがstagingのアラートを鳴らし得ることを事前に伝える。タスク1.1の前提と保留の対象に、backend-platformの改訂3と7.4のA-09を加えた。
- **変更部分のタスクの検証(2026-10-24、Sentryの伏せ字の範囲の決定の反映)**: kiro-spec-tasksのタスクのグラフのサニティレビューを、変更部分に絞って2回行った。どちらも新しいサブエージェントによる独立した確認(independent)である。1回目はNEEDS_FIXES(必須1件・軽微6件)で、必須の指摘は、最上位のWrangler設定では注入した`SENTRY_DSN`が`env`へ届かず`SENTRY_ENVIRONMENT`も`local`のままになること(worktreeで最上位の`secrets.required`へ一時的に加え`--var`で環境名を渡す形に直した)。軽微の指摘(一時的な経路の削除の担当、イベントの表示の受け渡し、`origin/main`のworktree、アラートの事前の周知、1.1の前提への改訂3、古い記録の注記)もすべて直した。
  - 2回目もNEEDS_FIXES(必須1件・軽微3件)だった。必須の指摘は、`origin/main`から作ったworktreeには依存と共有ディレクトリ(`apps/api/db`・`lib`)が無く起動できないこと。規則(2回目の判定がPASSでなければ承認しない)に従い、タスクの承認(`approvals.tasks.approved`)を`false`にした。2回目の指摘(必須: worktreeを`/workspace`の外に作り、依存の導入と`shared-dirs:place`と起動の確認を先に行う。軽微: メインのapiとローカルのE2Eを止めてから起動する、devの`/`の`SENTRY_DSN`による上書きの確認)は、7.4と設計のS-20に反映したが、再レビューを受けていない。軽微の指摘のうち、public-apiのdesign.mdに「開発者の判断待ち」の記述が残ることは本specの範囲外で、コントローラーへ報告する。

## 仮決定の確定の反映(2026-10-24)

- **決定**: 2026-10-24に開発者が仮1〜仮5・仮8〜仮13を確定した(仮6・仮7は先に確定済み)。仮1〜仮5・仮8〜仮11・仮13は推奨どおり(仮11は「要件違反と重大・高のセキュリティだけ」、仮13はWorkerごとのStripeの制限付きキー)である。仮12は推奨と異なる案(開発者の回答の記号はC。本書の表の(B))で、画像変換は無料枠で始め、使用量が8割に達したら有償プランを契約する。上流のbackend-platformの改訂1〜改訂3、infra-deliveryの改訂1、paymentsの仮7も同日に確定した。本specの仮決定は全て確定し、開発者の判断を待つ論点は残っていない。
- **仮12の反映(振る舞いの変更)**: 要件10.7(使用量が無料枠の8割(月4,000件)に達したら開発者のメールへ通知し、有償プランを契約する手順を運用ドキュメントに示す)と10.8(stagingの検証の前後の使用量を記録し、検証が無料枠を消費したことを示す)を加え、16.10を有償枠の契約から使用量の監視の設定と通知の試験に改めた。設計では、アラートの規則にAL-10(Cloudflareの使用量の監視。使用量に基づく請求の通知で閾値を設定できなければ、週1回(検証の期間は毎日)のダッシュボードの確認で代える)、チェックリストのA-03(prodで監視が働くことの確認、有償プランはリリースの前に契約しない)・S-09(AL-10の設定)・S-21(投入の前・負荷試験の後・復元の後の使用量の記録)、`operations/006`と`security/009`の記載、固有の値(月4,000件)、追跡表とコンポーネントの表、計測の流れの注記を改めた。タスクでは1.6・7.6・7.8・7.12・7.14・8.2・8.3・8.5・9.5を改めた。無料枠はstagingとprodで共有するため、検証の閲覧・負荷試験が本番の枠を消費する。Cloudflareの予算の通知は金額の閾値で、無料枠の中では働かないため使わない。
- **help-centerの仮1の確定(B、本文100,000文字)の影響**: 本specの想定規模(仮2)に本文が上限(100,000文字)のヘルプ記事を加え、要件4.2の計測の対象に記事の詳細の表示を、4.3の基準に照会のp95 300ms以内とブラウザの計測の道具でのFCP 1.6秒以内を加えた。合成データの`help-articles.ts`と`manifest.json`の見本のハンドル、閲覧の繰り返し(`@traffic`)の対象、計測の流れの注記を改め、タスク2.3・4.6・7.10を改めた。FCPのObservatoryの対象(仮3の6ページ)は変えない。
- **他の回答の影響の確認**: user-profile-socialの仮1(4:21の日次のファイルの削除のジョブの常設)は4:21のジョブを増やすが、本specの予算の判定は日次タイムラインの表の順序を実装の時点で写すため、設計の変更は要らない(7.10の計測で確かめる)。user-profile-socialの仮3(ウェブサイト10件)・data-exportの仮4などの上限の変更は、「各上限まで投稿した利用者」の生成が実装の時点の上流の上限を使うため、設計の変更は要らない。notificationsの仮2は23:45の送り出しで、本specの0:00の朝の枠の計測(S-05)に影響しない。
- **要件定義書の改訂が必要な箇所**: 仮12による新しい改訂は無い(画像変換の契約の時期は要件定義書に定めが無い)。上の「要件定義書の改訂が必要な箇所」の表は、確定した仮のとおりで変わらない。
- **user-profile-socialの4:21のジョブの追加**: user-profile-socialが4:21のジョブ`user-profile-social.orphaned-file-sweep`(`order` 600。保有者の利用者の行が無いファイルを1回の実行で1,000件まで物理削除する)を加えた(user-profile-socialの仮1の確定)。本specは、予算の判定の期待の順序(日次タイムラインの4:21の表を実装の時点で写す)にこのジョブを含め、合成データに、保有者の走査の量を最大にするファイルの記録(想定規模の利用者の全員に1件ずつ)と、上限での打ち切りを起こす保有者の居ないファイルの記録1,200件を加えた。保有者の居ないファイルの記録は、合成のデータだけの接頭辞の実体の無い一意なオブジェクトキーにし、共通の画像のキーを指さない(ジョブがR2の実体を物理削除するため)。設計の`daily-batch-targets.ts`と`CronBudgetJudge`の前提、タスク2.3・7.10を改めた。
- **確定の反映のレビューの1回目の指摘による修正**: (1)要件10.7と16.10に、通知の閾値を設定できない場合の定期の確認(週1回、検証の期間と本番リリースの後の最初の4週間は毎日)の分岐と、手段ごとの試験を明記した。Cloudflareの使用量に基づく請求の通知は、Cloudflareの文書ではProfessional以上のプランのPay-as-you-goのアカウントだけで使え、予算の通知は金額の閾値で無料枠の中では働かない。チェックリストA-03・S-09・S-21と新しいE-15、タスク7.6・7.15・9.4を合わせた。(2)本文100,000文字のヘルプ記事はリテラルのINSERT文1つではD1の1文の長さの上限(100KB)を超えるため、`sql-writer`を1文90,000バイト以下とし、長い文字列は断片の連結のUPDATEで組み立て、索引は記事の行から`INSERT ... SELECT`で作る形にした(タスク2.1・2.3)。あわせて、追跡表のAL-10、古いリスクの記述、ヘルプ記事のFCPの計測の条件(合成テストのモバイルの条件)、7.4の手順の順序とメインのapiの停止、ダミーのキーの文字の種類を直した。
- **確定の反映のレビュー(2026-10-24)**: 設計のレビューゲート(kiro-spec-designの`design-review-gate`)とタスクのグラフのサニティレビューを、変更部分に絞って2回行った。どちらも新しいサブエージェントによる独立した確認(independent)である。1回目は設計がNEEDS_FIXES・タスクがRETURN_TO_DESIGN(必須2件: 要件10.7・16.10と通知の代替の手段の食い違い、本文100,000文字のヘルプ記事がD1の1文の上限を超えること)で、上の修正で直した。2回目も設計・タスクともNEEDS_FIXES(必須1件)だった。必須の指摘は、合成のファイルの記録の状態が決まっておらず、media-pipelineの4:21のジョブ(810の未紐付けの削除・820の判定の送り直し・830の保存先の修正)が5万件を処理して予算の判定を誤らせ、stagingで判定の送り直しとデッドレターを起こし得ること。規則(2回目がPASSでなければ承認しない)に従い、`approvals.design.approved`と`approvals.tasks.approved`を`false`にした。2回目の指摘(必須: 合成のファイルの記録を紐付け済み・判定済み・保存先の整合・削除の要求なし・表示から参照しない状態にし、810〜830の対象は専用の行だけで作る。軽微: 検証用の規模でも縮小しない件数、保有者の居ない記録の保有者のIDの並び、毎日の確認の頻度の`operations/006`とタスク8.2・7.14への記載、リリースの前に8割に達した場合の契約、古い文言、30のジョブ)は、設計とタスクに反映したが、再レビューを受けていない。
- **確定の反映のレビュー(やり直し、2026-10-24)**: コーディネーターの指示で、設計のレビューゲートとタスクのレビューゲートを、新しいサブエージェントによる独立した確認で、前回の未レビューの修正(合成のファイルの記録の状態と軽微の修正)を最初に確かめる形でやり直した。1回目は設計・タスクともPASSで、合成のファイルの記録の状態はmedia-pipelineの4:21のジョブの条件と列、user-profile-socialの`OrphanedFileSweepJob`と整合すると判定された。軽微の指摘(`stored_at`と判定の`passed`の明記、810〜830の専用の行の件数と想定の通知、検証用の規模の例外、全文検索の索引は索引文書のトリガーで入ること、30のジョブ、古い文言、リリースの前に契約した場合のA-03と7.15)に従って直した。2.3と7.4の分割の提案は、順序と依存を変えないため見送った。
- **help-centerの仮3の確定(C、管理者が並び順を指定)の反映**: 回帰のE2E(`account-journey`、タスク4.3)に記事の並べ替えの画面`/help-articles/order`での並べ替えが利用者側のヘルプトップとフッターの順に反映されることを、管理者のキーボード操作(タスク5.3)にカテゴリと記事の並べ替えを加え、`ROUTE_INVENTORY`に`/help-articles/order`と`/categories`の並べ替えの状態を含めた(全経路の照合の単体テストが経路の漏れを検出する)。100,000文字の記事はhelp-centerの上限と一致する。
- 2回目(新しいサブエージェント)も設計・タスクともPASSだった。軽微の指摘(回帰のE2Eの並べ替えの前提(モデレーター・専用のカテゴリ・ピン留めの公開記事2件・後片付け)、キーボードの並べ替えの前提と並びの食い違いのやり直し、`ROUTE_INVENTORY`の状態の型、810〜830の専用の行の保有者と条件、索引文書の行の列と再抽出の副作用、Revalidation Triggersへの上流の条件の追加)に従って直した。設計とタスクの承認(`approvals.design.approved`・`approvals.tasks.approved`)を`true`に戻した。本specの仮決定と依存する上流の改訂は全て確定している。
