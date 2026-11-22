# Research & Design Decisions

## Summary

- **Feature**: `data-export`
- **Discovery Scope**: Complex Integration(エクスポートの実装は無い。上流の27spec(dev-tooling〜content-reporting)の設計・タスクは承認済みで、実装はdev-toolingだけが済んでいる。本specは13のドメインspecの出力用の部品、media-pipelineの`MediaFiles`、identity-authの`AccountGuard`・`UserContactDirectory`・設定ページのシェル・ユーザーライフサイクルの非同期の登録口、backend-platformの`RateLimitCounterClient`・メッセージ・定期実行、api-gatewayの内部RESTとGraphQL、frontend-platformの中継の経路、email-deliveryのメールを組み合わせる)
- **Key Findings**:
  - データエクスポートの文書の12のJSONは、すべて上流specの出力用の部品で賄える。欠けているのは`ratings.json`の`invalidatedByAdmin`だけで、engagementの`RatingExportRecord`が仮3(本人に無効化を知らせない)により返さない。文書を正とし(briefの「仕様書を正とする」)、engagementへ項目の追加を求める(仮2)。文書に無い利用者のデータ(同意の記録・停止の理由・送信済みの通知・旧ハンドル・トーナメントの参加の枠・未紐付けのファイル)は含めない。
  - 上流の部品の多くは`Date`で返すが、inquiry-chatの`InquiryExport`は文字列の日時を返し、paymentsの`PaymentHistoryExport`は文書の形の項目を返す。本specは部品の値を本spec固有のスナップショットの型へ写してから、純粋な関数で文書のJSONを組み立てる。部品の形の違いを1か所に閉じ込め、JSONの組み立てをBunの単体テストで文書の例と突き合わせられる。
  - fflateの同期のストリーミングの`Zip`・`ZipPassThrough`・`ZipDeflate`はWorkerを使わずに動く。書き出し側にZIP64は無く、ZIPの合計とオフセットは4GiB未満、項目数は65,535件以下に限られる(仮5)。最新は0.8.3(2026-05-16公開、2週間以上前)である。
  - R2のマルチパートアップロードは、最後以外の部分を同じ大きさ(5MiB以上)にする必要がある。10MiBの固定の大きさの部分に区切って順に送れば、メモリは1つの部分と読み出しの断片に収まり、最大約100GiBまで扱える。完了しなかったアップロードはR2が既定で7日後に破棄するが、本specは失敗とやり直しの時点で明示的に破棄する。
  - backend-platformはメッセージの処理1件のCPU時間を30秒以内とすることを各処理の責任としている。画像・添付ファイルは圧縮せずCRC32の計算と転送だけで、テキストは小さいため、通常の利用者のZIPは数秒のCPU時間で済む見込みである。消費者が落ちた場合に備え、要求の受付時に2時間後の見張りのメッセージを送り、日次の定期実行を最後の受け皿にする。CPU時間はstagingで実測し、上限に近ければeventの`limits.cpu_ms`の引き上げか専用のQueueを開発者に確認する(media-pipelineの前例と同じ扱い)。

## 要件フェーズ前の確認事項(2026-10-24)

本specは開発者に質問できない一括の作成で作った。開発者の判断を要する論点を次の表に記録し、要件定義書・サービス仕様・上流specに最も整合する案を推奨として示した。**仮1〜仮5はいずれも2026-10-24に開発者が確定した。** 仮1・仮2・仮3・仮5は推奨どおり、仮4は推奨と異なる(B)「要求の記録を退会まで残す」である。決定は`requirements.md`の「要件フェーズでの決定」にも記録する。本specに開発者の確認を待つ論点は残っていない。roadmapの「Requirement Ambiguities」の表に本specが担当に含まれる行は無い。新しいnpmパッケージは要らない(fflateはtech-stack.mdに記載済み)。4:21のジョブとライフサイクルの波及処理はすべて本specの2100番台に収まり、上流の値より前に動く必要のある処理は無い。

| #   | 論点                               | 根拠                                                                                                                                                                                                                                                                                                                                                                                                                            | 選択肢                                                                                                                                                                     | 推奨と決定                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 仮1 | 停止中の利用者のエクスポート       | FR-USER-026(停止中の利用者の書き込み操作を拒否)、identity-authの要件4.4(停止中でも既存のセッションでの閲覧・ログアウト・失効・退会を受け付ける)と`AccountExport`の注記(停止中の利用者に生成を認めるかはdata-exportが決める)、LR-006(GDPRのアクセス権とデータポータビリティ権、CCPA/CPRAの開示請求権)、準拠方針の利用者の権利の表                                                                                                | (A)要求・一覧・ダウンロードを認め、メールも送る / (B)要求を拒否し、生成済みのZIPのダウンロードだけを認める / (C)要求もダウンロードも拒否する                               | 推奨は(A)。エクスポートは自分のデータの読み出しであり、利用者の生成したコンテンツの書き込みではない。プライバシー法上の権利の行使は停止で妨げられない。停止中の利用者は新たにログインできないため、使えるのは停止の前のセッションの間だけで、濫用の余地は小さい。隔離された画像は実体を含まずメタデータだけになる(文書の方針どおり)。(B)(C)は停止中の利用者が権利を行使できず、問い合わせでの個別対応が要る。2026-10-24に開発者が確定(推奨どおり) |
| 仮2 | 評価の管理者による無効化の出力     | データエクスポートの文書の`ratings.json`の`invalidatedByAdmin`と全体方針(管理者により非公開扱いのデータはフラグ付きで含める)、briefのOut(エクスポート対象外の判断は仕様書を正とする)、engagementの仮3と設計(出力の記録は管理者による無効化を含めない、本人に知らせない)、FR-ADMUG-030(評価の無効化は通知の対象に無い)                                                                                                           | (A)文書どおり出力し、engagementの`RatingExportRecord`に`invalidatedByAdmin: boolean`を加える / (B)engagementの仮3に合わせて文書から項目を除く                              | 推奨は(A)。briefが文書を正とし、アクセス権の対象は本人に関して処理しているデータ全体である。engagementの仮3の主旨は画面で知らせないことで、エクスポートは文書の全体方針(コメントの`hiddenByAdmin`と同じ扱い)に従う方が一貫する。(B)は無効化された評価が平均から外れている事実を本人が知る手段が無くなる。上流の変更はengagementの部品の項目の追加だけで、engagementが仮5として提供する。2026-10-24に開発者が確定(推奨どおり)                      |
| 仮3 | 参照先や値を求められない項目の出力 | データエクスポートの文書の型(`product`はオブジェクト、`result`は4値、ロゴの元のファイル名は文字列)、product-launchの`ProductDirectory.findSummaries`(論理削除済みを返さない)、match-engineの`MatchExportRecord.result`(未確定は`null`)、`UpvoteExportRecord.productId`(紐付けの解除済みは`null`)、media-pipelineの`findMany`(記録の無いファイルは返さない)、content-reportingの`ReportExport.targetRef`(解決できなければ`null`) | (A)項目を省かず`null`にする(編集していないコメントの`updatedAt`は投稿日時) / (B)求められない項目・要素をJSONから除く                                                       | 推奨は(A)。要素を除くと自分の活動の件数が実際より少なく見え、manifestの件数と食い違う。content-reportingが`reports.json`で同じ扱いを決めている。自分のプロダクト(論理削除済みを含む)へのコメントは`ProductExport`の名称とハンドルで補うため、`null`は他人のプロダクトの論理削除・物理削除に限られる。文書の型の記述は本specが改める。2026-10-24に開発者が確定(推奨どおり)                                                                         |
| 仮4 | 要求の記録の保持と一覧             | DR-005(ZIPは生成完了から7日)、データエクスポートの文書(ダウンロードページで有効期限を表示する)、準拠方針のデータ保持期間の一覧(要求の記録の行が無い)、要件定義書に要求の履歴の定めが無いこと                                                                                                                                                                                                                                    | (A)完了した記録はZIPの削除と同時に、失敗した記録は失敗から7日で削除し、それまでの要求を一覧に表示する / (B)記録を退会まで残す / (C)失敗した記録は一覧に残さない            | 推奨は(A)。記録の目的(状態の表示とダウンロード)はZIPの有効期限で終わる。失敗も同じ7日で消せば、失敗のメールを受け取った後にページで確かめられ、保持期間を1つの規則で説明できる。(B)は保存の最小化に反し、(C)はメールとページの表示が食い違う。**2026-10-24に開発者が(B)を確定(推奨と異なる)**: 要求の記録を退会まで残す。ZIPは生成完了から7日で削除のまま                                                                                         |
| 仮5 | ZIPの大きさと件数の上限            | FR-UDATA-002(1つのZIPアーカイブ)、tech-stack.mdのfflate(書き出し側にZIP64が無い)、FR-PRDCT-006(プロダクトあたり10MB)・FR-INQRY-019(1メッセージ20MB)と件数の上限の無いこと                                                                                                                                                                                                                                                       | (A)ZIPの合計が4GiBを超える、またはファイルが65,535件を超える場合は失敗とし、大きすぎる旨と問い合わせを案内する / (B)ZIP64の書き出しを自前で実装する / (C)複数のZIPに分ける | 推奨は(A)。上限に達するには数百のプロダクトか数百通の大きな添付が要り、現実の利用者ではまず起きない。(B)はZIPの書き出しを自前で持つことになり、検証の負担が大きい。(C)は文書の「ZIPアーカイブ1つ」とダウンロードの画面を変える。上限に達した利用者は問い合わせで個別に対応する。2026-10-24に開発者が確定(推奨どおり)                                                                                                                              |

### 確認済みのため質問しない事項

- 要求の置き場所と登録: 設定ページ`/settings/export`(ページ配置)、設定のナビゲーションの`order` 100(identity-authの設定ページの登録順)。管理画面には置かない。
- 要求できる利用者: メールアドレスを確認済みの利用者に限る(FR-USER-006)。停止中の扱いは仮1。
- 回数制限: 利用者単位で24時間に3回、Durable Objectsの厳密カウンタで数え、期間の開始から24時間でAlarmで0に戻す(FR-RLMIT-006・018)。失敗した要求も回数に含め戻さない(データエクスポートの文書)。キーはハッシュ化する(準拠方針・backend-platformの`HashedRateLimitKey`)。
- 並行の生成: 作成中でも上限に達していなければ再要求でき、複数の生成が並行する(データエクスポートの文書)。
- ZIPの構造・JSONの項目・ファイル名の規則・圧縮の使い分け・UTF-8の印・秘密情報の除外・論理削除と非公開と隔離の扱い(データエクスポートの文書)。
- 保存: ファイル用非公開バケットへ、FR-FILEU-011と同じメタデータで、マルチパートアップロードによりストリーミングで保存する(FR-UDATA-004)。media-pipelineはエクスポートのZIPとそのオブジェクトの記録を持たず、本specが直接扱う(media-pipelineのOut of Boundary)。
- 通知: 完了は件名「データエクスポートの準備ができました」でダウンロードページへのリンクを含め、失敗は件名「データエクスポートに失敗しました」(FR-UDATA-007・009、文言規則)。宛先はidentity-authの`UserContactDirectory`で引く(brief)。取引の通知のため配信停止のリンクは付けない(準拠方針の通知メールのオプトアウト)。
- ダウンロード: 本人としてログインしている場合だけ、利用者側のサイトの同一オリジンの配信経路で、APIサーバーが認可とR2の読み出しを行いフロントエンドサーバーが中継する(FR-UDATA-008・SW-011・COM-003)。ダウンロードページでは有効期限を表示する(データエクスポートの文書)。
- 削除: 生成完了から7日で日次バッチ(4:21)で物理削除する(DR-005・日次タイムライン)。退会した利用者のエクスポートのファイルは物理削除の時期に削除する(FR-USER-022)。
- ジョブと波及処理の`order`: roadmapの帯の割り当ての2100番台を使う。いずれも本specのデータだけを扱い、上流の値より前に動く必要は無い。
- bot判定: エクスポートの要求はSW-018の対象に列挙されていないため課さない(FR-USER-012などの列挙)。

## 要件のレビュー(2026-10-24)

