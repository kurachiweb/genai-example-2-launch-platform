# Brief: infra-delivery

## Problem

Cloudflare資源のコード化(IaC)とCI/CDが存在しないため、staging環境へ随時デプロイして検証することも、mainとprodの各ブランチにブランチ保護の検査を掛けることもできない。リリースは全spec完了後に一括で行う方針だが、それまでにstagingでの継続的な検証が必要である。

## Current State

- `apps/infra`と`.github`は空ディレクトリである。
- Dockerfileには、OpenTofu 1.13.0、Wrangler 4.145.0、Infisical CLI、TruffleHogを使う前提のツールが揃っている。
- tech-stack.mdに、CI/CDの設計(検査フェーズとデプロイフェーズ)が記載済みである。
  - 検査: TruffleHog→`bun install`と脆弱性確認→format→lint→tsc→Infisical(staging)注入→unit・workers・E2Eとカバレッジ閾値
  - デプロイ: OpenTofu→Infisical→D1マイグレーション→`wrangler deploy`
- 配信URL(staging・prod)とポート番号は[README.md](../../../README.md)と[オンボーディング](../../../docs/onboardings/README.md)に定義済みである。

## Desired Outcome

- `apps/infra`のOpenTofu定義で、staging・prod両環境の資源を管理できる。対象はD1、R2の3バケット(画像・ファイル・隔離)、Queues、Workersのカスタムドメイン(api・event・client・admin・画像配信)、DNS、WAF、Turnstileウィジェット、Email Serviceの送信ドメイン、レート制限ルールである。
- OpenTofuで使うシークレットは、`infisical`プロバイダの`ephemeral`リソースからOIDC認証で取得し、stateは暗号化する。
- GitHub Actionsの検査ワークフローが、mainとprodへのPRとpushで動作し、失敗時にマージをブロックできる。
- デプロイワークフローが、mainへのpushでstagingに、prodへのpushでprodにデプロイする。D1マイグレーションの適用と各Workerのデプロイを含む。
- CIが、dev-toolingで決めた共有ディレクトリの配置方式を再現する。
- ブランチ保護の設定内容(必須チェック、prodへの人間の承認)が文書化され、開発者が設定できる状態である。
- `docs/GUIDES/tech/infra`(mermaidによる構成図)、`operations`(デプロイ手順・ロールバック手順)、`security`(シークレット管理)に記載がある。

## Approach

資源の定義はOpenTofu、Workerスクリプトのデプロイはwranglerと役割を分ける。後続specが新しい資源(Queue・Durable Objectsなど)を必要としたら、この構成へ追記できるよう、環境ごとの変数とモジュールの境界を最初に決めておく。

## Scope

- **In**:
  - `apps/infra`のOpenTofu定義(staging・prod)、Infisical連携、state暗号化
  - GitHub Actionsの検査ワークフローとデプロイワークフロー
  - CIでの共有ディレクトリ配置の再現
  - ブランチ保護設定の文書化
  - 上記のtechドキュメント
- **Out**:
  - 死活監視・外部ステータスページ・アラート設定(launch-readiness)
  - 各アプリのWrangler設定の中身(backend-platform・frontend-platform)
  - prod環境への実デプロイの実行(人間が行う)

## Boundary Candidates

- Cloudflare資源の定義
- シークレットの供給経路
- 検査パイプライン
- デプロイパイプラインとマイグレーション適用

## Out of Boundary

- アプリケーションコード
- 監視とアラート

## Upstream / Downstream

- **Upstream**: backend-platform、frontend-platform(デプロイ対象のWorkerとバインディング)
- **Downstream**: launch-readiness、および資源を追加する後続spec

## Existing Spec Touchpoints

- **Extends**: なし
- **Adjacent**: dev-tooling(テストコマンドと共有ディレクトリ方式)、launch-readiness(監視と本番準備)

## Constraints

- CLAUDE.mdのGit運用方針: GitLab Flow。prodへのマージは人間の承認が必須で、AIエージェントによるprod環境へのデプロイは禁止
- CIではBunのテストに`--coverage`を付け、`coverageThreshold`の未達でCIを失敗させる
- Cloudflareの環境種別はstaging・prod、Infisicalの環境種別はdev・staging・prod
- `wrangler deploy`・`tofu apply`はClaudeの設定でdenyされているため、実行は開発者に依頼し、手順を報告する
- Cloudflare系MCPサーバー(cloudflare-api・cloudflare-bindings・cloudflare-builds・cloudflare-observability)は未認証で、認証するまで使えない
- 実現性チェック(2026-10-03)の指摘:
  - Cloudflare provider v5は最新版でもドリフトの不具合報告が続く。providerの版を完全固定する
  - `cloudflare_workers_script`はWranglerでデプロイしたスクリプトをrefreshできないため、Workerスクリプトの管理はWranglerに任せる
  - D1は`read_replication`を明示しないと400エラーになる
  - `cloudflare_turnstile_widget`の`secret`は計算値としてtfstateに平文で保存される。OpenTofuのstate暗号化を有効にし、パスフレーズはInfisicalから注入する
