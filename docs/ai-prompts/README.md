# AIコーディングで使用したプロンプトの記録索引 — Launch Stadium

本プロジェクトは生成AIをフル活用する実験的プロジェクトであり、開発中にどのようなプロンプトを主に使ったか、その原文を記録する。

## プロンプト記録索引

| ドキュメント                                                                   | 内容                                                                                                                                    | 使用モデル        |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| [001-comprehensive-pre-start-review.md](001-comprehensive-pre-start-review.md) | `docs`ディレクトリや`apps`ディレクトリを書き進める前のレビュー                                                                          | Claude Opus最新版 |
| [002-requirements-definition-review.md](002-requirements-definition-review.md) | `docs`ディレクトリや`apps`ディレクトリを書き進める前の[要件定義書](../../README.md)レビュー                                             | Claude Opus最新版 |
| [003-write-service-documents.md](003-write-service-documents.md)               | `docs/GUIDES/service`ディレクトリ内のドキュメントを完成させる                                                                           | Claude Opus最新版 |
| [004-review-service-documents.md](004-review-service-documents.md)             | `docs/GUIDES/service`ディレクトリ内のドキュメントの問題点を調べ、レポートにまとめる                                                     | Claude Opus最新版 |
| [005-duplicate-service-documents.md](005-duplicate-service-documents.md)       | `docs/GUIDES/service`ディレクトリ内の重複を整理し、各規則の「正」となる文書へ集約する                                                   | Claude Opus最新版 |
| [006-create-mockup-client-top.md](006-create-mockup-client-top.md)             | `mockups`アプリの`client/top`ディレクトリ内に、利用者側トップページのデザインモックアップを作る                                         | Claude Opus最新版 |
| [007-create-mockup-client-product.md](007-create-mockup-client-product.md)     | `mockups`アプリに、利用者側プロダクト詳細ページのデザインモックアップを作る                                                             | Claude Opus最新版 |
| [008-create-mockup-client-directory.md](008-create-mockup-client-directory.md) | `mockups`アプリに、利用者側ディレクトリページのデザインモックアップを作る                                                               | Claude Opus最新版 |
| [009-create-mockup-client-profile.md](009-create-mockup-client-profile.md)     | `mockups`アプリに、利用者側ユーザー公開プロフィールのデザインモックアップを作る                                                         | Claude Opus最新版 |
| [010-cc-sdd-discovery.md](010-cc-sdd-discovery.md)                             | `apps`ディレクトリの実装や`docs/GUIDES/tech`ディレクトリのドキュメント作成でサービスを完成させるため、cc-sddのdiscoveryで機能を洗い出す | Claude Opus最新版 |
| [011-cc-sdd-spec-dependencies-table.md](011-cc-sdd-spec-dependencies-table.md) | cc-sddのspecと、それぞれが先に完成を要するspecを一覧表にする                                                                            | Claude Opus最新版 |
| [012-report-env-secrets-table.md](012-report-env-secrets-table.md)             | Infisicalの各環境ごとに設定すべき環境シークレットと、その値の入手・生成方法を一覧表にする                                               | Claude Opus最新版 |