- `/kiro-spec-requirements data-export`の手順で、briefと`docs/requirements/README.md`の4.4・FR-RLMIT-006・018・FR-USER-006・019・022・026・DR-004・005・LR-006・SW-011・COM-003、データエクスポートの文書、ページ配置・文言規則・準拠方針・日次タイムライン、上流specの出力用の部品の設計を読んで下書きを作った。参照したスキルはcc-sddの`kiro-spec-requirements`の規則(ears-format・requirements-review-gate)とテンプレート。
- 機械的な確認: 13の要件の見出しに数字のIDがあり、98件の受け入れ基準がすべてEARSの形である。技術名は要件定義書が用いる用語(マルチパートアップロード・`Content-Disposition`など)と文書の名前に限った。
- 判断のレビューで、(1)回数を数えた後の受け付けの失敗の扱いが抜けていたため2.5に加えた、(2)ダウンロードの404で存在を明かさない旨を9.4・9.5に分けて書いた、(3)生成の途中の退会の扱い(3.7)を加えた。2回目で問題は無かった。

## Research Log

### 上流specの出力用の部品の一覧

- **Context**: roadmapのShared seams「データエクスポートの出力」(各ドメインspecが出力用の部品を持ち、data-exportはそれを呼ぶだけで他のドメインのテーブルを直接読まない)とbriefの制約。全specの`design.md`・`research.md`を「Export」「data-export」「エクスポート」で検索した。
- **Findings**(名前と形は各specのdesign.mdを正とする。すべてapiとeventの両方に束縛され、inquiry-chatだけがeventに束縛される):

| JSON                         | spec                | 部品と識別子                                                                                                             | 形                                                                                                                                                                                       |
| ---------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| account                      | identity-auth       | `AccountExport`(`IDENTITY_PLATFORM_TYPES.AccountExport`、`IDENTITY_PLATFORM_MODULE`)                                     | `find(userId): Promise<AccountExportRecord \| undefined>`。`pseudonymousId`・`email`・`emailVerifiedAt: Date \| null`・`registeredAt`・`mfaEnabled`。退会済み・物理削除済みは`undefined` |
| account.plan                 | ultras-subscription | `UltrasPlanExport`(`ULTRAS_TYPES.UltrasPlanExport`、`ULTRAS_PLATFORM_MODULE`)                                            | `find(userId, now)`。`{ name: 'ultras', status, startedAt, currentPeriodEndsAt, canceledAt } \| null`                                                                                    |
| account.notificationSettings | notifications       | `NotificationSettingsExport`(`NOTIFICATIONS_PLATFORM_TYPES.NotificationSettingsExport`、`NOTIFICATIONS_PLATFORM_MODULE`) | `find(userId): Promise<NotificationSettingsExportRecord \| undefined>`。4つの真偽値と`suppressedReason`                                                                                  |
| account.apiKeys              | public-api          | `ApiKeyExport`(`PUBLIC_API_PLATFORM_TYPES.ApiKeyExport`、`PUBLIC_API_PLATFORM_MODULE`)                                   | `listByUser(userId)`。`name`・`scopes`・`createdAt`、発行の古い順                                                                                                                        |
| profile                      | user-profile-social | `ProfileExport`(`PROFILE_PLATFORM_TYPES.ProfileExport`、`PROFILE_PLATFORM_MODULE`)                                       | `find(userId)`。`handle`・`nickname`・`headline`・`bioMarkdown`・`avatarFileId`・`websites`・`updatedAt`                                                                                 |
| follows                      | user-profile-social | `FollowExport`(`PROFILE_PLATFORM_TYPES.FollowExport`)                                                                    | `listFollowing(userId)`。`handle`・`nickname`・`followedAt`、可視の相手だけ、新しい順                                                                                                    |
| products                     | product-launch      | `ProductExport`(`PRODUCT_PLATFORM_TYPES.ProductExport`、`PRODUCT_PLATFORM_MODULE`)                                       | `listByUser(userId)`。論理削除済みを含む・作成の順。`categoryName`・`descriptionMarkdown`・`logoFileId`・`screenshotFileIds`・`hiddenByAdmin`など                                        |
| launches                     | product-launch      | `LaunchExport`(`PRODUCT_PLATFORM_TYPES.LaunchExport`)                                                                    | `listByUser(userId, now)`。`id`・`productId`・`launchDate`・`status`、ローンチ日の古い順                                                                                                 |
| launches.matches             | match-engine        | `MatchExport`(`MATCH_PLATFORM_TYPES.MatchExport`、`MATCH_PLATFORM_MODULE`)                                               | `listForLaunches(launchIds)`。ローンチごとのマッチ、実施日の古い順。`result`は未確定で`null`                                                                                             |
| launches.awards              | tournament-week     | `WeekAwardExport`(`WEEK_TOURNAMENT_TYPES.WeekAwardExport`、`WEEK_TOURNAMENT_PLATFORM_MODULE`)                            | `listForLaunches(launchIds)`。`{ kind: 'product_of_the_week', period: '2026-W37' }`                                                                                                      |
| launches.awards              | tournament-year     | `YearAwardExport`(`YEAR_TOURNAMENT_TYPES.YearAwardExport`、`YEAR_TOURNAMENT_PLATFORM_MODULE`)                            | `listForLaunches(launchIds)`。`{ kind: 'product_of_the_year', period: '2026' }`                                                                                                          |
| upvotes                      | match-engine        | `UpvoteExport`(`MATCH_PLATFORM_TYPES.UpvoteExport`)                                                                      | `listByUser(userId)`。`productId: string \| null`(名称とハンドルはdata-exportが`ProductDirectory`で引く)、古い順                                                                         |
| comments                     | engagement          | `CommentExport`(`ENGAGEMENT_PLATFORM_TYPES.CommentExport`、`ENGAGEMENT_PLATFORM_MODULE`)                                 | `listByUser(userId)`。未匿名化の自分のコメント、作成の古い順。`productId`・`launchId`・`parentId`・`bodyMarkdown`・`editedAt`・`deletedAt`・`hiddenByAdmin`                              |
| ratings                      | engagement          | `RatingExport`(`ENGAGEMENT_PLATFORM_TYPES.RatingExport`)                                                                 | `listByUser(userId)`。`productId`・`score`・`createdAt`・`updatedAt`。**無効化を返さない**(仮2で追加を求める)                                                                            |
| reports                      | content-reporting   | `ReportExport`(`REPORTING_PLATFORM_TYPES.ReportExport`、`REPORTING_PLATFORM_MODULE`)                                     | `listPage({ userId, after?, limit })`(limit 1〜20)。`records`・`nextAfter`、IDの昇順。`targetRef`は解決できなければ`null`                                                                |
| inquiries                    | inquiry-chat        | `InquiryExport`(`INQUIRY_EXPORT_TYPES.InquiryExport`、eventの`inquiry-module.ts`)                                        | `listPage(userId, after)`。1回20件・IDの昇順。日時はISO 8601の文字列。添付は`fileId`・`originalFileName`(JSONに書かない)・`contentType`・`size`                                          |
| sponsorships                 | sponsorship         | `SponsorshipExport`(`SPONSORSHIP_PLATFORM_TYPES.SponsorshipExport`、`SPONSORSHIP_PLATFORM_MODULE`)                       | `listByUser(userId, now)`。文書の項目(`product`の名称とハンドルを含む)、論理削除済みを除く・申込の順                                                                                     |
| payments                     | payments            | `PaymentHistoryExport`(`PAYMENTS_TYPES.PaymentHistoryExport`、`createPaymentsPlatformModule(<アプリ名>)`の束縛)          | `listAll(pseudonymousId)`。文書の項目の配列、発生時刻の昇順                                                                                                                              |
| ファイル                     | media-pipeline      | `MediaFiles`(`MEDIA_TYPES.MediaFiles`、`MEDIA_PLATFORM_MODULE`)                                                          | `findMany(fileIds): Promise<ReadonlyMap<string, MediaFileView>>`、`openContent(fileId): Promise<MediaContent \| undefined>`(保存完了・未削除・隔離中でないものだけ)                      |
| 名称の補完                   | product-launch      | `ProductDirectory`(`PRODUCT_PLATFORM_TYPES.ProductDirectory`)                                                            | `findSummaries(productIds, 'not-deleted')`(90件ずつ、論理削除済みを返さない)                                                                                                             |

- **欠けている部品**: `ratings.json`の`invalidatedByAdmin`だけ(仮2)。要件定義書4.4と文書の対象に照らすと、部品の無い利用者のデータ(identity-authの同意の日時、ugc-moderationの措置の記録、notificationsの送信済みの通知、user-profile-socialの旧ハンドル、tournament-week・yearの参加の枠、media-pipelineの未紐付けのファイル、paymentsの購入と同意の記録)は文書に無く、briefのOut(仕様書を正とする)により含めない。トーナメントの参加は`payments.json`(参加費)と`launches.json`(マッチと受賞)に現れる。help-center・legal-pages・admin-foundationは利用者の所有するデータを持たない(legal-pagesは同意した版の照会口を必要になったspecが使うとしているが、文書に項目が無い)。
- **Implications**: 本specは19の部品(ファイルの照会を除く)を3つの読み取りの部品(アカウント・プロダクトと活動・やり取りと取引)に分けて注入し、本spec固有のスナップショットの型へ写す。上流の変更はengagementの1項目だけで、engagementが仮5として提供する。

### ZIPのストリーミングの生成(fflate)

- **Context**: brief・roadmapの実現性チェック(fflateの非同期APIはWeb Workerか`worker_threads`が前提でworkerdで動かない)、FR-UDATA-002・006、文書の圧縮とUTF-8の印。
- **Sources Consulted**: fflateのREADMEと`src/index.ts`、npmの登録情報(0.8.3が2026-05-16公開で最新、0.8.2は2024-02-07)。
- **Findings**:
  - `Zip`(出力の断片を受け取る関数を渡す)に`ZipPassThrough`(格納)・`ZipDeflate`(同期の圧縮)を`add`し、各項目へ`push(chunk, final)`、最後に`end()`する。同期のAPIだけを使えばWorkerは要らない。`AsyncZipDeflate`・`zip`(非同期)は使わない。
  - 大きさの分からない項目はデータ記述子(フラグのビット3)で書かれる。CRC32はfflateが計算する。
  - 書き出し側はZIP64の拡張を書かない。大きさとオフセットは4バイトで、合計4GiB未満・項目65,535件以下に限られる(仮5)。
  - ローカルの項目のヘッダーのフラグのビット11(UTF-8)は、内部の判定の値で立つ。非ASCIIのファイル名で立つことを単体テストで確かめる(立たなければ実装を止めて開発者へ報告する)。
  - 出力の断片を受け取る関数は同期で呼ばれるため、`push`の後に溜まった断片を非同期の書き込み先へ順に流してから次の入力を読む形にすれば、メモリは入力の断片の大きさに比例する範囲に収まる。
- **Implications**: `ZipArchiveWriter`(`backend-lib/core/data-export`)がfflateを包み、書き込み先の口`ArchiveByteSink`だけに依存させる。Bunの単体テストでメモリ上の書き込み先とfflateの`unzipSync`で検証できる。eventの`package.json`へ`fflate`を0.8.3で版固定して加える(tech-stack.mdに記載済みのため、開発者への新しいパッケージの質問は要らない)。

### R2のマルチパートアップロード

- **Context**: FR-UDATA-004、Workersのメモリ128MB。
- **Sources Consulted**: Cloudflare R2「Multipart objects」。
- **Findings**: 最後以外の部分は5MiB以上で全て同じ大きさにする。1部分は最大5GiB、最大10,000部分、オブジェクトは最大5TiB。完了しなかったアップロードは既定で7日後に破棄される。Workersのバインディングでは`createMultipartUpload(key, { httpMetadata })`・`uploadPart(n, value)`・`complete(parts)`・`abort()`・`resumeMultipartUpload(key, uploadId)`を使う。
- **Implications**: 部分の大きさを10MiB(10,485,760バイト)に固定し、`PartChunker`(純粋な関数)で出力を区切る。書き込み先は1つの部分の大きさのバッファを持ち、満ちたら送って再利用する。最大約100GiBまで扱えるため、ZIPの上限(4GiB)が先に効く。やり直し・失敗・見張り・期限切れの削除・物理削除で`uploadId`があれば`abort`する。

### 実行環境の制約と再試行・遅延

- **Context**: backend-platformの設計(consumerはバッチ10件を1件ずつ処理し、1件のCPU時間30秒以内は各処理の責任。`defer`は試行回数を数えずに再送。`max_retries` 6・`retry_delay` 30・DLQ)、Queuesのconsumerの実時間の上限(15分)、`PublishOptions.delaySeconds`(0〜43200)。
- **Findings**:
  - CPU時間の主な消費はCRC32の計算とテキストの圧縮で、数百MBのZIPでも数秒の見込みである。画像の判定(media-pipeline)と同じバッチに入っても通常は収まる。
  - consumerがCPU時間の超過などで落ちると、本specのコードは失敗を記録できず、Queuesの再配信の後にDLQへ移る(DLQの処理はログだけ)。
  - 同じメッセージが重ねて配られることがある(少なくとも1回の配送)。
- **Implications**: (1)要求の記録にリース(実行の印と期限20分)を持たせ、生成の開始で取り、重複の配送は`defer`で待たせる。(2)処理の再試行は最大3回(起点60秒・上限600秒)とし、3回目の失敗で失敗を確定して通知する。(3)受付時に2時間後の見張りのメッセージ`data-export.check-generation`を送り、作成中のままなら失敗を確定する(consumerが落ちた場合の通知の遅れを2時間に抑える)。(4)日次の定期実行で、3時間を過ぎた作成中の要求と依頼待ちの通知を処理する(見張りのメッセージを送れなかった場合の受け皿)。

### ダウンロードの経路

- **Context**: SW-011・COM-003・FR-UDATA-008、media-pipelineの`FILE_DOWNLOAD_RELAY_ROUTE`(`/_bff/files/*`→`/internal/media/files/:fileId`、`timeoutMs` 120000)、frontend-platformの`relayToApi`(`AbortSignal.timeout(route.timeoutMs)`)。
- **Findings**: media-pipelineの経路は`media_files`の記録と`FileAccessAuthorizer`で認可するため、記録を持たないエクスポートのZIPには使えない。中継の時間切れは本文の転送中にも効く可能性がある。
- **Implications**: 本specの内部REST`GET /internal/data-exports/:exportId/archive`(api)と中継の経路`/_bff/exports/*`(client)を新設する。ZIPはメディアより大きいため`timeoutMs`を900000(15分)とし、遅い回線で切れた場合は再度ダウンロードできる。管理者側の`relay-routes.ts`には加えず、apiでも呼び出し元が利用者側であることを確かめる。

### 通知の宛先と送り直し

- **Context**: identity-authの`UserContactDirectory.findContact`(退会済み・物理削除済みは`undefined`、停止中は返す。`nickname`も返す)、email-deliveryの`EmailSender.send`、content-reporting・ugc-moderationの依頼待ちの通知と日次の送り直し。
- **Implications**: 要求の記録に通知の状態(なし・依頼待ち・依頼済み・送らない)を持ち、完了・失敗の確定と同じ書き込みで「依頼待ち」にする。依頼の成功後に「依頼済み」へ進め、失敗は日次の定期実行で送り直す。1つの要求につき完了か失敗のどちらか1つしか確定しないため、メールは1通になる。

## Architecture Pattern Evaluation

| Option                                         | Description                                                                                   | Strengths                                                                          | Risks / Limitations                                                                                   | Notes  |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------ |
| 1回の処理で全体を生成する(採用)                | 1つのメッセージの処理で、データの収集→画像・添付の格納→JSONの格納→完了までを行う              | ZIPの書き出しの状態を保存せずに済み、構成が単純。データの一貫性を1回の収集で保てる | 極端に大きいZIPではCPU時間・実時間の上限に近づく。stagingで実測し、近ければ`limits.cpu_ms`を確認する  | 採用   |
| 区切りごとにメッセージを分けて続きから生成する | 項目の区切りで書き出しの状態(中央ディレクトリ・送った部分・端数)をR2へ保存し、`defer`で続ける | 1回の処理のCPU時間を確実に抑えられる                                               | 端数のバイト列と中央ディレクトリの保存と再開、収集した内容の保存が要り、実装と検証が大きく増える      | 不採用 |
| 生成をAPIサーバーの要求の中で行う              | 要求の応答の前にZIPを作る                                                                     | 構成が最も単純                                                                     | FR-UDATA-005(非同期・即時応答)に反する                                                                | 不採用 |
| メディアのファイル配信の経路を流用する         | ZIPを`media_files`に登録して`/_bff/files/*`で配る                                             | 中継の経路を増やさない                                                             | media-pipelineがエクスポートの記録を持たない境界(同specのOut of Boundary)に反し、認可の方針も合わない | 不採用 |

## Design Decisions

### Decision: 部品の値を本spec固有のスナップショットへ写してから純粋な関数でJSONを組み立てる

- **Context**: 上流の19の部品とファイルの照会の形は日時の型・項目名・並びがまちまちで、文書の項目名とも異なる。
- **Alternatives Considered**:
  1. 部品の値を直接JSONへ書く — 部品ごとの差異がZIPの書き出しの処理に散る。
  2. スナップショットの型を挟む(採用)。
- **Selected Approach**: eventの3つの読み取りの部品が上流の値を`ExportSnapshot`(`backend-lib/core/data-export`の型、`Date`と`null`で統一)へ写す。`buildExportDocuments`が、スナップショット・ZIP内のパスの計画・実際に格納できたファイルの集合から、12のJSON・manifest・マークダウン本文を返す。
- **Rationale**: 文書の例との突き合わせをBunの単体テストで行え、上流の形の変更は読み取りの部品の写しだけを直せばよい。
- **Trade-offs**: 型の写しの記述が増える。
- **Follow-up**: 上流の部品のRevalidation Triggers(各specの「エクスポートの部品の形」)に当たる変更があれば、読み取りの部品とその統合テストを確かめ直す。

### Decision: 画像・添付ファイルを先に、JSONを最後に書く

- **Context**: `MediaFiles.findMany`で隔離されていなかったファイルも、`openContent`の時点で隔離・削除されていれば読めない。JSONのパスと実体が食い違うおそれがある。
- **Selected Approach**: ZIP内のパスを先に計画し、画像・添付ファイルを順に`openContent`で格納して、実際に格納できたファイルIDの集合を作る。その後でJSON・マークダウン本文・manifest・READMEを書く。格納できなかったファイルはパスを`null`にし、隔離の印は`openContent`の直前の`findMany`の値に従う。
- **Rationale**: ZIPの項目の順は展開に影響しない。JSONが常に実体と一致する。
- **Trade-offs**: `README.txt`がZIPの先頭に来ない。

### Decision: リース・処理の再試行・見張りのメッセージ・日次の受け皿の4段で失敗を確定する

- **Context**: 少なくとも1回の配送、consumerの異常終了、通知の1通の保証(要件3.4〜3.6・8.3)。
- **Selected Approach**: 生成の開始で`claim`(作成中・期限切れのリースのときだけ実行の印と期限20分を書く条件付きの更新)を行う。完了は実行の印が一致するときだけ`ready`にする条件付きの更新とし、一致しなければ作ったZIPを削除する。失敗の確定は作成中からだけの条件付きの更新とする。処理の例外は3回目までやり直し、3回目で失敗を確定する。2時間後の見張りと日次の定期実行(3時間を過ぎた作成中)が、consumerの異常終了を拾う。
- **Rationale**: どの経路で失敗が確定しても、状態の遷移は1回だけで、通知の状態も1回だけ「依頼待ち」になる。
- **Trade-offs**: 2時間を超えて正常に生成が続く場合は失敗にされるが、consumerの実時間の上限(15分)と再試行(3回)の合計より長いため起きない。

### Decision: 回数を数えた後の受け付けの失敗は記録を消して503を返す

- **Context**: Durable Objectの`hit`は記録とメッセージの送信より先に行う必要がある(同時の要求で上限を超えないため)。
- **Selected Approach**: `hit`→記録の作成→生成のメッセージの送信の順とし、送信に失敗したら記録を削除して`unavailable`を返す。回数は戻さない(`reset`は期間全体を消すため使えない)。見張りのメッセージの送信の失敗は警告のログに留め、日次の受け皿に任せる。
- **Rationale**: 文書の「失敗しても回数をリセットしない」と同じ扱いで、利用者に受け付けたと誤って伝えない。

### Decision: 生成と保存はeventだけ、照会・ダウンロード・日次のジョブはapiで行う

- **Context**: 回数制限のDurable Objectとダウンロードの中継はapiにだけある。生成はQueueのconsumer(event)の役割(FR-UDATA-005)。定期実行はapiの`scheduled-jobs.ts`。
- **Selected Approach**: 要求の記録の読み書き・ZIPの保存先の操作・通知・失敗の確定を`backend-lib/workers/data-export`に置き、`DATA_EXPORT_PLATFORM_MODULE`でapiとeventの両方に束縛する。上流の出力用の部品の読み取りとZIPの組み立てはeventのアプリケーション層だけに置く。
- **Rationale**: apiの日次のジョブとeventの見張りが、同じ失敗の確定と通知の処理を使える(content-reportingの`workers/reporting`と同じ形)。

### Decision: 採らなかった案

- 区切りごとの再開(Architecture Pattern Evaluationの2行目)、メディアの配信経路の流用(同4行目)。
- 要求の画面に残りの回数を表示する案: `RateLimitCounter`は`hit`と`reset`だけを持ち、回数を読む口が無い。D1の要求の記録から数えると、固定の期間(最初の要求から24時間)のDurable Objectと食い違う。上限の説明と、429の再試行の秒数から求めた日時の表示に留める。
- 退会(`withdrawn`)の時点でZIPを削除する案: FR-USER-022は物理削除の時期の削除を定め、7日の期限が先に来ることが多い。生成の途中の退会は生成を止める(要件3.7)。

## Synthesis

- **Generalization**: 「各ドメインの出力の部品を読み取り、ストリーミングで1つのアーカイブにし、分割アップロードで保存して、本人だけに期限付きで配る」は、利用者のデータの持ち出しに一般的な形である。`ZipArchiveWriter`・`PartChunker`・ZIP内のファイル名の規則は文書の値に依存しない汎用の部品とし、技術ドキュメント`backend/023`に一般化して書く。本人だけの生成物の配信と期限は`security/012`に書く。
- **Build vs. Adopt**: ZIPはfflate(採用済み)、分割アップロードはR2のバインディング、回数制限はbackend-platformの`RateLimitCounter`、メールはemail-delivery、中継はfrontend-platformの`RelayRoute`を使う。自前で書くのはZIPの書き出しの包み・部分の区切り・ファイル名の変換とJSONの組み立てだけである。
- **Simplification**: 要求の記録の1テーブルだけを持つ。状態は4つ(待ち・生成中・完了・失敗)で、画面とGraphQLでは待ちと生成中を「作成中」にまとめる。回数の残りの表示・再開の仕組み・管理画面は持たない。

## Risks & Mitigations

- CPU時間30秒・実時間15分の超過 — 通常は数秒の見込み。生成の完了・失敗でZIPのバイト数・件数・所要時間をログに残し(要件12.2)、stagingで画像と添付の多い利用者を作って実測する。上限に近ければeventの`limits.cpu_ms`の引き上げか専用のQueueを開発者に確認する。超過で落ちても見張りが2時間で失敗を確定して通知する。
- メモリ128MB — 収集したデータ(テキスト)・1つの部分のバッファ(10MiB)・読み出しの断片だけを持つ。`FollowExport`・`UpvoteExport`などは全件を返すため、件数の極端に多い利用者で数MBになるが上限には遠い。
- fflateのUTF-8の印 — 単体テストで非ASCIIのファイル名のビット11を確かめる。立たない場合は実装を止めて開発者に報告する。
- ZIP64が無い — 仮5の上限で失敗とし、大きすぎる旨を通知する。
- 中継の時間切れ — `timeoutMs`を15分にする。遅い回線で切れれば再度ダウンロードできる(期限内は何度でも)。
- engagementの仮5(`invalidatedByAdmin`の提供)と本specの仮2 — どちらも2026-10-24に開発者が確定し、engagementが項目を提供する。本specはタスク2の契約のテストで提供を確かめる。
- 生成と退会の競合 — 開始と完了の直後に`AccountExport.find`で確かめ、退会済みならZIPを削除して通知しない。

## References

- [Cloudflare R2 Multipart objects](https://developers.cloudflare.com/r2/objects/multipart-objects/) — 部分の大きさの規則と未完了のアップロードの破棄
- [fflate](https://github.com/101arrowz/fflate) — 同期のストリーミングのZIPと`src/index.ts`のヘッダーの書き出し
- [npm: fflate](https://registry.npmjs.org/fflate) — 0.8.3(2026-05-16)
- `docs/requirements/README.md` — 4.4、FR-RLMIT-006・018、FR-USER-006・019・022・026、DR-004・005、LR-006、SW-011、COM-003、FR-FILEU-011・020
- `docs/GUIDES/service/features/001-user-data-export.md` — ZIPの構造とJSONの項目
- `docs/GUIDES/service/design/002-page-layouts.md`・`003-text-and-copy-rules.md` — `/settings/export`、メールの件名
- `docs/GUIDES/service/legal/001-compliance-policy.md` — 利用者の権利とデータ保持期間
- `docs/GUIDES/service/overview/007-daily-timeline.md` — 4:21の日次バッチ
- 上流specの`design.md`(Research Logの一覧の部品)、backend-platform(`RateLimitCounterClient`・メッセージ・定期実行)、api-gateway(`createInternalRoutesModule`・`defineSchemaModule`)、frontend-platform(`RelayRoute`)、identity-auth(`AccountGuard`・`SETTINGS_NAV_ITEMS`・`USER_LIFECYCLE_ASYNC_HANDLERS`)、email-delivery(`EmailSender`)、media-pipeline(`MediaFiles`・`attachmentDisposition`)

## 決定(2026-10-24に開発者が確定)

要件と設計の作成中に生じた、開発者の判断を要する論点と、2026-10-24の開発者の決定である。仮1・仮2・仮3・仮5は推奨どおり、仮4は推奨と異なる案に決まった。`requirements.md`の「要件フェーズでの決定」にも同じ行がある。

| #   | 論点                         | 決定した案                                                                                                                              | 他の選択肢                                                          | 影響する箇所                                                                                                                                                                               |
| --- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 仮1 | 停止中の利用者のエクスポート | 要求・一覧・ダウンロードを認め、メールも送る                                                                                            | 要求を拒否しダウンロードだけ / 両方拒否                             | 要件1.5・8.4、`DataExportRequestService`・`ArchiveDownloadService`(`requireUser`)、準拠方針                                                                                                |
| 仮2 | 評価の無効化の出力           | 文書どおり`invalidatedByAdmin`を出力し、engagementの仮5(確定)の項目を使う                                                               | 文書から項目を除く                                                  | 要件5.6、`ProductActivitySourceReader`・`buildRatingsDocument`、engagementの`RatingExportRecord`                                                                                           |
| 仮3 | 求められない項目の出力       | 省かず`null`(編集していないコメントの`updatedAt`は投稿日時)                                                                             | 項目・要素を除く                                                    | 要件5.12、`export-documents`の各関数、データエクスポートの文書                                                                                                                             |
| 仮4 | 要求の記録の保持と一覧       | (B)要求の記録を退会まで残す。ZIPは7日で削除し記録を期限切れにする。一覧は全ての状態を20件ずつ表示し、退会で記録を削除する(推奨と異なる) | 推奨: 完了はZIPの削除と同時、失敗は7日で削除 / 失敗は一覧に残さない | 要件3.8・10.*・11.1・11.8、`ArchiveExpiryJob`・`ArchiveErasureHandler`(`withdrawn`)・`DataExportStore`(`markExpired`・`listByUserPage`)・`myDataExports`の`DataExportConnection`、準拠方針 |
| 仮5 | ZIPの大きさと件数の上限      | 4GiB・65,535件を超えたら失敗とし、大きすぎる旨を通知                                                                                    | ZIP64を自前で書く / 複数のZIPに分ける                               | 要件7.4・8.2・11.8、`ArchiveLimits`・`ZipArchiveWriter`・失敗のメール                                                                                                                      |

## 要件定義書の改訂が必要な箇所

**2026-10-25に要件定義書(`docs/requirements/README.md`)へ適用済み。** 以下は適用前に記録した改訂の内容である。

要件定義書(`docs/requirements/README.md`)は本specでは編集しない(roadmapのOut)。次の改訂を推奨する。

| 要件ID                    | 内容                                                                                                                                                                 | 根拠   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| FR-USER-026・FR-UDATA-001 | 停止中の利用者もデータエクスポートを要求・ダウンロードできる旨(書き込み操作に含めない)を加える                                                                       | 仮1    |
| FR-UDATA-002              | ZIPの大きさ(4GiB)と格納するファイルの件数(65,535件)の上限と、超えた場合は失敗として通知する旨を加える                                                                | 仮5    |
| DR-005                    | ZIPは生成完了から7日で物理削除し、データエクスポートの要求の記録(要求日時・状態・ファイル名・大きさ・完了と期限と失敗の日時)は利用者が退会するまで保持する旨を加える | 仮4(B) |
| FR-USER-019・FR-USER-022  | 退会の時点でデータエクスポートの要求の記録と残っているZIPを物理削除する旨を加える(FR-USER-022の「FR-UDATA-004」のファイルの削除を退会の時点にも広げる)               | 仮4(B) |

## 上流・後続specへの影響

- engagement(上流): `apps/backend-lib/core/engagement/ports.ts`の`RatingExportRecord`の`readonly invalidatedByAdmin: boolean;`と、評価の行の無効化の印から値を返す`RatingExport.listByUser`(D1の実装は`apps/backend-lib/workers/engagement/d1-engagement-export.ts`の`D1RatingExport`、コメントは同じファイルの`D1CommentExport`)は、engagementがその仮5(2026-10-24に開発者が確定)として提供する。本specはengagementのファイルを変更せず、タスク2の契約のテストで提供された項目を確かめる。本specの仮2も同日に確定した。
- identity-auth(上流): clientの`composition/settings-navigation.ts`の`SETTINGS_NAV_ITEMS`に`{ to: '/settings/export', label: 'データエクスポート', order: 100 }`、eventの`composition/user-lifecycle-async-handlers.ts`に`data-export.archive-erasure`(`withdrawn`・`purge_due`、2100)を加える(契約どおり)。`AccountExport`・`AccountGuard`・`UserContactDirectory`を使う。
- backend-platform(上流): `core/messaging/contracts/index.ts`に2つのメッセージ種別、eventの`message-handlers.ts`に2つの処理、apiの`scheduled-jobs.ts`に2つのジョブ(4:21の式は上流で追加済み)、api・eventの`modules.ts`にモジュールを加える(契約どおり)。eventの`limits.cpu_ms`はstagingの実測の結果で開発者が判断する(本specは変更しない)。
- api-gateway(上流): apiの`graphql-modules.ts`に`dataExportSchemaModule`、`internal-routes.ts`に`GET /internal/data-exports/:exportId/archive`、clientの許可リストの再生成(契約どおり)。
- frontend-platform(上流): clientの`composition/relay-routes.ts`に`DATA_EXPORT_DOWNLOAD_RELAY_ROUTE`を加える(契約どおり)。
- email-delivery(上流): `core/email/kinds/index.ts`に2種別、eventの`infrastructure/email/templates/index.ts`に2テンプレート(契約どおり)。
- media-pipeline・product-launch・match-engine・tournament-week・tournament-year・user-profile-social・ultras-subscription・notifications・public-api・content-reporting・inquiry-chat・sponsorship・payments(上流): 既存の出力用の部品と照会を呼ぶだけで変更しない。
- launch-readiness(後続): 本番前の負荷の検証で、大きいエクスポートのCPU時間・メモリ・実時間と、ダウンロードの中継の時間切れを確かめる。
- roadmap: 帯の割り当ての表の本specの「使用中の値」は「4:21は2100・2110、波及処理は2100」。Requirement Ambiguitiesの表に本specが担当に含まれる行は無い。本specはroadmapを編集しないため、コントローラーへ報告する。

## 設計のレビュー(2026-10-24)

- `/kiro-spec-design data-export -y`の手順で、要件を承認し(`-y`による自動の承認)、設計の下書きを作った。参照したスキルはcc-sddの`kiro-spec-design`の規則(design-principles・design-discovery-full・design-synthesis・design-review-gate)とテンプレート。外部の調査はR2のマルチパートの規則とfflate(ZIP64・UTF-8の印・版)に絞った。
- 機械的な確認: 要件の98件の受け入れ基準の番号がすべて追跡表にあることを、スクリプトで確かめた。境界の4節(This Spec Owns・Out of Boundary・Allowed Dependencies・Revalidation Triggers)は空でない。ファイル構成に全コンポーネントの置き場所がある(上流への追加と登録は「Modified Files」)。
- 1回目の判断のレビューで、(1)異常終了した前の実行の未完了のアップロードを次の`claim`で破棄する手順が無かったため加えた、(2)退会の確かめを`markReady`の後に置くと完了から失敗へ戻せないため、`complete`の後・`markReady`の前へ移した。2回目で問題は無かった。
- 境界の確認: 上流のテーブルを読み書きせず、出力用の部品・`MediaFiles`・登録口だけを使う。上流の契約の変更はengagementの`invalidatedByAdmin`の追加だけで、engagementが仮5として提供する。
- 技術ドキュメントの番号: 完了済みspecのdesign.mdの計画は`backend`001〜022、`frontend`001〜021、`db`001〜008、`security`001〜011、`infra`001〜008、`external`001〜008、`operations`001〜004、`coding`001〜004、`testing`001〜002である。本specは`backend/023`・`security/012`を取る。サービス仕様の`features`は既存の001を更新し、新しい番号を取らない。

## タスクの計画の検証(2026-10-24)

- `/kiro-spec-tasks data-export -y`の手順で、要件と設計を承認し(`-y`による自動の承認)、タスクの計画の下書きを作った。要件の98件の受け入れ基準の番号がすべてタスクにあること、タスクが要件に無い番号を参照しないことを、スクリプトで確かめた。自分の確認で、並行の印の付いたタスクがapi・eventの本specのモジュールの同じファイルを触る衝突を見つけ、並行の印を外した。
- タスクのグラフのサニティレビューを、新しいサブエージェントによる独立した確認(independent)で行った。
- 1回目の判定はNEEDS_FIXES(必須2件・軽微7件)だった。必須の指摘は、(1)利用者側の許可リストはclientの操作の生成の後でなければ再生成できない(5.2から7.1へ移す)、(2)`apps/backend-lib`の検査とテストはapiが行う(`config/workspace-layout.ts`の`checkedBy: 'api'`)ため、fflateはapiでも解決できなければならず設計と食い違う、であった。設計にapiの依存を加え、DIの識別子のファイルの持ち主・`AccountSourceReader.exists`・ダウンロードの503・clientのタスクの分割・密なタスクの分割とともに直した。
- 2回目の判定(新しいサブエージェントによる独立した確認)もNEEDS_FIXES(必須1件・軽微6件)だった。必須の指摘は、5.2でapiのスキーマの生成(`graphql:generate`)を行わず7.1で`graphql:check`を確かめていないため、clientの型の生成が本specの操作を読めず検査に失敗する、であった。軽微の指摘は、日時の書式の補助の持ち主(3.1へ)、仮2の(B)の場合に直す箇所の漏れ(3.1・6.3・8.1)、6.3がeventのDIの識別子のファイルを触らない旨、4.3の分割、7.3のルートの置き換え、8.1への3回目の失敗と退会済みの通知なしの追加である。
- `kiro-spec-tasks`の規則(2回目の判定がPASSでなければ`tasks.md`を書かず承認もしない。3回目の確認を行わない)に従い、ここで止めた。2回目の指摘はすべて下書きへ反映済みで、設計には日時の書式の補助`documents/export-formats.ts`を加えた。下書きは本specの作成のセッションの一時ディレクトリにあり、`/kiro-spec-tasks data-export -y`を再び実行して、反映済みの下書きを新しい独立した確認に通してから`tasks.md`を書く。

## タスクの計画の検証の再実行(2026-10-24)

- コントローラーの指示により、`/kiro-spec-tasks data-export -y`を、前回の反映済みの下書きを統合の文脈として再び実行した。あわせて、engagementの`RatingExportRecord.invalidatedByAdmin`はengagementがその仮5として提供する扱いに改め、下書きのタスク2(engagementのファイルの変更)を、イベントサーバーのコンテナから上流の19の部品と`MediaFiles`を解決でき`RatingExport`が無効化の有無を返すことを確かめる本spec側の契約のテストへ置き換え、タスク2と6.3の保留を外した。設計の「上流への影響」の文言も改めた。本specの仮2はその後2026-10-24に開発者が確定した。
- 1回目の判定(新しいサブエージェントによる独立した確認)はNEEDS_FIXES(必須1件・軽微5件)だった。必須の指摘は、通知(4.3)が`@inject`で使う共通のDIの識別子を後のタスク(4.4)が作るため、通知のタスクが書けない、であった。識別子を4.1で4つまとめて定め、要求の記録のタスクを作成・照会・削除(4.1)と状態の遷移・日次の照会(4.2)に分けて4.1〜4.5に並べ直した。軽微の指摘(並行のタスクの隣の`_Boundary:_`、6.2の要件12.3、1.5を意図した結合のタスクと明記、設計の依存の方向へのmedia-pipelineと`PLATFORM_TYPES`の追加)も直した。
- 2回目の判定(新しいサブエージェントによる独立した確認)もNEEDS_FIXES(必須1件・軽微3件)だった。必須の指摘は、設計の依存の方向の許可の一覧が狭く、`core/data-export`のメッセージ契約(`defineMessageContract`・`zod`)・メール種別と、`workers/data-export`の`common-lib/data-export`・メール種別・`AppModule`・ログ・`IDENTITY_PLATFORM_TYPES`・`EMAIL_TYPES`の読み込みが規則の上で誤りになる、であった。軽微の指摘は、上流の部品の数(20ではなく19と`MediaFiles`)、6.6・5.4のエラートラッキングへの送信のテストと要件12.3、3.5の完了状態の依存の記述である。いずれもタスクの構成を変えない局所の修正のため、設計とタスクへ反映した。
- 規則の上限(2回)に達したため3回目の確認は行わず、コントローラーの指示により`tasks.md`を未承認の下書きとして書いた(`approvals.tasks.approved`は`false`)。2回目の指摘はすべて反映済みである。承認するには、反映後の`tasks.md`を新しい独立した確認に通す。

## タスクの計画の検証の再々実行(2026-10-24)

- コントローラーの指示により、既存の`tasks.md`を下書きとして`/kiro-spec-tasks data-export -y`を再び実行した。新しいサブエージェントによる独立した確認(independent)で、設計の依存の方向の許可の一覧(前回の2回目で広げた箇所)も確かめた。launch-readinessの並行の作成に備え、本specの公開の契約(GraphQLの`myDataExports`・`requestDataExport`と`DataExport`の形、内部REST`GET /internal/data-exports/:exportId/archive`、中継の経路`/_bff/exports/*`、メッセージ種別2つ、ジョブと処理の名前と`order`)は変えていない。
- 1回目の判定はNEEDS_FIXES(必須3件・軽微7件)だった。必須の指摘はいずれも設計の依存の方向の許可の一覧で、(1)clientが`common-lib/data-export`を読み込めない、(2)上流の部品の型を読む契約と結合のテスト(`apps/event/test/data-export/`)が許されていない、(3)`workers/data-export`の一覧に`inversify`・`drizzle-orm`・backend-platformの識別子の型が無い、であった。段落を書き直し、`apps/db/schema/data-export`が`common-lib`を読まない形、`DataExportNotifier`の`CLIENT_SITE_ORIGIN`の型、Allowed Dependenciesの`MessageContract`・型・npmパッケージ、許可リストの記述、タスク1.2・2・4.4・5.2・7.1・8.1も直した。
- 2回目の判定(新しいサブエージェントによる独立した確認)はPASSだった。軽微の指摘5件(CHECKの値と定数の一致の確認を`workers/data-export`のテスト(4.1)へ移す、許可リストの正しいパス`apps/api/src/presentation/graphql/generated/allowlist.json`、テストが読み込めるものの明記、8.1のカバレッジの計測を3アプリにする、失敗のメールの問い合わせのURLを`CLIENT_SITE_ORIGIN`からの絶対URLにする)に従って直した。いずれもタスクの構成と公開の契約を変えない。
- タスクの計画を承認した(`-y`)。

## cross-spec reviewの指摘による修正(2026-10-24)

- 振る舞いを変えない整合の修正のため、改訂の番号は付けない(cross-spec reviewの指摘による)。
  - GraphQLのスキーマモジュールのルート型を、api-gatewayの規則(`extend`を使わない)に合わせて`type Query`・`type Mutation`に直し、tasks.mdの5.2に明記した。
  - E2E・統合テストで定期実行をローカルで起動する手順が無いことを確かめた(共有の補助`triggerScheduled`への置き換えの対象は無い)。
- 変更したタスクの部分を、新しいサブエージェントによる独立した確認(kiro-spec-tasksの基準)で検証し、1回目の判定はPASSだった。タスクの承認を保つ。

## 決定の反映(2026-10-24)

- 開発者の回答で、仮1・仮2・仮3・仮5は推奨どおり、仮4は推奨と異なる(B)「要求の記録を退会まで残す」に確定した。engagementの仮5(`invalidatedByAdmin`の提供)も推奨どおり確定した。本specに開発者の確認を待つ論点は残っていない。
- 仮4(B)の反映で決めたこと:
  - 状態に「期限切れ」(`expired`)を加える。4:21の`data-export.archive-expiry`はZIPだけを削除して完了を期限切れにし(`markExpired`。ファイル名・大きさ・完了と期限の日時は履歴として残し、キーを外す)、記録を削除しない。失敗の記録も削除せず、残る途中のアップロードだけを破棄する(`listFailedWithUpload`・`clearUpload`)。
  - 一覧の表示: 期限切れ・失敗を含む退会までの全ての記録を、要求日時の新しい順に20件ずつ表示し、「さらに表示」で続きを読み込む(GraphQLの`myDataExports(first, after): DataExportConnection!`、api-gatewayのページングの規約)。期限切れは完了日時・有効期限・ファイル名・大きさと「有効期限を過ぎたため削除しました」を示し、ダウンロードの操作を出さない。失敗は失敗の日時と案内を示す。1人の要求は24時間に3回までのため、全件を一度に返さずページに分ける。
  - 削除: `data-export.archive-erasure`をユーザーの`withdrawn`と`purge_due`の両方(2100)に登録し、退会の時点でZIP・途中のアップロード・記録を物理削除する。`purge_due`はその後の消し残しの受け皿である。処理の名前と`order`は変えない。
  - 変えた要件: 3.8・10.1〜10.5・11.1・11.8(IDは保った)。変えたタスク: 1.1・1.2・1.6・2・4.1・4.2・5.1・5.2・5.4・6.2・7.2。
  - 公開の契約の変更: GraphQLの`myDataExports`が配列から`DataExportConnection`(`first`・`after`)へ、`DataExportStatus`に`EXPIRED`が加わる。launch-readinessを含む他のspecはこの操作を使わないため、他specへの影響は無い。内部REST・中継の経路・メッセージ種別・ジョブの名前と`order`は変えない。
- 他のspecの回答の影響の確認:
  - user-profile-socialの仮3(B、外部Webサイトは10件まで): `ProfileExport.websites`は件数を問わない配列で、`profile.json`の`websites[]`も件数の上限を持たないため、本specの変更は無い。
  - content-reportingの仮7(B、対象の物理削除で案件と通報を残し参照だけを消す): `ReportExport`の形(`targetRef: string | null`)は変わらない。物理削除された対象への通報も利用者の通報として`reports.json`に残り、`targetRef`が`null`になる。本specの`null`の規則(仮3)とデータエクスポートの文書の改訂(content-reportingが行う「解決できない対象は`null`」)で扱え、`reports.json`の構造は変わらない。本specの変更は無い。
  - ugc-moderationの仮5(B、代理の退会の完了メールを送らない): 本specは代理の退会のメールを扱わない。代理の退会も`withdrawn`のイベントで本specの削除の処理が動くため、変更は無い。
- 設計のレビュー(変更した部分): 要件の98件の番号がすべて追跡表にあり、境界の4節とファイル構成が変更後も一致することを機械的に確かめた。期限切れの状態・`markExpired`・`listFailedWithUpload`・`clearUpload`・`listByUserPage`・`DataExportConnection`・`withdrawn`の登録は既存のコンポーネントの中に収まり、新しいコンポーネントは無い。
- タスクのレビュー: 新しいサブエージェントによる独立した確認の1回目でPASSだった。軽微の指摘6件(設計の残っていた`purge_due`だけの記述・`finished`の期限切れ・ブラウザテストの状態の数、ページングをapi-gatewayの`CURSOR_PAGE_ARGS`・`encodeCursor`・`decodeCursor`・`toConnection`に合わせ`first`の上限20を`validation_error`で検証し`listByUserPage`が最大`limit + 1`件を返す形にすること、退会の削除と生成の競合で`recordUpload`が更新されないときのアップロードの破棄、ダウンロードの期限切れの状態の404の確認、`useInfiniteQuery`の取得し直しの記述)に従って直した。要件・設計・タスクの承認を保つ。
- 横断レビュー3回目の指摘への対応(2026-10-24): 設計の`ExportSnapshot`で使いながら定義の無かった`ExportReport`を、content-reportingの`ReportExportRecord`と同じ項目(`targetType`は`REPORT_TARGET_KINDS`と同じ値を写す)で定義し、`targetRef`が解決できないか対象への参照が消されたとき(content-reportingの仮7)に`null`になる旨を`null`の規則に書いた。タスク3.3の単体テストに`targetRef: null`の通報が項目ごと残ることを加えた。新しいサブエージェントによる独立した確認(変更した部分)の1回目でPASSで、軽微の指摘(上流と同じ`null`の条件の文言・種類の値の同期の注記・要件5.7への対応付け)に従って直した。承認を保つ。

## 上流(api-gateway)の改訂3の反映(2026-10-27)

- api-gatewayの実装後の改訂3で、内部RESTに共通の後処理が加わった。サブアプリが要求ごとに`SessionAccess`を作って`c.var.session`で経路へ渡し、経路の後(共通エラー・想定外の例外の応答を含む)に`Cache-Control: no-store`とセッションの指示を付ける。経路が付けた`Cache-Control`は`no-store`で上書きされる(開発者の決定)。
- そのため、ダウンロードの応答のヘッダーを`Cache-Control: private, no-store`から`no-store`に改めた(requirements.mdの該当の受け入れ基準、design.mdの経路の表と応答のヘッダーの説明)。`no-store`だけでどのキャッシュにも保存されないため、守るべき性質は変わらない。経路の`authorize`は`createSessionAccess`を作り直さず`c.var.session`を使う形に改めた。R2のオブジェクトのメタデータの`private, no-store`は応答ではないため変えていない。タスクは変えていない。

## frontend-platformの確定した契約の反映(2026-10-28)

- **状態**: frontend-platformのタスク10.4として、frontend-platformが実装で確定した契約(frontend-platformのdesign.mdの「実装で確定した契約による発火と影響を受ける下流spec」の表と「決定事項」)に本specの設計とタスクを合わせた。2026-10-28に開発者が下流specの設計の改訂を決めた(frontend-platformの判断11)。受け入れ基準は変えていない。
- **中継の経路の形**: 中継の経路は`defineRelayRoute`で定義して凍結する契約になり、上流の5xxでJSONでない応答は503`upstream_unavailable`に置き換わる(frontend-platformの要件2.10の例外)。`DATA_EXPORT_DOWNLOAD_RELAY_ROUTE`を`defineRelayRoute`で定義し、clientの`RELAY_ROUTES`の完全一致の経路の後に置くこと、ZIPを返すダウンロードの経路も5xxは共通のエラー形式(JSON)で返すことを書いた。
- **GraphQLの操作の置き場所**: 操作は`src/graphql/operations/**/*.graphql`に1ファイル1操作で書き、操作名は`Client`で始め、画面は`src/graphql/generated/graphql.ts`の`<操作名>Document`だけを読む契約になった。`data-export.ts`を`ClientMyDataExports`・`ClientRequestDataExport`の`.graphql`に分けた。
- **変えた箇所**: design.mdのAllowed Dependencies・File Structure Plan・Modified Files(`relay-routes.ts`・生成物)・clientの節(中継の経路・5xx・操作の規約)、tasks.mdの5.3(503のJSON)・7.1(`defineRelayRoute`・`.graphql`・操作名・`composition.unit.test.ts`・`codegen.unit.test.ts`)。

## 実装済みの上流との食い違いの水平展開(2026-10-30、開発者の指示)

- **Sentryの定型の通知**: content-processingの差分の分析(G-4)で、backend-platformの改訂7と技術ドキュメント`infra/004`の「同じ文言を繰り返し送る通知」が、定型の文言で繰り返し起こり得る出来事を`captureMessage`ではなく`captureEvent`で送り、文言を`logentry`、まとめる単位を`fingerprint`に置くと定めていることを確かめた。`captureMessage`は既定の`dedupeIntegration`により、同じ文言の2件目以降が捨てられる。本specの`captureMessage`をすべて`captureEvent`に改め、規約の参照と通知のタグの記述に`logentry`と`fingerprint`の置き方を加えた。通知の種類・タグ・レベルは変えていない。
- 要件と受け入れ基準は変えていない。

## 層の規則に合わせた契約の置き場所の改訂(2026-11-02、開発者の指示)

- **規則**: [層構成の依存方向と静的解析](../../../docs/GUIDES/tech/backend/002-layered-architecture-on-workers.md#依存方向と静的解析)により、api・eventの`src/application/**`・`src/domain/**`は`**/lib/workers/**`を型も含めて読み込めない。application層が受け取る契約と識別子は`apps/backend-lib/core/<ドメイン>`に置き、`workers/<ドメイン>`には実装と束縛だけを置く。application層はデータベースの接続・SQLの文・一括の書き込みを扱わない。`workers`の部品(メッセージの送信・厳密カウンタ)は自前のポートで受け取り、厳密カウンタを使うクラスはinfrastructure層に置く。
- **移した契約**: `DataExportStore`・`DataExportRecord`・`ClaimResult`・`ExportArchiveStorage`・`MultipartArchiveUpload`・`StoredArchive`・`DataExportNotifier`・`DataExportTerminator`を`core/data-export/ports.ts`へ、`DATA_EXPORT_PLATFORM_TYPES`を`core/data-export/identifiers.ts`(`identifiers.unit.test.ts`で値と凍結を確かめる)へ移した。`workers/data-export`には実装`D1DataExportStore`・`R2ExportArchiveStorage`・`EmailDataExportNotifier`・`StoreDataExportTerminator`と`DATA_EXPORT_PLATFORM_MODULE`だけを置く。
- **R2の型の除去**: `StoredArchive.httpMetadata: R2HTTPMetadata`をcoreの`StoredArchiveMeta`(`contentType`・`contentDisposition`・`cacheControl`)に置き換えた(media-pipelineの`core/media/ports.ts`の`StoredObjectMeta`と同じ考え方)。ダウンロードの経路は`writeHttpMetadata`を使わず、写しから`Content-Type`・`Content-Disposition`・`Cache-Control`を付ける。
- **新しいポートと実装**: apiのapplication層に`DataExportMessagePublisher`(`@inject(PLATFORM_TYPES.MessagePublisher)`で受け取る、media-pipelineの`MediaJobMessagePublisher`と同じ形)と`DataExportRequestLimits`を置き、infrastructure層に厳密カウンタを使う`CounterDataExportRequestLimits`と`DATA_EXPORT_REQUEST_RULE`を置いた(identity-authの`CounterMailSendLimits`と同じ形)。
- **上流の出力用の部品**: 19の部品の契約と識別子は所有する各specの`core/<ドメイン>`から読み込む(engagementの`RatingExportRecord`は`core/engagement`、inquiry-chatの`InquiryExport`は`core/inquiry`。束縛はinquiry-chatだけeventの`inquiry-module.ts`)。各specの移動は並行して行われる。
- **変えた箇所**: design.mdのOverviewのImpact、This Spec Owns、Allowed Dependencies、Revalidation Triggers、上流への影響(engagement)、Existing Architecture Analysis、Architecture Integration、Dependency direction、File Structure Planの木、要求の受け付けの流れ、Requirements Traceability(2.1)、Componentsの表、`backend-lib/core・workers`の節(識別子・実装の宣言・`StoredArchiveMeta`)、apiの回数制限と送信のポート・ジョブの依存・ダウンロードの経路、eventの依存、Testing Strategy。tasks.mdの4.1・4.3・5.1・5.4・6.1。
- 要件と受け入れ基準は変えていない。タスクの番号は変えていない。

---

## 実装前のギャップ分析(2026-11-22)

`/kiro-validate-gap data-export`で、承認済みの設計(2026-11-02の改訂まで)を、その後に実装された上流の実コードと突き合わせた。設計の時点で実装済みだったのはdev-toolingだけだったが、現在は上流のspecがすべて実装済みである(content-reporting 52/52・inquiry-chat 54/54・engagement 48/48、public-apiは末端のタスクがすべて完了、paymentsはsandboxでの手動の検証1.4・11.2だけが残る)。本specのタスクは0/40で、`apps`に本specのコードは無い。ステアリングは`roadmap.md`だけで、`product.md`・`tech.md`・`structure.md`は無い。代わりにCLAUDE.mdと技術ドキュメントを参照した。

### 分析の要約

- 上流の19の出力用の部品と`MediaFiles`は、識別子の名前と置き場所が設計どおりで、apiとeventの両方に束縛されている(`InquiryExport`だけはeventの`inquiry-module.ts:26`)。engagementの`RatingExportRecord.invalidatedByAdmin`は提供済み(`core/engagement/ports.ts:183`)で、仮2の前提が満たされた。データエクスポートの文書にあって部品から得られない項目は無い。
- 設計の記述と実コードの食い違いのうち、実装の前に設計を直さないと詰まるものが7件ある。AccountGuardの識別子、回数超過のエラーコード、application層からのSentryへの送信、上流の登録の一覧を固定するテスト、メールの依頼の冪等キー、`apps/event/test/`の型検査、定期再取得の規約である。
- 開発者の判断が要る論点は4件ある。`purge_due`での本specの順と、ugc-moderationの「全ドメインの後」の不変条件の関係。定期再取得の規約(30秒・自動更新の切り替え)と設計の10秒の関係。E2Eの置き場所。未完了のマルチパートアップロードの寿命の規則。
- 工数はL(1〜2週間)、リスクはMedium。既存の型(content-reportingの通知と送り直し、media-pipelineの配信の中継)に沿えるが、fflateは未導入で、R2のマルチパートの前例が無い。CPU時間と中継の時間切れは実測していない。

### 要件と既存の資産の対応

| 要件                    | 既存の資産                                                                                                                                                                                      | 状態                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1(要求)                 | `IDENTITY_PLATFORM_TYPES.AccountGuard.requireUser`(停止中を通し、未ログインと退会済みは`unauthenticated`)、`viewer.emailVerified`、`SETTINGS_NAV_ITEMS`(10〜90、コメントで100を予約済み)        | Constraint: 識別子の名前の違い(G-1)                                                        |
| 2(回数制限)             | `RateLimitCounterClient.hit`・`assertWithinLimit`・`hashRateLimitKey`・`CounterRule`、前例`counter-public-api-rate-limits.ts:34-38`                                                             | Constraint: エラーコードと秒数の求め方(G-2)                                                |
| 3(非同期の生成)         | `MESSAGE_CONTRACTS`・`MessageHandler`・`done`/`defer`・再試行の方針(6以下)・`delaySeconds`(0〜43200)、eventの既定のCPU時間30秒・`max_batch_size` 10                                             | Missing: 本specの処理の一式。Constraint: `defer`で試行の回数が1に戻る(G-8)                 |
| 4・5(ZIPの構造と内容)   | 19の部品・`MediaFiles.findMany`・`openContent`・`attachmentDisposition`、データエクスポートの文書                                                                                               | Missing: fflate(未導入)・`ZipArchiveWriter`・文書の組み立て。Constraint: 部品の形の差(G-9) |
| 6(各機能のデータの取得) | 上記の部品(全件が`core/<ドメイン>`)                                                                                                                                                             | 部品の不足は無い                                                                           |
| 7(保存)                 | api・eventの全環境の`FILES_BUCKET`。マルチパートの前例は無い。メディアのキーは接頭辞の無い32桁の16進のため、`data-exports/`と衝突しない                                                         | Missing: `R2ExportArchiveStorage`。Unknown: 未完了のアップロードの寿命(D-4)                |
| 8(通知)                 | `UserContactDirectory.findContact`(停止中も返し、ニックネームを含む)、`EmailSender.send`(`idempotencyKey`を任意で受け取る)、`transactional`の種別では配信停止のリンクが付かない                 | Constraint: 冪等キーと送り直しの経過時間(G-5)                                              |
| 9(ダウンロード)         | `defineRelayRoute`・`RELAY_ROUTES`・`FILE_DOWNLOAD_RELAY_ROUTE`(120秒)、内部RESTの共通の後処理(`Cache-Control: no-store`で上書き)                                                               | Constraint: `timeoutMs`の効き方(G-10)。内部RESTの置き場所の慣例(G-11)                      |
| 10(削除と保持)          | ユーザーライフサイクルの`withdrawn`・`purge_due`(2100は空き)、4:21のジョブ(既存の`order`は100〜2010と2300で、2100・2110は空き。予算300秒を共有)                                                 | Constraint: 上流のテストの固定(G-4)、ugc-moderationの順の不変条件(D-1)                     |
| 11(設定ページ)          | `EmptyState`・`PartialErrorState`・`LoadingSkeleton`・`DateTime`・`notify`・`executeGraphQL`・`requireData`、「さらに表示」の前例`api-key-settings-page.tsx:105`・`payment-history-list.tsx:82` | Constraint: 定期再取得の規約(G-7・D-2)。clientの取得の補助のファイル(G-12)                 |
| 12(運用と連携)          | `captureEvent`の定型の通知(`logentry`・`fingerprint`)、application層向けのポートの前例`ReportIncidentReporter`                                                                                  | Missing: 本specのインシデントを報告するポート(G-3)                                         |
| 13(文書とテスト)        | `e2e/support/mailpit.ts`、テストの命名の規約。技術ドキュメントの番号`backend/023`・`security/012`は空いている                                                                                   | Constraint: `apps/event/test/`の型検査(G-6)、E2Eの置き場所(D-3)                            |

### 設計の記述と実コードの食い違い

実装の前に直す必要があるもの:

| #   | 設計の記述(design.md)                                                                | 実際                                                                                                                                                                                                                                                                                                                                                                                                                              | 影響するタスク |
| --- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| G-1 | `IDENTITY_TYPES.AccountGuard`(51行)                                                  | `IDENTITY_PLATFORM_TYPES.AccountGuard`(`core/identity/identifiers.ts:11`、束縛はapiの`identity-module.ts:265`)。`requireVerifiedUser`は停止中を拒むため使えず、`requireUser`と`emailVerifiedAt`で判定する設計の手順は正しい                                                                                                                                                                                                       | 5.1・5.3       |
| G-2 | 超過は`AppError(rate_limited)`(996・1010・1057・1134・1156行)                        | `rate_limited`は種類(kind)で、エラーコードは`rate_limit_exceeded`(`workers/rate-limit/rate-limit-counter-client.ts:18,48`)。clientの既存の対応付けもコードを見る(`inquiry-submit-error.ts:13`)。`hit`は再試行の秒数を返さず、`assertWithinLimit(decision, clock.now().getTime())`が求める                                                                                                                                         | 5.1・5.2・7.3  |
| G-3 | ジョブと処理(application層)が「Sentryに送る」(1016・1017・1142行)                    | application層は`@sentry/*`を読み込めない(`config/eslint/backend-layers.ts:21-25,75`)。content-reportingの`ReportIncidentReporter`(`api/src/application/reporting/ports.ts`)と、infrastructure層の`sentry-report-incident-reporter.ts`と同じ形のポートが要る。eventの3回目の失敗・見張りも同じ                                                                                                                                     | 5.4・6.5・6.6  |
| G-4 | 上流への影響は「契約どおり」(Modified Filesに上流のテストが無い)                     | 登録の一覧と前後関係を固定する上流のテストが、追加で失敗する: `client/src/components/settings/settings-nav-order.unit.test.ts:38-58`、`event/src/composition/user-lifecycle-async-handlers.unit.test.ts:107-139`、`api/src/composition/reporting-module.worker.test.ts:164-180`(2010の次が2300)、`api/src/composition/search-module.worker.test.ts`(4:21の全件の並び)。ugc-moderationは同じ種類の期待値の更新を設計に記録している | 5.4・6.2・7.1  |
| G-5 | `DataExportNotifier.notify`に冪等キーが無い。依頼待ちの送り直しは30分の経過後(415行) | 既存の2つの型(`report-notifier.ts:120,270`・`moderation-notifier.ts:120`)は`EmailSender.send`に`idempotencyKey`を渡す。無い場合、送信の成功の後に通知の状態の更新が失敗すると、日次の送り直しで同じメールが2通届き、要件8.3・8.6に反する。既存の送り直しは1時間の経過後                                                                                                                                                           | 4.4・5.4       |
| G-6 | 契約と結合のテストを`apps/event/test/data-export/`に置く(Modified Files)             | `apps/event/test/`は空で、`apps/event/tsconfig.json`の`include`に`test/**`が無いため、型検査の対象から外れる。既存の同じ種類のテストは`apps/event/src/composition/*.worker.test.ts`(例: `identity-module.worker.test.ts`)にある                                                                                                                                                                                                   | 2・8.1         |
| G-7 | 作成中の間だけ一覧を10秒の間隔で取り直す(1111行)                                     | 規約`frontend/010-live-refresh-queries.md`は`LIVE_REFRESH_QUERY_OPTIONS`(30秒、`utilities/query/live-refresh.ts`)を重ね、止める手段として「自動更新」の`Switch`を置くことを求める。サーバーの処理の完了を待つ場面は「使う場面」の表に無い(D-2)                                                                                                                                                                                    | 7.2            |

実装の中で吸収できるもの:

| #    | 設計の記述                                                                         | 実際                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G-8  | 重複の配送は`defer`(1200秒)で待たせ、例外は`meta.attempts < 3`ならやり直す(1095行) | `defer`は封筒を新しいメッセージとして送り直すため、試行の回数が1に戻る(`workers/messaging/queue-consumer.ts:155-170,207`)。リースの期限が切れた後の再取得でも回数は数え直しになる。2時間の見張りが上限を担保するため結果は変わらないが、テストの期待値に反映する。3回目で`fail()`自体が例外になるとデッドレターへ移る                                                                                                                                                                                                                                                                                                                                               |
| G-9  | inquiry-chatの文字列の日時を`Date`へ写す(design.mdの`CorrespondenceSourceReader`)  | `PaymentHistoryExportItem.occurredAt`も文字列(`core/payments/ports.ts:506`)。`purpose`は文書に無い`payments_smoke`を値に含む。ほかにも、`MatchExportRecord`の`matchId`と`launchId`、`FollowExport`の平たい形、`LaunchExportRecord.launchDate`(`BusinessDate`)、`SponsorshipExport`の`startsOn`・`endsOn`(文字列)とプロダクトが見つからないときの`Error`、`InquiryExport`の物理削除済みの添付の除外(警告のログ)、`ReportExport`は`limit`を検査しない、`ProductDirectory.findSummaries`は内部で90件ずつ分ける、`MediaFiles.openContent`は`{ file, body }`を返し`quarantined`は「理由が1つ以上ある」の意味、という形の差がある。どれも読み取りの部品の写しの中に収まる |
| G-10 | ダウンロードの中継の`timeoutMs`は900000(15分)                                      | `AbortSignal.timeout`は上流への要求に付き、本文の転送中も効くと見られる(`frontend-lib/server/relay/relay-route.ts:287-313`、テストは無い)。超えると503ではなく途中で切れたファイルになる。本文はそのまま中継されるため、ストリーミング自体はできる                                                                                                                                                                                                                                                                                                                                                                                                                  |
| G-11 | 内部RESTを`presentation/internal/data-export/`に置く                               | 既存の慣例は`presentation/media/file-content-route.ts`の形で、経路は`/internal`の下に相対のパスで書く(`presentation/gateway/internal-only.ts:91-107`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| G-12 | clientのファイル構成に取得の補助が無い                                             | 既存の設定ページは、loaderと取得の設定を`src/graphql/<機能>.ts`に置く(例: `graphql/public-api.ts:81-121`)。`graphql/data-export.ts`を加える。メールアドレスの未確認の案内には`product-email-verification-notice.tsx`・`verify-email-banner.tsx`がある                                                                                                                                                                                                                                                                                                                                                                                                               |
| G-13 | `CURSOR_PAGE_ARGS`で`first`の上限20を`validation_error`で検証する                  | `CURSOR_PAGE_ARGS`は上限100で既定値が無い(`presentation/graphql/pagination.ts:8-19`)。上限20は前例`modules/product/inputs.ts:36-50`と同じ形で自前に組む                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| G-14 | 許可リストを`graphql:allowlist`で再生成した後にclientの型を生成する                | 許可リストはclientの生成物`persisted-documents.json`から作る(`api/scripts/graphql/allowlist-sources.ts:17-18`)。順序はapiの`graphql:generate`→clientの`graphql:generate`→apiの`graphql:allowlist`                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| G-15 | `BusinessTime`を読み込む                                                           | `BusinessTime`という名前のexportは無く、`core/time/business-time.ts`のモジュールの関数を使う                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| G-16 | R2のオブジェクトのメタデータに`Cache-Control: private, no-store`                   | 応答ではapiとclientの共通処理が`no-store`で上書きする(`presentation/gateway/session-access.ts:175-187`、`frontend-lib/server/http/security-headers.ts:23`)。保存の値は要件7.2のとおり残す                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| G-17 | `apps/db/schema/index.ts`へ1テーブルを再エクスポートする                           | `apps/db/schema/index.unit.test.ts`のテーブル名の一覧にも`data_exports`を加える。マイグレーションは`YYYYMMDDHHMMSS_<snake>/`に`migration.sql`と`snapshot.json`を置く                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| G-18 | fflate 0.8.3はtech-stack.mdに記載済み                                              | どの`package.json`にも無い。`docs/onboardings/tech-stack.md:78-80`は名前だけで、版と使うアプリが書かれていない。タスク8.3の追記で版と用途を加える                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

### 開発者の判断が要る論点

| #   | 論点                                   | 根拠                                                                                                                                                                                                                                  | 選択肢                                                                                                                                                                                                                                                                                                    |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-1 | `purge_due`での本specの処理の順        | ugc-moderationのテスト(`user-lifecycle-async-handlers.unit.test.ts:107-122`)は、`purge_due`の最後がugc-moderationの1900であることを「全てのドメインの物理削除の処理の後に並ぶ」不変条件として固定している。本specの2100はその後に動く | (A)本specの`purge_due`を2100のまま登録し、ugc-moderationのテストを「identity-authの10000番台より前」の条件へ緩める / (B)本specの`purge_due`だけを1900より前の値にする(帯の外の値になり、roadmapの帯の割り当ての変更が要る) / (C)本specは`withdrawn`だけに登録する(物理削除の時期の消し残しの受け皿を失う) |
| D-2 | 作成中の要求の一覧の定期再取得         | 規約`frontend/010`の共通の値(30秒)と「自動更新」の`Switch`、設計の10秒と「作成中の間だけ」                                                                                                                                            | (A)規約に従い`LIVE_REFRESH_QUERY_OPTIONS`と`Switch`を使い、作成中の要求があるときだけ有効にする / (B)サーバーの処理の完了を待つ場面を規約の「使う場面」に加え、`Switch`を置かずに作成中の間だけ取り直す例外として扱う(規約の改訂が要る)                                                                   |
| D-3 | E2Eテストの置き場所                    | CLAUDE.mdは「原則として機能ごとのサブディレクトリ」としているが、実際の`e2e/client`は平置きが大半で、サブディレクトリは`auth/`・`inquiry/`だけ。`testing/001`は両方を認める                                                           | (A)`e2e/client/data-export/`に`data-export.e2e.test.ts`と`data-export-steps.ts`を置く(原則どおり) / (B)設計どおり`e2e/client/data-export.e2e.test.ts`に平置きし、手順は`data-export-steps.ts`に分ける                                                                                                     |
| D-4 | 未完了のマルチパートアップロードの寿命 | 設計はR2の既定の「7日で破棄」を頼りにしているが、`apps/infra/modules/storage`に寿命の規則が無く、既定の規則が実際に効いているか確かめていない                                                                                         | (A)本specの明示の`abort`と日次の破棄だけで足りるとし、IaCは変えない / (B)infra-deliveryの変更として`FILES_BUCKET`に未完了のマルチパートを破棄する規則をOpenTofuで加える                                                                                                                                   |

### 実装の方針の選択肢

設計とタスクは承認済みのため、選択肢は上の食い違いをどこで解消するかである。

- **Option A: 設計を変えず、各タスクの実装の中で吸収する**
  - ✅ 承認済みの文書を触らずにすぐ着手できる。
  - ❌ G-3・G-5・G-6は新しいポート・冪等キーの決め方・テストの置き場所を伴い、タスクの`_Boundary:_`やファイル構成と食い違ったまま進む。CLAUDE.mdの「文書とコードの相違は最後の返答で挙げる」の件数が多くなり、レビューで誤りとして扱われやすい。
- **Option B: 実装の前にdesign.mdとtasks.mdを全面的に改訂する(`/kiro-spec-design data-export`の再実行)**
  - ✅ G-1〜G-18をすべて文書に反映でき、実装は文書どおりに進められる。
  - ❌ G-8〜G-18は写しや慣例の差で、文書の改訂の手間に見合わない。承認とタスクの独立した確認をやり直す負担が大きい。
- **Option C: ハイブリッド(推奨)**
  - G-1〜G-7とD-1〜D-4の決定を、design.mdとtasks.mdへ局所の改訂として反映する。これまでの改訂(2026-10-27・10-28・11-02)と同じく、要件と受け入れ基準とタスクの番号は変えない。追加するのは、インシデントを報告するポートと実装、`idempotencyKey`(要求のIDと結果の種類から作る)と送り直しの経過時間、上流のテストの期待値の更新をModified Filesへ、契約のテストの置き場所の変更、定期再取得の規約への合わせ方である。
  - G-8〜G-18は実装の中で吸収し、各タスクの完了の報告で相違として挙げる。
  - ✅ 契約と境界に関わる差だけを文書に固定し、承認のやり直しを最小にできる。
  - ❌ 局所の改訂の後に、変更した部分のタスクの独立した確認が要る。

### 工数とリスク

- **工数: L(1〜2週間)**。40のサブタスクで、api・event・client・backend-lib・db・文書にまたがる。上流の部品はすべてそろっているため、新しい部品は本specの中に閉じる。
- **リスク: Medium**。依頼待ちの通知・回数制限・中継・ライフサイクルの登録は既存の型に沿える。一方で次の3点は前例が無いか実測していない: fflateの同期のストリーミングとUTF-8の印、R2のマルチパートを使う最初のコード、eventのCPU時間30秒(バッチ10件で共有)と中継の時間切れ(G-10)。

### 設計フェーズへの申し送り

- 推奨の進め方はOption C。D-1〜D-4を開発者に1件ずつ確かめ、G-1〜G-7とともにdesign.mdとtasks.mdへ局所の改訂として反映してから`/kiro-impl`を始める。
- Research Needed:
  - fflate 0.8.3の同期の`Zip`で、非ASCIIのファイル名にUTF-8の印(ビット11)が立つこと。タスク1.4・3.5の単体テストで最初に確かめ、立たなければ止めて報告する(既存のRisksのとおり)。
  - workerdでのR2のマルチパートの`uploadPart`の大きさ(10MiB)と、`ReadableStream`の読み出しを重ねたときのメモリ。Workers統合テスト(miniflare)の結果が本番のR2と同じになるか。
  - 中継の`timeoutMs`が本文の転送中に効くか(G-10)。効く場合、遅い回線で大きいZIPが途中で切れたときの利用者への見え方と、15分で足りるか。
  - eventのCPU時間。同じバッチの他の処理と30秒を分け合うため、stagingで画像と添付の多い利用者を作って実測する(既存のRisksのとおり)。
- 上流のspecへの影響: G-4のテストの期待値の更新は、本specの登録に伴う追随として本specのタスクで行う(ugc-moderationの前例と同じ扱い)。D-1で(A)を選ぶ場合は、ugc-moderationの不変条件の文言(テスト名と同specの設計)の改訂を伴う。

## ギャップ分析の論点の決定(2026-11-22)

ギャップ分析のD-1〜D-4を開発者に1件ずつ確かめ、次のとおり決まった。D-2・D-4は推奨どおり、D-1・D-3は推奨と異なる案である。要件と受け入れ基準、タスクの番号は変えていない。

| #   | 論点                                   | 決定した案                                                                                                                                                               | 他の選択肢                                                                              |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| D-1 | `purge_due`での本specの処理の順        | 帯の値の2100のまま登録し、ugc-moderationの1900を全ドメインの物理削除の処理の末尾とする並びを「identity-auth専用の10000番台より前」に緩める(推奨と異なる)                 | 推奨: content-reportingの1800と同じく帯の外の1850にする / `withdrawn`だけに登録する     |
| D-2 | 作成中の要求の一覧の定期再取得         | 規約`frontend/010`のとおり`LIVE_REFRESH_QUERY_OPTIONS`の間隔と「自動更新」の`Switch`を使い、取得した値による判定で作成中の要求がある間だけ取り直す                       | 回数を限った取り直し(規約の改訂が要る) / 設計どおり10秒で`Switch`を置かない(規約の例外) |
| D-3 | E2Eテストの置き場所                    | `e2e/client/data-export.e2e.test.ts`に平置きし、画面の操作の手順を`e2e/client/data-export-steps.ts`に置く(推奨と異なる)                                                  | 推奨: `e2e/client/data-export/`のサブディレクトリに置く                                 |
| D-4 | 未完了のマルチパートアップロードの寿命 | IaCは変えず、R2のバケットの既定の寿命の規則(開始から7日で破棄)と本specの明示の`abort`に任せる。既定の規則はCloudflareの文書で確かめた(Object lifecycles・Upload objects) | `FILES_BUCKET`の`data-exports/`に未完了のマルチパートを破棄する規則をOpenTofuで加える   |

- **D-1の根拠と反映**:
  - 本specの`data-export.archive-erasure`は本specの記録だけを消し、措置の記録と順序の依存を持たない。
  - `users`の行はidentity-authの実行器が全ての処理の後に消すため、`data_exports.user_id`の外部キーの順序も保たれる。content-reportingの分析(同specのresearch.mdのG-3)も、「全ドメインの後」は帯を割り当てた時点の並びをテストに固定したものと推測している。
  - design.mdの「上流への影響」のidentity-authの行と、roadmapの段落の文を改めた。Modified Filesには、一覧と前後関係を固定する上流のテスト4ファイルの期待値の更新と、content-reportingの`design.md`・`tasks.md`の1800の説明の改訂を加えた。tasks.mdの5.4・6.2・7.1には、それぞれの期待値の更新を加えた。
  - roadmapの帯の割り当ての段落(`.kiro/steering/roadmap.md`)へ、本specの2100がugc-moderationの1900の後に動く旨を、開発者の指示により本specの作業で直接加えた。
  - content-reportingの文書とテスト名は実装済みのコードを説明しているため、本specのコードの登録と同じタスク(6.2)で改める。
- **D-2の反映**: design.mdの`DataExportList`・追跡表の11.3・ブラウザテストと、tasks.mdの7.2に反映した。`Switch`は区画の見出しの近くに置き、状態は`DataExportList`が持つ。定期の取り直しがある間(作成中が1件以上)だけ描き、ページを開くたびにオンから始める。間隔の説明は`LIVE_REFRESH_INTERVAL_MS`から作る。
- **D-3の反映**: design.mdのファイル構成とE2Eテストの節と、tasks.mdの8.2に反映した。
- **D-4の反映**: design.mdの`claim`の手順の根拠を既定の寿命の規則に改め、Revalidation Triggersに「IaCで`FILES_BUCKET`に寿命の規則を加えると既定の規則が置き換わるため、未完了のマルチパートアップロードの破棄を含める」を加えた。
- ギャップ分析のG-1〜G-3・G-5〜G-7と吸収できる差(G-8〜G-18)は、この決定の反映の範囲に含めていない。G-4は、D-1と同じ上流のテストの期待値の更新として反映した。

## ギャップ分析の食い違いの反映(2026-11-22、開発者の指示)

ギャップ分析のG-1〜G-3・G-5〜G-7を、開発者の指示によりdesign.mdとtasks.mdへ反映した。G-4はD-1の反映に含め、G-7はD-2の決定で反映済みである。要件と受け入れ基準、タスクの番号と依存は変えていない。公開の契約(GraphQLの操作と形、内部RESTのパス、中継の経路、メッセージ種別、ジョブと処理の名前と`order`)も変えていない。

| #   | 反映した内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 変えた箇所                                                                                                                                                                                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G-1 | AccountGuardの識別子を`IDENTITY_PLATFORM_TYPES.AccountGuard`に直した                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | design.mdのAllowed Dependencies                                                                                                                                                                                                           |
| G-2 | 回数超過は種類`rate_limited`・コード`rate_limit_exceeded`の`AppError`とした。GraphQLのエラーコードとclientの対応付けはコードで行う。再試行の秒数は`assertWithinLimit(decision, clock.now().getTime())`が求める                                                                                                                                                                                                                                                                                                                                                                                                               | design.mdの`DataExportRequestLimits`・`consume`・スキーマモジュールのエラーコード・`DataExportErrors`・Error Strategy・単体テスト、tasks.mdの5.1・5.2                                                                                     |
| G-3 | 契約`DataExportIncidentReporter`(`DataExportIncident`の5種類)を`core/data-export/ports.ts`に、識別子を`DATA_EXPORT_PLATFORM_TYPES`(5つ目)に、Sentryの実装`SentryDataExportIncidentReporter`を`workers/data-export`に置き、共通のモジュールで両アプリへ束縛する(notificationsの`NotificationIncidentReporter`と同じ形。モジュールは独立した確認の後に関数`createDataExportPlatformModule(appName)`に改めた)。ジョブ・eventの処理・ダウンロードの経路は、この部品を通してエラートラッキングへ送る。生成の3回目の失敗は、元の例外が`AppError`以外なら`captureException`、`AppError`なら除去処理で捨てられるため定型の通知で送る | design.mdの境界・Impact・依存の方向・ファイル構成・追跡表・コンポーネントの表・coreの節(新しい小節)・ジョブ・ダウンロードの経路・eventの処理・Monitoring・単体テスト・Modified Files(`infra/004`)、tasks.mdの4.1・4.5・5.3・5.4・6.6・8.3 |
| G-5 | 完了・失敗のメールの依頼に、冪等のキー`idempotencyKey`として要求のIDを付ける。送信の記録は14日保持されるため、日次の送り直しでも2通目は送られない。依頼待ちの送り直しは、確定から30分ではなく1時間の経過後とした(content-reportingの送り直しの前例と同じで、確定の直後の通知の依頼と重ならないようにするため)                                                                                                                                                                                                                                                                                                                | design.mdの`DataExportNotifier`・`generation-recovery`、tasks.mdの4.4・5.4                                                                                                                                                                |
| G-6 | 契約のテストを`apps/event/src/composition/data-export-upstream-exports.worker.test.ts`に、ZIPの結合のテストを`apps/event/src/composition/data-export-archive.worker.test.ts`に移した。`apps/event/tsconfig.json`の`include`に`test/**`が無いためである                                                                                                                                                                                                                                                                                                                                                                       | design.mdのAllowed Dependencies・依存の方向・Modified Files・読み取りの部品、tasks.mdの2・8.1                                                                                                                                             |

- 送り直しの経過時間(30分→1時間)は、ギャップ分析のG-5で前例との差として挙げた値を、前例に合わせて決めた。要件8.6は経過時間を定めていない。
- 吸収できる差(G-8〜G-18)は設計に反映せず、実装の中で扱う。
- 反映した部分を、新しいサブエージェントによる独立した確認(コードとの一致・層の規則・上流のテスト・文書の中の整合・文章の規則)に通した。1回目の判定は必須2件・軽微8件で、次のとおり直した。
  - 必須1: 本specの登録で失敗する上流のテストに漏れがあった。`purge_due`・`withdrawn`の全件を固定する`apps/event/src/composition`のWorkers統合テスト10か所、退会の実行済みの処理を全件照合する2つ、content-reportingのテストの末尾2件である。design.mdのModified Filesとtasks.mdの6.2に加え、実装の直前に洗い出し直す手順を書いた。
  - 必須2: 共通のモジュールを定数`DATA_EXPORT_PLATFORM_MODULE`から関数`createDataExportPlatformModule(appName)`に改めた(notificationsの`createNotificationsPlatformModule`と同じ形)。`infra/004`は、複数のアプリが使う共通ライブラリの部品にアプリ名を引数で受け取ることを求め、アプリ名で始まらないカテゴリのログは捨てられるためである。ログを出す実装(`EmailDataExportNotifier`・`StoreDataExportTerminator`・`SentryDataExportIncidentReporter`)は、`toDynamicValue`でアプリ名を受け取る。ログのカテゴリを`[<アプリ名>, <層>, 'data-export']`に直した。
  - 軽微: G-6の理由の文を直した。`apps/event/tsconfig.typecheck.worker.json`は`**/*.worker.test.ts`を含むため、`test/`でも型検査の対象になる。置き場所は既存のテストに合わせる結論のまま変えない。ほかに、Sentryの部品のテストの種別(Workers統合テスト)、5つ目の部品の追記(構成図・パターンの説明・`ports.ts`の注記・コンポーネントの表)、workersの依存の`captureEvent`の食い違い、許可する依存への`LIVE_REFRESH_QUERY_OPTIONS`・`LIVE_REFRESH_INTERVAL_MS`・`Switch`の追加、`assertWithinLimit`が`RateLimitCounterClient`のメソッドである旨、実態と合わなくなるテスト名の改め、tasks.mdの5.4・6.2・7.1の`_Boundary:_`と4.5の見出し、古い「実装済みはdev-toolingだけ」の記述を直した。
  - 直さなかった指摘: 規約`frontend/010`の「使う場面」の表に、サーバーの非同期の処理の完了を待つ場面の行が無い。D-2で開発者が「規約の改訂は不要」の案を選んだため、この時点では規約を変えなかった。後に開発者の判断で規約へ行を加えた(「[規約frontend/010の使う場面の改訂](#規約frontend010の使う場面の改訂2026-11-22開発者が決定)」)。
- 直した部分を、新しいサブエージェントによる2回目の独立した確認に通した。判定は必須1件・軽微5件で、次のとおり直した。共通のモジュールの形は手本どおりで問題なしだった。
  - 必須: 4:21を実行した「定期実行を終えました」の要約の`jobs`を全件で固定する`apps/api/src/composition/search-module.reextraction.worker.test.ts`が漏れていた。`jobsFor(`を使わないため、洗い出しの手がかりにも要約の`jobs`を加えた。
  - 軽微: `search-module.worker.test.ts`は2か所の固定を直す旨の明記、`toDynamicValue`で組み立てる実装の引数の注記を`@inject`から`context.get`に変更、research.mdのG-3の行の古い定数名、`project-values.md`へログのカテゴリ・レベル・属性と定型の通知の種類を載せる指示、Notifier・Terminatorのカテゴリの層(`'infrastructure'`)。
  - `kiro-spec-tasks`の規則(独立した確認は2回まで)に従い、3回目の確認は行わない。2回目の指摘はすべて反映済みである。

## 規約frontend/010の使う場面の改訂(2026-11-22、開発者が決定)

ギャップ分析の反映で直さなかった指摘(規約`frontend/010`の「使う場面」の表に、サーバーの非同期の処理の完了を待つ場面の行が無い)について、開発者が規約に行を加える案を選んだ(推奨どおり。他の選択肢は、規約を変えずdesign.mdに表の1行目の「相手」をサーバーの処理とみなす解釈を書く案)。

- `docs/GUIDES/tech/frontend/010-live-refresh-queries.md`の冒頭と「使う場面」の導入の文の、定期再取得で最新に保つデータに「サーバーの非同期の処理で変わる」ものを加えた。
- 「使う場面」の表に「閲覧者の依頼で始まり、サーバーの非同期の処理の完了で状態が変わる項目(処理中から完了・失敗へ)」の行を加えた。方法はD-2の決定と同じで、処理中の項目がある間だけの定期再取得(取得した値による判定)と、定期の取り直しがある間だけ描く「自動更新」の`Switch`である。
- 規約は`docs/GUIDES/tech`の配下のため、本プロジェクトの名前と機能に触れない汎用の文にした。
- design.mdの`DataExportList`の説明に、この行に従う旨を加えた。tasks.mdは7.2が既にD-2の内容を持つため変えていない。
