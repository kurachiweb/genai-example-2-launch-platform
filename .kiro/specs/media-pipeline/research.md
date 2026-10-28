# Research & Design Decisions

## Summary

- **Feature**: `media-pipeline`
- **Discovery Scope**: New Feature(ファイル処理の実装は無い。上流のbackend-platform・api-gateway・frontend-platformは設計まで承認済み・実装前である。画像の名前付きバリアント・URL・パージ規則は[画像バリアント仕様](../../../docs/GUIDES/service/features/002-image-variants.md)で決定済み)
- **Key Findings**:
  - Images Bindingの`.output()`が受け付けるのは`format`・`quality`・`anim`だけで、メタデータの扱いを指定できない。Cloudflareの文書では、メタデータの指定はJPEG出力にだけ効き(既定は著作権情報以外を捨てる`copyright`)、WebP・PNG・AVIF出力は常に全メタデータを捨てる。開発者決定Q1により、配信時のJPEGのメタデータ除去は要件から外した。
  - Workers Cacheはエントリポイントごとに有効・無効を切り替えられ(`exports.<名前>.cache`、Wrangler 4.107.0以上)、キャッシュキーはエントリポイント・パス・クエリ・`ctx.props`・Workerの版で決まり、ホスト名を含まない。パージは呼び出したエントリポイントのキャッシュにしか効かない。そのため、既定のエクスポートを関門(キャッシュ無効)とし、画像配信を名前付きエントリポイント(キャッシュ有効)に置いて`ctx.exports`で呼ぶ構成にした。パージも同じエントリポイントのRPCメソッドで行う。
  - R2はWorkersの`put()`で`If-None-Match: *`などの条件付きヘッダーを受け付け、条件が満たされなければ`null`を返す。条件は書き込みと同時に評価され、同じキーへの同時の書き込みでも1つだけが成功する。上書きの拒否(NFR-SECUR-041)をこれで満たせる。
  - R2の`us`管轄のバケットをWorkersから使うには、バインディングに`jurisdiction: "us"`が要る。管轄はバケットの作成後に変えられない。
  - `ctx.exports`は互換性日付2025-11-17から既定で有効で、本プロジェクトの互換性日付2026-08-04では追加のフラグが要らない。
  - wasm-image-optimization 2.0.11は`/workerd`の入口と`optimizeImage()`を持ち、`format: 'raw'`で32ビットRGBAの画素を返す。処理は1回の呼び出しの中で同期的に進むため、同じisolateで並行に呼ばれても復号の作業領域は重ならない。

## 要件フェーズ前の確認事項(2026-10-18)

開発者の判断を要する論点を、要件の作成前に一括で確認した。決定は`requirements.md`の「要件フェーズでの決定事項」にも記録する。

| #   | 論点                                                       | 根拠                                                                                                                         | 回答(2026-10-18)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Images BindingでJPEG出力のメタデータ除去を指定できない問題 | roadmapの実現性チェック・briefのConstraints・FR-FILEU-017・DR-009・画像バリアント仕様の出力フォーマット表                    | 開発者の回答。「JPEGのメタデータ除去はしないよう仕様変更」(提示した3案のいずれでもない)。JPEG出力は残し、配信時のJPEGのメタデータ除去を要件から外して変換基盤の既定の動作に任せる。Q2でブラウザが画像を作り直すため、通常の経路ではアップロード時点でExifが消える。ブラウザを通さず直接送られたJPEGにはメタデータが残り得る(Risksに記録)。要件定義書のFR-FILEU-017・DR-009の改訂が必要である。画像バリアント仕様とプライバシーポリシーの大枠の記述と整合させる                                                                                                                                                                                  |
| Q2  | 編集ダイアログの結果の送り方とサイズ上限の判定対象         | FR-FILEU-003・006、UI-007、FR-UPROF-002・FR-PRDCT-005〜006・FR-ADMAC-010、roadmapの実現性チェック、文言規則・ページ配置      | 推奨案。切り取りと用途ごとの最大寸法への縮小をブラウザで行い、JPEG原本はJPEG、それ以外はPNGで作り直して送る。サイズ上限は送るファイルで判定する。サーバーは直接送られた画像への防御として画素数の上限(目安1,600万画素、Workers統合テストとstagingで実測して確定)を検査する                                                                                                                                                                                                                                                                                                                                                                      |
| Q3  | Rekognitionの判定で隔離するカテゴリと信頼度                | FR-FILEU-013・SW-017・FR-FILEU-015、Rekognitionの既定の信頼度の下限(50%)                                                     | 推奨案ではなく「厳格」を採用。Rekognitionの全カテゴリを信頼度60%以上で隔離する。カテゴリと閾値は設定値にして、運用開始後に調整できるようにする                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Q4  | 許可リスト外の内容を含むSVGの扱い                          | roadmapの実現性チェック(fast-xml-parserの脆弱性)・FR-FILEU-010・014・018                                                     | 推奨案。DOCTYPE・ENTITYはアップロード時に拒否して書き出し直しを案内する。許可リスト外(script・foreignObject・イベント属性・外部参照など)は判定時に隔離して管理者の確認へ回す。Inkscape・Illustrator・RDFなど編集ツールの名前空間の要素・属性は許可する                                                                                                                                                                                                                                                                                                                                                                                          |
| Q5  | 業務データに紐付かないファイルの扱い                       | 4.25の前文・DR-001・briefの範囲外(紐付け方)・api-gatewayの決定(GraphQLでのアップロードは無効)                                | 推奨案。紐付かないまま24時間を過ぎたファイルを日次バッチで物理削除する。対象は画像用・ファイル用・隔離の3バケットで、エッジキャッシュも無効化する                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Q6  | 問い合わせの添付で実体検証を用意する形式の範囲             | FR-FILEU-007・009、FR-INQRY-007・019・020、briefのApproach、inquiry-chatのbrief                                              | 推奨案。画像5形式・PDF・プレーンテキストとする。テキストはUTF-8として読めてNUL文字を含まないことで検証する。判定には自前のシグネチャ表を使い、新規パッケージは無い。添付画像には編集ダイアログを出さず、選んだファイルのまま保存する                                                                                                                                                                                                                                                                                                                                                                                                            |
| Q7  | アップロード時に幅・高さを読み取る手段                     | FR-FILEU-022・roadmapの実現性チェック・CLAUDE.md(新規パッケージ)・tech-stack.md・backend-platformの設計(APIにImagesが無い)   | 推奨案。`image-size` 2.0.4を採用する。依存の無い純粋なJSで、`Uint8Array`からJPEG・PNG・GIF・WebP・SVGの寸法をヘッダーだけで読む。JPEGの向き情報による幅と高さの入れ替えは自前で行う                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Q8  | Rekognitionを呼ぶAWSのリージョンとIAMの資格情報            | SW-017・DR-012・プライバシーポリシーの大枠(委託先)・infra-deliveryのbrief(OpenTofuはAWSを含まない)・tech-stack.md(aws4fetch) | 推奨案ではなく「米国東部で手作業」を採用。us-east-1を使い、`rekognition:DetectModerationLabels`だけを許すIAMユーザーとポリシーを開発者が手作業で作り、手順をtechドキュメントに書く。アクセスキーはInfisicalのstaging・prodに登録する(stagingの値は、そのキーを必須にする変更をmainへマージする前に開発者が登録する。prodの値はlaunch-readinessがリリース時に登録する)。infra-deliveryのQ3でD1・R2も米国管轄に決まったため、データの保存先と処理先が米国にそろう。EU利用者の画像を米国へ送る根拠(データプライバシーフレームワーク等)をプライバシーポリシーの大枠・準拠方針で扱う必要がある(根拠の種類と分担は、横断レビュー2回目のN-1で確定した) |

- 他specの回答のうち本specに影響するもの: infra-deliveryのQ3(D1・R2を`jurisdiction = "us"`で作る)により、3つのバケットのバインディングに管轄の指定が要る(指定はinfra-deliveryの要件2.3が行う)。content-processingのQ1(共有ディレクトリ`apps/common-lib`の新設)は、本specの仮決定2で利用する。identity-authのQ5(波及処理を同期と非同期の2段階で行う)は、隔離理由の記録を同期で、バケット間の移動を非同期で行う本specの設計と整合する(ユーザーの退会・停止・停止解除の波及処理はuser-profile-socialが登録する。spec横断レビューの反映のI-1)。infra-deliveryのQ5・Q6により、prodのシークレットの登録はlaunch-readinessがリリース時に行う。

### 提示した選択肢(記録)

- Q1: JPEG出力の廃止 / 判定時の再エンコード版を保存 / アップロード時にメタデータ領域を除去 / 開発者の自由回答「JPEGのメタデータ除去はしないよう仕様変更」(採用)
- Q2: ブラウザで作り直して送る(採用) / 切り取りだけで縮小しない / 原本と切り取り範囲を送る
- Q3: 中程度(信頼度80%以上で6カテゴリ) / 厳格(全カテゴリを信頼度60%以上、採用) / 最小限(3カテゴリを信頼度90%以上)
- Q4: 隔離し、編集ツールのメタデータは許可(採用) / 編集ツールのメタデータも隔離 / 許可リスト外もアップロード時に拒否
- Q5: 一定時間後に削除(採用) / 削除と未使用分の上限 / 削除しない
- Q6: 画像・PDF・テキスト(採用) / 画像とPDFのみ / Office文書・ZIP・動画も含める(`file-type` 22系)
- Q7: `image-size` 2.0.4(採用) / 自前でヘッダーを解析 / APIにもImages Bindingを追加して`.info()`で読む
- Q8: 東京で手作業 / 東京でOpenTofu管理 / 米国東部で手作業(採用)

### 確認済みのため質問しない事項

- 専用Workerへの分離: 不要とした。要件2.5でWorkerのサイズ上限は非圧縮64MiBで、wasm-image-optimization(2.0.11、`/workerd`の入口あり)の本体約7.4MBは収まる。メモリはQ2の画素数の上限と、backend-platformの「バッチ内のメッセージは1件ずつ処理」で抑える。FR-FILEU-013は「イベントサーバー内で」と定めているため、実測で収まらない場合に限り、roadmapどおり改めて開発者に確認する。
- SVGのPNG化: wasm-image-optimizationはSkia(SkSVGDOM)でSVGを描画でき、GIF・WebP・BMPの入力にも対応する。FR-FILEU-013の「PNGへ変換」はSVGを含めて成り立つ。
- fast-xml-parserの版と設定: roadmapの指摘どおり5.11.2(2026-09-29公開)に固定し、`processEntities: false`にする。
- 判定できなかった画像の扱い: 4.25の前文(即時配信の優先)・NFR-AVAIL-002・backend-platformのQ7(デッドレターは通知して破棄し、再実行は各ドメインの冪等な処理に任せる)により、一時的な失敗は公開したまま「未判定」を記録して日次バッチで依頼し直し、画像として復号できない恒久的な失敗は自動判定の理由で隔離する。
- ugc-moderationとの責任分担: roadmapのShared seams「media-pipelineがデータモデルと移動処理を、ugc-moderationが管理操作を所有する」に従う。本specのドメイン操作は、隔離理由の追加・解除と「全理由が解消したら復元する」不変条件(FR-ADMUG-050)を持つ。ugc-moderationは管理画面・監査ログ・投稿者への通知・FR-ADMUG-018の経路の認可を持つ。ugc-moderationのbriefの「複数の隔離理由の判定」は、本specの操作を呼ぶ管理操作と読む。
- SVG検査による隔離の承認: FR-FILEU-015・FR-ADMUG-017の文言どおり自動判定による隔離として扱い、管理者の公開承認を可能にする。承認後もFR-FILEU-018のヘッダーで防御する。
- 画像配信ドメインのIP制限の除外: backend-platformのQ1で決定済み。
- CSP: SVG応答でのCSPの上書きはapi-gatewayのQ6・要件12.3で決定済み(応答が自らCSPを持てば既定のCSPで置き換えない)。フロントのimg-srcへの画像配信オリジン(`IMAGES_ORIGIN`)と、プレビュー用の`blob:`・`data:`はfrontend-platformで決定済み。
- 中継経路: アップロードとダウンロードの中継は、frontend-platformの`RelayRoute`(`/_bff/`)とapi-gatewayの内部REST(`/internal`・サブアプリが渡す`c.var.session`。api-gatewayの改訂3)で決定済み。GraphQLでのアップロードはapi-gatewayで無効と決定済み。CSRFの検証はGET・HEAD・OPTIONS以外の全要求に適用済み。
- リソース: R2の3バケット(`IMAGES_BUCKET`・`FILES_BUCKET`・`QUARANTINE_BUCKET`)、eventの`IMAGES`バインディング、`JOBS_QUEUE`とデッドレターキュー、再試行の規則、メッセージ種別の命名`<ドメイン>.<動詞句>`はbackend-platformで決定済み。
- 変換配信の仕様: 画像バリアント仕様で決定済み(バリアント・URL・`Cache-Control`・パージ・404の`no-store`・「GIFは最初のフレームのみ」)。Q1の結果だけを反映する。
- HW-001のカメラ: モバイルでは、ネイティブのファイル選択(`<input type="file">`)がカメラ撮影を選択肢に出す。`getUserMedia`は使わず、Permissions-Policyの`camera=()`も変えない。iOSは、`accept`にHEICが無ければJPEGへ変換して渡す。
- Rekognitionの呼び出し方式: FR-FILEU-013のとおり、640px以下のPNG・JPEGをバイト列で同期API(DetectModerationLabels)に送る。ローカルとCIでは、tech-stack.mdどおり決定論的スタブを使う。
- aws4fetch・react-easy-crop: どちらもtech-stack.mdで採用済み。aws4fetchは1.0.20(2024-08)以降リリースが無いが、依存が無くSigV4の仕様も安定しているので変えない。react-easy-cropの最新の6.2.4は2026-10-06公開で、公開から2週間に満たないため、2週間以上前の6.2.3(2026-07-24公開)に固定する(共通指示の版の規則)。
- Requirement Ambiguities: roadmapの表に、担当がmedia-pipelineの行は無い。

### 仮決定(2026-10-18に開発者が承認)

生成中に見つかった、開発者の判断を要する論点である。回答と上流specに最も整合する案を選び、`requirements.md`・`design.md`はその案で書いた。2026-10-18に3件とも「選んだ案」のとおり承認され、確定した(仮1はQ&Aで個別に承認、仮2・仮3は他specの仮決定とともに一括で承認)。

| #   | 論点                                                                             | 選んだ案                                                                                                                                                                                                                                                                                                       | 他の選択肢                                                                                                                                                                                       |
| --- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 仮1 | 利用者が削除した画像(論理削除)を、物理削除までの13日間配信し続けるか             | 配信を続ける。画像配信はデータベースを参照せずバケットの有無だけで応答する(読み取り系の可用性と速さを優先)。業務データからの参照は消えるためページには表示されない。FR-FILEU-024が「画像用非公開バケット及び隔離バケット内の当該画像」を削除対象としており、論理削除中も画像用非公開バケットに残る前提と読める | 論理削除の時点で隔離バケットへ移し、エッジキャッシュを無効化して配信を止める(隔離理由とは別の「削除済み」を保存先の判定に加える)。プライバシー上はこちらが強いが、移動の処理が削除のたびに増える |
| 仮2 | 前後で共有する定義(バリアント表・形式の一覧・エラーコード・中継の経路)の置き場所 | content-processingが新設する`apps/common-lib`の`media/`に置き、client・admin・api・eventで共有する。本specの実装は、content-processingの`apps/common-lib`新設のタスクの完了を前提とする                                                                                                                        | `apps/frontend-lib`と`apps/backend-lib`に同じ定義を別々に置き、値の一致を画像バリアント仕様で管理する(spec間の実装順の制約は生じないが、定義が2重になる)                                         |
| 仮3 | 不透明な非JPEG画像(WebP写真など)をPNGで作り直すとサイズ上限を超える場合          | 決定Q2の文言どおりPNGで作り直し、上限を超えたら切り取る範囲を狭めるか別の画像を選ぶよう案内する。各ドメインspecが最大寸法を上限に見合う値にする                                                                                                                                                                | 透過の無い画像に限り、上限を超えたときJPEGで作り直す / 上限に収まるまで寸法を段階的に下げる                                                                                                      |

### spec横断レビューの反映(2026-10-18)

Wave 1の横断レビュー(kiro-spec-batch Step 4)の指摘と、開発者の決定を反映した。2回目の横断レビューの指摘(N-1〜N-7)と開発者の決定は、「(2回目)」を付けた行に記録する。3回目の横断レビューの指摘のうち本specが担当するもの(R3-1・R3-3・R3-5・R3-8)と、関係する決定(R3-6の型)は、「(3回目)」を付けた行に記録する(2026-10-19)。

| 指摘 | 決定・対応                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C-1  | `apps/common-lib`の新設はcontent-processingに残し、roadmapの順をinfra-delivery→content-processing→media-pipeline→identity-authにした。本specが前提にするのは、content-processingのタスク1.1・1.2・4.1・4.2と、frontend-libの`server/**`からcommon-libを読み込む許可である(tasks.md 1.1、design.mdのAllowed Dependencies)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| I-1  | ユーザーの退会に伴う物理削除(`purge_due`)と、停止・停止解除に伴う隔離理由`user_suspended`の付け外しは、user-profile-socialがidentity-authのユーザーライフサイクルイベントの波及処理として登録する。identity-authは登録口を提供するだけである。本specは、そのための保有者単位の操作として、既存の`eraseOwnedBy`に加えて`addReasonForOwner`・`removeReasonForOwner`を契約に加えた(要件9.10)。3つとも1回の処理件数に上限(1,000件)を設け、残りの有無(`hasMore`)を返す(要件13.9)。identity-authの非同期の波及処理は、1回の呼び出しで終わらない場合に`continue`を返し、進み具合を波及処理が自分のデータで判断する契約のため、`hasMore`をそのまま`continue`へ対応付けられる                                                                                                                                                                                                                                                                        |
| I-3  | stagingの値は、そのキーを必須にする変更をmainへマージする前に開発者が登録する(`REKOGNITION_ACCESS_KEY_ID`・`REKOGNITION_SECRET_ACCESS_KEY`。任意の`MEDIA_SMOKE_TOKEN`も同じマージの前に登録する)。prodの値はlaunch-readinessがリリース時に登録する。Infisicalの表と`OPTIONAL_WORKER_SECRETS`(event)への記載はinfra-deliveryで追記済みで、本specは確かめるだけである(無かった場合の扱いはN-2の行で改めた)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| I-4  | 技術ドキュメントの番号を`external/003`・`infra/008`・`security/005`に固定し、「実装時点の最大の番号の次」の規則を削除した                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| M-2  | content-processingが、frontend-libの`server/**`から`common-lib/media`などを読み込む許可を加える(`common-lib/validation/**`は不可)。本specの`server/media`は`common-lib/media`だけを読み込む                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| M-4  | 日次タイムラインのジョブの名前と順序の表はcontent-processingが作り、本specはタスク9.2で810〜830の行を加える(表が無い場合の扱いはN-3の行で改めた)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| M-6  | マイグレーションの生成(タスク1.2)は、mainの最新を取り込んでから行い、番号の衝突があれば生成し直す                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| M-8  | プライバシーポリシーの大枠と準拠方針は、infra-deliveryがCloudflareの資源の保存場所(D1・R2・Queuesは米国、Durable Objectsは保証しない)を、本specがRekognition(us-east-1)への送信とその移転の根拠(国外移転の記載事項)を書き、互いの記述を上書きしない(分担の単位はN-1の行で委託先単位に改めた)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| M-9  | ジョブ名を`<spec名>.<名詞句>`の規約に合わせ、`media-pipeline.expired-file-erasure`・`media-pipeline.moderation-requeue`・`media-pipeline.location-reconciliation`に改めた。メッセージ種別(`<ドメイン>.<動詞句>`の`media.*`)は変えない                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| M-10 | frontend-platformの中継の415の挙動は変えずに合わせる。中継は全用途の許可形式の範囲(`ATTACHMENT_MEDIA_TYPES`)で判定して415`unsupported_media_type`を返し得るため、アップロード部品は`Content-Type`に引数を付けずに送り、`parseUploadResponse`は`unsupported_media_type`をAPIの`unsupported_file_type`と同じ文言に対応付ける。用途ごとの判定はAPI(引数を除いて照合)が行う                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| N-1  | (2回目)プライバシーポリシーの大枠と準拠方針の国外移転の記載事項・データの保存場所は、節単位ではなく委託先単位で分担する。infra-deliveryがCloudflareの項(D1・R2・Queuesの米国での保存、所在を限定しない処理の扱い、移転の根拠)を、本specがAWS(Rekognition、us-east-1)の項を書き、互いの項を書き換えない。項の形はCloudflareの項と同じ「移転先・移転の根拠・委託先が講じる措置」とし、共通の「移転先の国」の行はAWSの記述だけを項への参照に改める。根拠はEU-USデータプライバシーフレームワーク(DPF)を主とし、DPFが無効になった場合はAWSのデータ処理補遺(DPA)に含まれる標準契約条項(SCC)に拠る。法務文書の本文は開発者が用意し、本specは記載事項として扱う(要件16のObjective・16.4、design.mdのOut of Boundary・Modified Files、tasks.md 9.2)。M-8の行の節単位の分担は、この行で改めた                                                                                                                                                         |
| N-2  | (2回目)タスク1.3が前提にするinfra-deliveryのコード(Infisicalの表と`OPTIONAL_WORKER_SECRETS`のeventへの追記)は、「無ければ止める」から「確かめて、無ければ開発者へ報告する(止めない)」に改めた。infra-deliveryはroadmapの依存に加えない。未実装でもCIのデプロイが無いだけで、本specの実装は進められるためである(identity-authのタスク13.1と同じ扱い)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| N-3  | (2回目)前提にするcontent-processingの最小の区切りに、6.1(frontend-libの`server/**`からcommon-libを読み込む許可と`validation/**`の禁止の静的解析の規則)、11.3のうち`coding/003`への`server/**`の許可の記述、11.4のうち日次タイムラインの表の作成を加えた(tasks.md 1.1、design.mdのAllowed Dependencies)。許可は6.1の単体テストの成功と`coding/003`の記述で確かめる。日次タイムラインの表は最初に4:21のジョブを足すspecが作り、後のspecは行を足す。本specも、表が無ければ同じ形で作り(email-deliveryの900を含める)、表が無いことを理由に止めない(tasks.md 9.2)。M-4の行の「表が無ければ止める」は、この行で改めた                                                                                                                                                                                                                                                                                                                             |
| N-4  | (2回目)ジョブ名の規約(ジョブ・波及処理は`<spec名>.<名詞句>`、メッセージ種別は`<ドメイン>.<動詞句>`)の置き場所は、roadmapのShared seams(親エージェントが追記)と、content-processingのタスク11.5が追記するbackend-platformの`infra/003-async-processing.md`である。本specのジョブ名とメッセージ種別は規約に合っており、変更は名前の一覧への参照の追記だけである                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| N-5  | (2回目)シークレットのキーの一覧の正は、`docs/onboardings/project-values.md`のWorkerのシークレットのキーの一覧の節(infra-deliveryのタスク8.5が作る)とする。本specはキーを宣言する変更(タスク1.3)と同じ変更で行を足し、既に行があれば食い違いを確かめるだけにする。節が無ければ開発者へ報告して進める。技術ドキュメント(タスク9.1)にはキーの名前を列挙しない                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| N-6  | (2回目)本specの変更は無い。運営者による代理の退会の操作口はidentity-auth、導線はugc-moderationが持つ。退会者のファイルの物理削除は、従来どおりuser-profile-socialの波及処理が`eraseOwnedBy`を呼ぶ                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| N-7  | (2回目)停止中の利用者は既存のセッションでアップロードできたため、利用者のアップロードの受付に差し込み口`UploaderEligibility`(DIの識別子`UPLOAD_ACCESS_TYPES.UploaderEligibility`、束縛の置き場所`apps/api/src/composition/uploader-eligibility.ts`)を設けた。既定の実装`AllowAllUploaderEligibility`は全て許可する。判定は利用者側の経路だけで、主体の種類の確認の後、本文の検証と保存の前に行う。拒否は403と、判定が示す`account_unavailable`・`email_not_verified`で応答する。エラーコードはidentity-authの`AccountGuard`と同じ名前にし、文言は文言規則の既存の「停止中アカウント」「メール未確認」を使う(要件1.8・1.9、tasks.md 2.1・5.1・5.6・8.2)。identity-authは、本specのタスク5.1・5.6の後に、この束縛を`AccountGuard`の判定で差し替える(停止中は拒否、メールアドレス未確認の扱いは要件定義書の未確認時の制限に従う)。既定の全許可は、identity-authの実装前にはログインが成立せず利用者のアップロードが401になるため、穴にならない |
| R3-1 | (3回目)`UploaderEligibility.check`の入力`session`が、application層からpresentation層の`SessionAccess`を型だけで読み込んでおり、backend-platformの層の規則(`no-restricted-imports`)に違反していた。開発者の決定により、application層のセッションの読み取り専用の型`SessionView`(`apps/api/src/application/session/session-view.ts`、メンバーは`principal(): Promise<Principal>`だけ。セッションのIDは`AuthenticatedPrincipal.sessionId`で読む)を受け取る形に改めた。`SessionView`はapi-gatewayの契約への追記で、追加と`SessionAccess`をその拡張に改める作業はidentity-authのタスク2.3が行う。roadmapの順では本specのタスク5.1が先に実装されるため、5.1の時点で無ければ5.1が同じ形・同じ場所で置き、`SessionAccess`は変えない(構造的部分型で代入できる)。2.3は、既にあれば一致を確かめるだけにする(design.mdの「UploaderEligibility・既定の実装」・Allowed Dependencies・Revalidation Triggers・File Structure、tasks.md 5.1)                 |
| R3-3 | (3回目)identity-authのタスク8.5が束縛を差し替えることと、そのテストへの影響を本specにも書いた。タスク5.1のWorkers統合テストは、差し込み口をテストのコンテナへ明示的に束縛し(全許可の実装、または拒否する偽物)、`composition/uploader-eligibility.ts`の束縛に頼らないため、差し替えの影響を受けない。タスク5.6の登録箇所の既定値の単体テスト(全許可)は、8.5が差し替えるまでの既定値であり、8.5がその期待値を直す(design.mdのRevalidation Triggers・Testing Strategy、tasks.md 5.1・5.6)                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| R3-5 | (3回目)プライバシーポリシーの大枠と準拠方針の国外移転の記載事項のうち、Google Cloud(Natural Language API)の項はcontent-processingが本specのAWSの項と同じ形と根拠の種類で書くことを、他specへの期待と再検証の契機に加えた。本specはその項を書き換えない(requirements.mdの決定事項・Out of scope・Adjacent expectations・要件16のObjective・16.4、design.mdのOut of Boundary・Revalidation Triggers・Modified Files、tasks.md 9.2)。あわせて、Cloudflareの項の所在を限定しない処理の列挙を、infra-deliveryのR3-4の修正(メール送信・Turnstile・Web Analytics)にそろえた                                                                                                                                                                                                                                                                                                                                                                        |
| R3-6 | (3回目)本specの担当ではないが、infra-deliveryのタスク8.5が示す国外移転の記載の型に合わせた。骨子は共通の行の後に見出し`### AWS(Rekognition)`を置き、「移転先」「移転の根拠」「委託先が講じる措置」の3項目を書く。準拠方針の「データの保存場所」の表(Cloudflareの資源の一覧)には行を足さず、表の下に`- **AWS(Rekognition)**: …。移転の根拠は骨子のAWSの項を正とする。`の箇条を足す。全委託先に共通の「移転の法的根拠」の行はinfra-deliveryが改めるため、本specは書き換えない(要件16.4、design.mdのModified Files、tasks.md 9.2)                                                                                                                                                                                                                                                                                                                                                                                                              |
| R3-8 | (3回目)主体の種類が対象外の文言「この操作はできません。」(`upload_forbidden`)は文言規則に無かったため、タスク9.2の文言規則への追加の対象に加えた。identity-authの`forbidden`も同じ文言を使い、roadmapの順で先に実装される本specが加える。identity-authのタスク12.2は、既にあれば確かめるだけにする(design.mdのModified Files、tasks.md 9.2)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

- I-1で検討した別案: identity-authが本specに依存して自ら波及処理を登録する案(横断レビューの案B)は、identity-authの依存が増えるため採らなかった(開発者の決定)。保有者単位の隔離の操作を設けず、user-profile-socialがファイルの識別子を集めて`addReason`を呼ぶ案は、ドメインが参照を持たない未紐付け・論理削除中の画像(仮1により配信が続く)を取りこぼすため採らなかった。
- M-5(4:21の1回の起動に全ジョブが直列で載り、時間の予算が無い)は、backend-platformと開発者の判断を待つため本specでは変えていない。

### spec横断レビューの反映(2026-10-23)

共通ドメイン5spec(admin-foundation・legal-pages・inquiry-chat・payments・ultras-subscription)の作成後の横断レビューで、要件定義書の`kB`・`MB`の基数が未決定だった。開発者の決定(2026-10-23)により、ファイルサイズの上限は1,024を基数とする(1kB = 1,024バイト、1MB = 1,048,576バイト)。規則は文言規則の「容量の単位」に置く。

| 項目                    | 決定・対応                                                                                                                                                                                                                                                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MAX_UPLOAD_BYTES`      | 20,000,000から20,971,520(20MB)へ改めた(design.mdのMediaTypes、tasks.md 2.1・3.1)                                                                                                                                                                                                                                            |
| 画像用の用途の上限      | Images Bindingの`.input()`の上限は「20MB」で基数の明記が無いため、外部の上限として安全側の20,000,000バイトを`IMAGE_STORAGE_MAX_BYTES`とし、`defineUploadPurpose`が`storage: 'images'`の用途の`maxBytes`をこの値以下に制限する。現在の画像の用途(500kB・5MB)はいずれも下回る(design.mdのUploadPurposeRegistry、tasks.md 3.1) |
| 判定用画像の上限        | `MODERATION_IMAGE_LIMITS.maxBytes`を5,000,000から5,242,880へ改めた。RekognitionのAPI参照の`Image.Bytes`の最大長が5,242,880であり、外部の上限の値そのものである(design.mdのModerateImageHandler、tasks.md 6.2)                                                                                                               |
| 動作確認用の用途        | `MEDIA_SMOKE_PURPOSE`の5MiBは5,242,880バイトで既に同じ値のため、表記だけを「5,242,880バイト(5MB)」にそろえた                                                                                                                                                                                                                |
| Workersの要求本文の上限 | 最大の上限20,971,520バイトは、Workersの要求本文の上限(Free・Paidで100MB)を下回るため、受け付けの方式は変えない                                                                                                                                                                                                              |
| ドメインspecの上限      | 各ドメインspecが登録する`maxBytes`(プロフィール画像・ロゴの500kB = 512,000バイト、スクリーンショットの5MB = 5,242,880バイト、問い合わせの添付の合計20MB = 20,971,520バイトなど)も同じ換算にする。admin-foundationの`admin-avatar`(512,000バイト、仮2)は既にこの換算である                                                   |

## Research Log

### Images Bindingの変換とメタデータ

- **Context**: briefの実現性チェック(Images BindingではExifを除去できない)、決定Q1、画像バリアント仕様の出力フォーマット表。
- **Sources Consulted**: Cloudflare Docs「[Images binding](https://developers.cloudflare.com/images/optimization/binding/)」「[Features](https://developers.cloudflare.com/images/optimization/features/)」「[Limits](https://developers.cloudflare.com/images/get-started/limits/)」。
- **Findings**:
  - `.input(stream)`は20MBまでの画像を受け付ける(「Accepts image bytes up to 20 MB」。基数の明記は無い)。`.transform()`は`width`・`height`・`fit`など、`.output()`は`format`・`quality`・`anim`を受け付け、`format`は必須。`.response({ headers })`で`Cache-Control`を付けられ、`Content-Type`は出力形式から決まる。
  - `metadata`の指定はJPEG出力にだけ効き、既定は著作権情報以外を捨てる`copyright`。WebP・PNG・AVIF出力は常に全メタデータを捨てる。向き情報と色のプロファイルは、メタデータを捨てても画像に適用される。
  - 呼び出しは一意な変換(元画像と変換の引数の組)ごとに月1回だけ課金され、`.info()`は無料。無料枠は月5,000件で、超えるとImages Paidが要る。
  - Images Bindingの応答は自動ではキャッシュされず、Workers Cacheの有効化が推奨されている。
  - ローカルとWorkers統合テストでは簡易版が動き、width・height・rotate・formatだけに対応する(`fit`・`quality`は効かない)。
- **Implications**: 配信は`.input().transform({ width, height, fit }).output({ format, quality: 80, anim: false })`で行う。JPEG出力のメタデータは変換基盤の既定に任せる(決定Q1)。`fit`・`quality`・メタデータの扱いはstagingの動作確認の経路で確かめる手順を技術ドキュメントに書く。stagingとprodが同じアカウントなら無料枠を共有するため、費用の判断をlaunch-readinessへ回す。

### Workers Cacheのエントリポイント単位の有効化とパージ

- **Context**: SW-010・画像バリアント仕様の「キャッシュとパージ」、backend-platformの`cache.enabled: false`。
- **Sources Consulted**: Cloudflare Docs「[Workers Cache](https://developers.cloudflare.com/workers/cache/)」「[Configuration](https://developers.cloudflare.com/workers/cache/configuration/)」「[Cache keys](https://developers.cloudflare.com/workers/cache/cache-keys/)」「[Purge](https://developers.cloudflare.com/workers/cache/purge/)」「[Examples](https://developers.cloudflare.com/workers/cache/examples/)」「[Limitations](https://developers.cloudflare.com/workers/cache/limitations/)」。
- **Findings**:
  - `exports`の各エントリポイントに`{ "type": "worker", "cache": { "enabled": <真偽> } }`を書くと、Worker全体の`cache.enabled`を上書きする(Wrangler 4.107.0以上。本プロジェクトは4.124.0)。キャッシュは`fetch()`の呼び出しにだけ効き、独自のRPCメソッドの呼び出しは常にキャッシュを通らない。
  - キャッシュは既定のエクスポートを含む全エントリポイントの前段にあり、`ctx.exports`による同じWorker内の`fetch()`呼び出しの前段にもある。推奨される「関門」の構成は、関門のエントリポイントのキャッシュを無効にし、キャッシュする内側のエントリポイントを`ctx.exports`で呼ぶものである。
  - キャッシュキーは、対象のエントリポイント・パスとクエリ・`ctx.props`・(既定で)Workerの版から作られ、ホスト名を含まない。既定ではデプロイのたびに空のキャッシュから始まる(`cache.cross_version_cache`で版をまたげる)。
  - `GET`と`HEAD`だけがキャッシュされ、同じURLのエントリを共有する。`Authorization`・`Set-Cookie`を伴う要求・応答は自動でキャッシュを迂回する。
  - `ctx.cache.purge()`は`tags`・`pathPrefixes`・`purgeEverything`を受け付ける。`pathPrefixes`はスキームとホストを含まないパスである。パージは呼び出したエントリポイントのキャッシュにだけ効き、他のエントリポイントのキャッシュへは届かない。回数はゾーンのパージと同じ仕組みで、プランによらずFreeプランの上限が適用される。拒否されると`success: false`が返る。
  - ローカル(`wrangler dev`・Vitest)でのWorkers Cacheとパージの扱いは文書に記載が無い。
- **Implications**: eventの既定のエクスポートは関門としてキャッシュを無効のままにし、画像配信を名前付きエントリポイント`ImageDelivery`(キャッシュ有効)に置く。関門はクエリ文字列と要求ヘッダーを落とした`GET`/`HEAD`の要求を`ctx.exports.ImageDelivery.fetch()`へ渡す。パージは`ImageDelivery`のRPCメソッド`purgeObjectKeys()`の中で`this.ctx.cache.purge()`を呼ぶ。`ctx.cache`が無い環境(ローカル・テスト)では何もせず成功として扱う。版をまたぐキャッシュは使わない(Design Decisions参照)。

### R2の条件付き書き込みと管轄

- **Sources Consulted**: Cloudflare Docs「[Workers API reference](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)」「[Consistency](https://developers.cloudflare.com/r2/reference/consistency/)」「[Data location](https://developers.cloudflare.com/r2/reference/data-location/)」「[New us jurisdiction for R2](https://developers.cloudflare.com/changelog/post/2026-08-17-r2-us-jurisdiction/)」。
- **Findings**:
  - `put()`の`onlyIf`は`R2Conditional`または条件付きヘッダーの`Headers`(`If-Range`以外)を受け付ける。条件が満たされなければ`null`を返し、保存しない。条件は書き込みの確定と同時に評価され、`If-None-Match: *`の同時の書き込みは1つだけが成功する。
  - `delete()`は1回で1,000キーまで消せる。R2のWorkers APIにはバケット間のコピーが無く、読み出して書き込む必要がある。
  - `ReadableStream`を`put()`に渡すには長さが分かっている必要がある(`FixedLengthStream`で包む)。
  - 管轄付きのバケットをWorkersから使うには、バインディングに`jurisdiction`を指定する。管轄は作成後に変えられない。S3 APIのエンドポイントは`https://<ACCOUNT_ID>.us.r2.cloudflarestorage.com`、Data Access Logsは使えない(共通指示)。
- **Implications**: 保存は`onlyIf: new Headers({ 'If-None-Match': '*' })`で行い、`null`なら上書きしようとしたとして扱う。本文は検証済みの先頭部分と残りをつないだ流れを`FixedLengthStream(Content-Length)`へ通して書き込み、長さが食い違えば書き込みが失敗する。staging・prodのapi・eventのR2バインディング3つへの`jurisdiction: "us"`の指定は、infra-deliveryの要件2.3が実行環境設定へ反映する(ローカルは管轄を持たない)。本specはそれを前提にし、backend-platformのWrangler設定への影響として報告する。

### `ctx.exports`

- **Sources Consulted**: Cloudflare Docs「[Context](https://developers.cloudflare.com/workers/runtime-apis/context/)」「[Compatibility flags](https://developers.cloudflare.com/workers/configuration/compatibility-flags/)」。
- **Findings**: `ctx.exports`は`WorkerEntrypoint`を継承した各トップレベルのエクスポートへのループバックのService Bindingを自動で持つ。互換性フラグ`enable_ctx_exports`は2025-11-17から既定で有効である。
- **Implications**: 互換性日付2026-08-04のまま使える。`queue`ハンドラーからも`ctx.exports.ImageDelivery.purgeObjectKeys()`を呼べる(実装時にWorkers統合テストで確かめ、テスト環境で使えない場合はパージの呼び出し口を注入して偽物に差し替える)。

### Amazon Rekognition DetectModerationLabels

- **Sources Consulted**: AWS「[DetectModerationLabels](https://docs.aws.amazon.com/rekognition/latest/APIReference/API_DetectModerationLabels.html)」、questionsの調査記録(入力の上限・カテゴリ)。
- **Findings**:
  - JSONの`Image.Bytes`(base64)と`MinConfidence`(0〜100、既定50)を送る。入力はJPEG・PNGだけで、バイト列は5MBまで(API参照「[Image](https://docs.aws.amazon.com/rekognition/latest/APIReference/API_Image.html)」の`Bytes`の最大長は5,242,880)、各辺80px以上10,000px以下。
  - 応答の`ModerationLabels`は`Confidence`・`Name`・`ParentName`・`TaxonomyLevel`を持つ。最上位のカテゴリはExplicit、Non-Explicit Nudity of Intimate parts and Kissing、Swimwear or Underwear、Violence、Visually Disturbing、Drugs & Tobacco、Alcohol、Rude Gestures、Gambling、Hate Symbolsの10種である。
  - エラーは`ThrottlingException`(500)・`InternalServerError`(500)・`ProvisionedThroughputExceededException`(400)・`ImageTooLargeException`(400)・`InvalidImageFormatException`(400)・`InvalidParameterException`(400)・`AccessDeniedException`(400)など。
- **Implications**: 一時的な失敗は`ThrottlingException`・`InternalServerError`・`ProvisionedThroughputExceededException`・その他の5xx・通信の失敗・10秒の時間切れとする。画像として受け付けられない失敗(`ImageTooLargeException`・`InvalidImageFormatException`・`InvalidParameterException`)は恒久的な失敗として隔離する。資格情報や署名の誤り(`AccessDeniedException`・`UnrecognizedClientException`・`InvalidSignatureException`)は設定の誤りとして一時的な失敗と同じく再試行し、Sentryへエラーとして送る。判定は`MinConfidence`に閾値を渡し、返ったラベルを`ParentName`でたどった最上位のカテゴリが設定のカテゴリに含まれれば不適切とする。

### wasm-image-optimization 2.0.11

- **Sources Consulted**: npmの配布物(`dist/workerd.d.ts`・`core.js`・README)をscratchpadへ展開して確認した(実行はしていない)。
- **Findings**:
  - `exports`の`workerd`条件と`./workerd`の入口があり、`.wasm`をimportして`WebAssembly.Module`として使う。`optimizeImage({ image, width, height, fit: 'contain'|'cover'|'fill', format: 'png'|'jpeg'|'webp'|'avif'|'raw'|..., quality, animation })`はモジュールを1回だけ初期化して再利用する。
  - `format: 'raw'`は32ビットRGBAの画素を返す。`animation: false`(既定)ではアニメーションの最初のフレームだけを扱う。SVGはSkia(SkSVGDOM)で描画する。
  - 1回の呼び出しの中で、読み込み・縮小・符号化は同期的に進む。依存の`commander`はCLI用で、Workerのバンドルには入らない。
  - 公開は2026-09-13で、公開から2週間以上経っている。
- **Implications**: 判定用の画像は、縮小だけなら`optimizeImage()`の`png`・`jpeg`で作る。余白が要る場合は`raw`で縮小した画素を受け取り、余白を足してPNGに符号化する(PNGの符号化は`CompressionStream('deflate')`を使う数十行の自前の部品にする)。Workers統合テストでwasmが読めない場合は、描画の部品を注入できる形にして、実物の確認をローカルの`wrangler dev`の動作確認へ回す。

### image-size 2.0.4・fast-xml-parser 5.11.2・aws4fetch 1.0.20・react-easy-crop 6.2.3

- **Sources Consulted**: 各パッケージの配布物の`package.json`と型定義。
- **Findings**:
  - `image-size`: 依存無し。`imageSize(input: Uint8Array)`が`{ width, height, orientation?, type? }`を返し、`disableTypes()`で判定する形式を絞れる。`fromFile`の入口だけがNode.jsのファイルAPIを使う。
  - `fast-xml-parser`: ESMの入口`src/fxp.js`。`XMLValidator.validate()`と`XMLParser`(`preserveOrder`・`ignoreAttributes`・`processEntities`・`maxNestedTags`など)を持つ。依存は`@nodable/entities`・`strnum`など純粋なJSである。
  - `aws4fetch`: 依存無し。`worker`条件の入口があり、`AwsClient`の`fetch`でSigV4に署名する。
  - `react-easy-crop`: 相手依存はReact・ReactDOM 16.4以上、依存は`normalize-wheel`。`onCropComplete`が切り取り範囲の画素座標(`croppedAreaPixels`)を返し、`keyboardStep`でキーボード操作の移動量を指定できる。
- **Implications**: `image-size`と`fast-xml-parser`はapi・eventの両方(共有の`backend-lib`から使う)、`wasm-image-optimization`と`aws4fetch`はeventだけ、`react-easy-crop`はclient・admin・frontend-libに版を固定して宣言する。`image-size`の`fromFile`は使わない。

### 参照したスキル

- `cc-sdd:kiro-spec-requirements`・`kiro-spec-design`・`kiro-spec-tasks`: テンプレート・EARS・各フェーズのレビューゲート。
- `ecc:api-design`: 状態コードの使い分け(400と422、401と403、503の`Retry-After`)、作成の応答は`201 Created`と`Location`、成功の応答は`{ "data": ... }`、エラーは`{ "error": { "code", "message" } }`。アップロードの応答に`Location`(非公開ファイルの配信のパス)を付ける。
- `ecc:security-review`: ファイルのアップロードは大きさ・形式を許可リストで制限する。本specは申告の形式と拡張子ではなく内容(マジックバイト・構文)で判定し、拡張子は判定に使わない(拡張子は利用者の申告で、内容を保証しないため)。
- `cross-border-transfers-skills:eu-us-dpf-assessment`: EUから米国への移転は、移転先がEU-U.S. Data Privacy Frameworkに自己認証していれば十分性認定に基づけ、自己認証していない場合は標準契約条項などが要る。プライバシーポリシーの大枠には、委託先ごとの移転の根拠を記す。

## Architecture Pattern Evaluation

| Option                                        | Description                                                                                        | Strengths                                        | Risks / Limitations                                                            | Notes  |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------ | ------ |
| 用途を登録する汎用パイプライン+ドメインの操作 | 受付・検証・保存・判定・配信を用途に依存させず、ドメインspecは用途の登録と操作の呼び出しだけを行う | 検証の抜けが起きない。ドメインspecの実装が小さい | 用途の登録値(上限・形式)の誤りは各specの責任になる                             | 採用   |
| 用途ごとの経路とハンドラー                    | 各ドメインspecがアップロードの経路を持つ                                                           | 用途ごとの自由度が高い                           | briefの問題(検証の抜け)そのもの                                                | 不採用 |
| 画像処理専用のWorker                          | 判定と変換を別Workerに置く                                                                         | メモリ・CPUの分離                                | FR-FILEU-013の「イベントサーバー内で」と異なり、Worker・設定・デプロイが増える | 不採用 |

- 層は、純粋な規則(`apps/common-lib/media`・`backend-lib/core/media`、イベントサーバーの`application/media`)と、実行環境に依存する部品(`backend-lib/workers/media`・各アプリの`infrastructure`・`presentation`)に分ける。前者はBunの単体テスト、後者はWorkers統合テストで検査する(backend-platformの規約)。

## Design Decisions

### Decision: 用途の登録制と、ドメインの操作のポート

- **Context**: 要件1・5・9・12・13。用途の値はドメインspecが決め(briefのApproach)、業務データとの紐付け方は範囲外である。
- **Selected Approach**: APIサーバーの登録箇所(`composition/upload-purposes.ts`)へ用途の定義(名前・保存先・主体の種類・許可形式・上限)を追記する。業務データからは、紐付け・論理削除・即時削除・保有者単位の削除・一括取得・内容の読み出しを持つ`MediaFiles`と、隔離理由の追加・解除(ファイル単位と保有者単位)と一覧を持つ`MediaQuarantine`を、DIの識別子で呼ぶ。非公開ファイルの閲覧の可否は用途ごとの`FileReadPolicy`を、管理者の画像の確認は`AdminMediaReviewPolicy`(既定は拒否)を登録する。
- **Generalization**: 画像用・ファイル用の両方を、保存先と許可形式が異なる「用途」の特殊形として1つの経路で扱う。動作確認の経路も同じ受付処理を固定の用途で呼ぶ。
- **Trade-offs**: 業務データ側でのファイルIDの保持はドメインspecが行うため、紐付け忘れのファイルは24時間で消える(決定Q5の副作用として許容する)。

### Decision: 記録を先に作り、保存の完了を後から記録する

- **Context**: 要件4.10・5.5。保存とデータベースの書き込みは原子的でない。
- **Alternatives Considered**:
  1. 保存の後に記録を作る — 記録の作成に失敗するとバケットに参照の無いオブジェクトが残り、誰も消せない。
  2. 記録を先に作り(保存未完了)、保存の成功後に完了を記録する — 失敗しても記録が残るため、未使用ファイルとして日次バッチが消せる。
- **Selected Approach**: 2。紐付けと非公開ファイルの配信は保存完了の記録があるものに限る。失敗時はその場で記録とオブジェクトの削除を試み、失敗しても日次バッチが消す。

### Decision: 実体の検証は先頭部分の読み取りと、流しながらの検証で行う

- **Context**: 要件1.3・2.5・3。SW-009はストリーミングでのアップロードを求め、メモリは128MBである。
- **Selected Approach**:
  - SVG以外の画像・PDFは、先頭の最大1MiB(本文がそれより短ければ全体)を読んでマジックバイトと寸法を判定し、読んだ部分と残りをつないだ流れを保存する。
  - SVGは全体を読んで検査する(用途の上限で大きさが抑えられる)。
  - プレーンテキストは、UTF-8の復号とNUL文字の検査を流しながら行い、違反を見つけた時点で流れを失敗させて保存を中止する。
  - 長さは`FixedLengthStream`で`Content-Length`と照合する。
- **Trade-offs**: JPEGの寸法の情報(SOF)が先頭1MiBより後ろにある画像は寸法を読めずに拒否する。通常の経路ではブラウザが作り直すため起きない。

### Decision: 画像配信は関門と名前付きエントリポイントに分け、パージはRPCで行う

- **Context**: 要件10・11、申し送り(Workers Cacheの有効・無効、パージの範囲)。
- **Selected Approach**: eventの既定のエクスポートはキャッシュを無効にしたまま、Honoの経路として画像配信の関門を持つ(IP制限の除外・アクセスログ・Sentryは既存の仕組みに乗る)。関門は画像配信ドメインかつ画像のURLの形式の要求を、クエリ文字列と要求ヘッダーを落として`ctx.exports.ImageDelivery.fetch()`へ渡す。`ImageDelivery`だけキャッシュを有効にする。パージはQueueの処理から`ctx.exports.ImageDelivery.purgeObjectKeys()`(RPCはキャッシュを通らない)を呼び、その中で`this.ctx.cache.purge({ pathPrefixes })`を実行する。
- **Rationale**: キャッシュキーにホスト名が入らないため、画像以外の経路を持つ既定のエクスポートのキャッシュを有効にすると、Webhookなどの応答と画像の応答が同じ仕組みの上に乗る。関門を分ければ、キャッシュの対象を画像の応答に限れる。
- **Trade-offs**: キャッシュにヒットしても関門は毎回動く(Workerの要求として課金される)。関門は軽い処理だけにする。

### Decision: キャッシュは版ごとのまま(`cross_version_cache`を使わない)

- **Context**: 申し送り(キャッシュキーにWorkerの版が入る)。
- **Alternatives Considered**: 版をまたいで共有する — デプロイ後の変換の再実行を省けるが、配信の不具合を直したデプロイの後も古い応答が最長14日残り、全体のパージの手順が要る。
- **Selected Approach**: 既定のまま版ごとにする。変換は一意な変換ごとに月1回の課金のため、同じ月の再変換は費用が増えない。prodのデプロイはリリース単位で少ない。

### Decision: 隔離・復元は「目的の保存先へそろえる」非同期の処理にする

- **Context**: 要件9・11.4。バケット間の移動はコピーと削除で原子的でなく、パージはイベントサーバーのエントリポイントでしか実行できない。
- **Selected Approach**:
  - 隔離理由の追加・解除はデータベースだけを同期で更新し、`media.relocate-files`(ファイルの識別子を最大25件)を送る。
  - イベントサーバーの`FileRelocator`は、隔離理由から目的の保存先(理由があれば隔離バケット、無ければ画像用非公開バケット)を求め、実際の保存先と違えば「目的の保存先へ書き込み(既にあれば省く)→元の保存先から削除→(画像用から出た場合)パージの依頼を送る→保存先の記録を更新」の順に進める。
  - パージの依頼を記録の更新より前に送ることで、依頼の送信に失敗して再試行しても、元の保存先に画像が無い状態から同じ手順をやり直せる。
  - 自動判定の処理は、判定の後に同じ`FileRelocator`を直接呼ぶ。
  - 日次バッチは、隔離理由と保存先の記録が食い違うファイルを探して依頼し直す。
- **Trade-offs**: 隔離理由の記録から配信の停止まで、Queueの処理の分(通常数秒)だけ遅れる。

### Decision: 判定の冪等性は、状態の条件付きの更新と隔離理由の追加を1つの一括実行にまとめる

- **Context**: 要件8.6・8.7。Queuesは少なくとも1回の配送で、重複があり得る。
- **Selected Approach**: 判定の状態が「判定待ち」「未判定」のときだけ判定する。結果は「状態の更新(条件付き)」と「自動判定の隔離理由の追加(状態が判定待ち・未判定の場合だけ)」を`db.batch()`で1つにまとめて書く。判定済みの画像への依頼は、判定せずに保存先をそろえるだけにする。管理者が自動判定の理由を外した画像は「隔離された」状態のまま理由が無いため、重複の依頼で再び隔離されない。

### Decision: 画像判定専用のQueueを設けない

- **Context**: 申し送り(画像処理の同時実行を抑える手段の要否)。
- **Alternatives Considered**:
  1. 専用のQueueと`max_concurrency`・`max_batch_size: 1` — 同時実行とCPU時間を確実に抑えられるが、backend-platformの受信部(本体・デッドレターの2つのQueue名だけを振り分ける)の拡張と、infra-deliveryの資源の追加が要る。
  2. 共通の`JOBS_QUEUE`で処理する — 受信部はバッチ内のメッセージを1件ずつ処理し、wasmの処理は1回の呼び出しの中で同期的に進むため、同じisolateで並行に呼ばれても復号の作業領域は重ならない。
- **Selected Approach**: 2。判定の処理時間とメモリはstagingで実測し、1バッチ(最大10件)のCPU時間が既定の上限(30秒)に近い場合は、eventの`limits.cpu_ms`の引き上げ、または1の専用Queueへの切り替えを開発者に確認する。
- **Follow-up**: 実測の手順を技術ドキュメントに書き、stagingの確認で記録する。

### Decision: 判定用の画像の作り方

- **Context**: 要件6.2〜6.4、Rekognitionの入力の制約。
- **Selected Approach**: 原本の形式・寸法・大きさから3つの方法を選ぶ。
  1. JPEG・PNGで、長辺640px以下・短辺80px以上・5MB以下なら原本をそのまま送る。
  2. 縮小または形式の変換だけで済むなら、`optimizeImage()`で長辺を640px以下に縮小し、JPEG原本はJPEG、それ以外はPNGで出力する。
  3. 縮小後にいずれかの辺が80px未満なら、`raw`で縮小した画素に白い余白を足して80px以上にし、自前の部品でPNGに符号化する。
- **Rationale**: FR-FILEU-013の「JPEG・PNG以外はPNGへ変換、長辺640pxへ縮小」を字義どおり保ち、下限は余白で満たす(申し送り)。

### Decision: 判定できない場合は最後の試行で未判定にし、デッドレターへ送らない

- **Context**: 要件8.1〜8.3、backend-platformのQ7(デッドレターは通知して破棄)。
- **Selected Approach**: 判定の再試行の方針を最大5回・60秒起点・上限1,800秒(60・120・240・480秒、合計約15分)に上書きする。一時的な失敗のとき、試行回数が上限に達していれば未判定を記録してSentryへ警告を送り、メッセージを完了にする。上限未満なら例外で再試行させる。日次バッチが未判定と1時間以上判定待ちの画像の判定を依頼し直す。
- **Rationale**: デッドレターへ移ると本文が捨てられ、判定の依頼が失われる。状態をデータベースに残せば日次バッチで回復できる。

### Decision: 非公開ファイルの認可と、管理者の画像の確認

- **Context**: 要件12、FR-ADMUG-018。
- **Selected Approach**: ファイル用の用途は、用途ごとに登録された`FileReadPolicy`で判定し、登録が無ければアップロードした主体だけを許す。画像用の用途のファイル(隔離中を含む)は、管理者側からの要求に限り`AdminMediaReviewPolicy`で判定する(既定は全拒否で、ugc-moderationが管理者の権限に基づく実装へ差し替える)。利用者側からの画像の要求は常に404とする(利用者は画像配信の経路を使う)。拒否と不存在は区別せず404にする。

### Decision: 動作確認の経路をイベントサーバーにトークン付きで置く

- **Context**: 要件11.6・17.2・17.3、申し送り(Images Bindingの`fit`・`quality`・メタデータ、Rekognitionの疎通をstagingで確かめる手順)。本specの時点ではログインが無く(identity-authは並行で作成中)、通常の経路ではアップロードできない。
- **Selected Approach**: email-deliveryの疎通確認の経路と同じく、シークレット`MEDIA_SMOKE_TOKEN`がある環境だけで有効になる経路をイベントサーバーに置く(画像のアップロード・状態の取得・隔離・削除)。トークンはSHA-256の値を時間一定で比較する。アップロードは固定の用途`media-smoke`と保有者「システム」で同じ受付処理を通し、紐付けないため48時間以内に自動で消える。prodにはトークンを登録しない。
- **Trade-offs**: 本物のログインを伴うE2Eは、最初にアップロードを使うドメインspecへ委ねる。

### Decision: GraphQLの共通の型を本specが定める

- **Context**: 下流の各ドメインspecが、画像と添付をGraphQLで返す。型がspecごとにばらつくと、画像の表示部品を共有できない。
- **Selected Approach**: スキーマモジュール`media`に、`MediaImage`(識別子・オブジェクトキー(隔離中・削除待ちはnull)・フォールバックの形式・幅・高さ)と`MediaAttachment`(識別子・元のファイル名・MIMEタイプ・バイト数・ダウンロードのパス)の型と、`MediaFileView`から値を作る変換関数・DataLoaderを置く。クエリは持たない。

### Generalization・Build vs Adopt・Simplification

- **Generalization**:
  - 隔離・復元・削除後のパージ・日次の食い違いの修復を、「目的の保存先へそろえる」1つの処理で表す。
  - 未使用・論理削除の期限切れ・削除待ちの3種の物理削除を、1つの`MediaEraser`で行う。
- **Build vs Adopt**:
  - 採用: Images Binding・Workers Cache・R2の条件付き書き込み(プラットフォーム機能)、`image-size`(寸法)、`fast-xml-parser`(SVGの構文と構造)、`wasm-image-optimization`(判定用画像)、`aws4fetch`(SigV4)、`react-easy-crop`(切り取りのUI)。
  - 自作: マジックバイトの表(5形式とPDFで数行、Q6)、SVGの許可リスト(製品ごとに要る値の表)、元のファイル名の整形と`Content-Disposition`の組み立て(RFC 6266・5987の小さな関数)、余白付きの判定用画像のPNG符号化(`CompressionStream`で数十行。新規パッケージを避ける)。
  - 不採用: `file-type`(決定Q6)、DOMPurifyなどによるSVGの書き換え(原本を変えない方針。判定と隔離で扱う)。
- **Simplification**:
  - 画像判定専用のQueue・画像処理専用のWorkerを作らない。
  - 画像配信はデータベースを参照しない(バケットの有無だけで判定する)。
  - アップロードの進捗表示(XHR)は作らない。送信中の状態だけを表示する。
  - 版をまたぐキャッシュ、論理削除の取り消しの操作は作らない(必要になったspecが追加する)。

## 要件定義書の改訂が必要な箇所

**2026-10-25に要件定義書(`docs/requirements/README.md`)へ適用済み。** 以下は適用前に記録した改訂の内容である。

| 要件ID       | 現在の文言の要点                                                    | 本specの決定                                                                                                                 |
| ------------ | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| FR-FILEU-017 | 配信時に`metadata: "none"`指定によりExif情報を除去する              | 決定Q1。配信時のJPEGのメタデータの除去は要件から外し、変換基盤の既定に任せる。WebP・AVIF・PNGへの変換では常に除かれる        |
| DR-009       | SW-012の配信経路における画像の配信時にExif情報を除去する            | 決定Q1・Q2。通常の経路(編集ダイアログ)ではアップロード前にブラウザが作り直してメタデータを除く。直接送られたJPEGでは残り得る |
| FR-FILEU-003 | 非SVG画像のアップロード時に編集ダイアログでリサイズ・切り取りできる | 決定Q6の前提。問い合わせの添付(ファイル用の用途)は画像形式でも編集ダイアログを出さない                                       |

## Risks & Mitigations

- 直接送られたJPEGのメタデータ(決定Q1の残存リスク) — 編集ダイアログを経ない送信(開発者ツールや自作のクライアント)では、撮影位置などのExifを含むJPEGが画像用非公開バケットに保存され、配信の`jpg`出力にも残り得る。WebP・AVIF・PNGの出力には残らず、`<picture>`は対応ブラウザでAVIF・WebPを選ぶため、`jpg`を受け取るのは非対応のブラウザに限られる。プライバシーポリシーの大枠に、編集ダイアログを経ない画像にメタデータが残り得ることを記載する。要件定義書の改訂(FR-FILEU-017・DR-009)を報告する。
- 判定用画像の作成のメモリとCPU — 画素数の上限(初期値1,600万画素)と1件ずつの処理で抑える。stagingで最大の画像を判定させ、Workers Logsのメモリ・CPU時間を記録する。超える場合は上限を下げるか、専用Queue・`limits.cpu_ms`を開発者に確認する。
- Workers統合テストでwasm・Images Binding・Workers Cacheが本番と同じに動かない — 描画・変換・パージを注入できる部品にし、統合テストでは確かめられる範囲(簡易版のImages Binding、`ctx.cache`の不在)を確かめる。`fit`・`quality`・メタデータ・キャッシュのヒットとパージはstagingの動作確認の手順で確かめる。
- パージの回数の上限(毎分5回・バースト25、stagingとprodで共有) — 1回に最大100件のキーをまとめ、拒否は間隔を伸ばして再試行し、上限を超えたらデッドレターとSentryで検知する。
- 中継が応答のヘッダー(`Content-Disposition`など)を落とす — frontend-platformの`toBrowserResponse`は指示の項目と`Set-Cookie`だけを除く設計である。ダウンロードの中継で`Content-Type`・`Content-Disposition`・`Content-Length`が届くことを単体テストで確かめ、届かない場合は互換を保って修正する(Revalidation Triggers)。
- `apps/common-lib`の新設がcontent-processingの実装に依存する(仮2) — roadmapの順をcontent-processing→media-pipelineとし(C-1)、前提にするcontent-processingの最小の区切り(1.1・1.2・4.1・4.2・6.1、11.3のうち`coding/003`への`server/**`の許可の記述、11.4のうち日次タイムラインの表の作成。N-3)を明記した。本specの実装の最初のタスクで前提を確かめ、未完了なら止めて報告する。日次タイムラインの表が無いことだけは止める理由にせず、タスク9.2で作る。
- 停止中の利用者の既存のセッションからのアップロード(N-7) — 停止では既存のセッションが消えない。利用者のアップロードは受付の前に`UploaderEligibility`で判定し、identity-authの束縛で拒否する。既定の全許可の間は、ログインが成立しないため停止中の利用者がアップロードできる経路は無い。ログイン・停止・束縛はどれもidentity-authが実装するため、束縛の作業は本specのタスク5.1・5.6への依存として、identity-authのタスク8.5に明記されている。
- 国外移転の根拠の変化(N-1) — EU-USデータプライバシーフレームワークが無効になった場合は、AWSのデータ処理補遺に含まれる標準契約条項に拠ることを骨子に書いておく。無効化の際は、開発者がプライバシーポリシーの本文を改訂する。
- SVGの許可リストの漏れ・過剰 — Inkscape・Illustrator・Figmaの書き出しの標本と、既知の攻撃の標本で単体テストを持つ。すり抜けてもFR-FILEU-018のCSP(`sandbox`・`default-src 'none'`)が実行と外部の読み込みを防ぐ。
- 判定サービスの資格情報の漏えい — `rekognition:DetectModerationLabels`だけを許す専用のIAMユーザーにし、ログ・Sentryに出さない。漏えい時はアクセスキーを無効化して作り直す手順を技術ドキュメントに書く。
- 画像変換の無料枠の超過 — 月5,000件の一意な変換を超えるとImages Paidが要る。費用の判断をlaunch-readinessへ回す。

## References

- [Images binding](https://developers.cloudflare.com/images/optimization/binding/) — `.input()`・`.transform()`・`.output()`・`.response()`と課金
- [Images features](https://developers.cloudflare.com/images/optimization/features/) — `metadata`・`anim`・`fit`
- [Workers Cache](https://developers.cloudflare.com/workers/cache/) — エントリポイント単位の有効化・キャッシュキー・パージの範囲
- [Purge and invalidate the cache](https://developers.cloudflare.com/workers/cache/purge/) — `pathPrefixes`と回数の上限
- [R2 Workers API reference](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/) — 条件付きの`put()`と`delete()`の上限
- [R2 Consistency](https://developers.cloudflare.com/r2/reference/consistency/) — 条件付き書き込みの原子性
- [R2 Data location](https://developers.cloudflare.com/r2/reference/data-location/) — 管轄とバインディングの`jurisdiction`
- [Context(ctx.exports)](https://developers.cloudflare.com/workers/runtime-apis/context/) — ループバックのService Binding
- [DetectModerationLabels](https://docs.aws.amazon.com/rekognition/latest/APIReference/API_DetectModerationLabels.html) — 要求・応答・エラー
- [画像バリアント仕様](../../../docs/GUIDES/service/features/002-image-variants.md) — バリアント・URL・キャッシュとパージ

## user-profile-socialの依頼による承認後の改訂(改訂1、2026-10-24)

- **状態**: 要件・設計・タスクの承認の後の改訂で、2026-10-24に開発者が確定したuser-profile-social仮1による。本specの生成中の仮決定(仮1〜仮3)とは別の項目で、`requirements.md`の「承認後の改訂」の表に改訂1として記録した。開発者の判断を待つ論点は残っていない。`spec.json`のタスクの承認は変更部分のタスクのレビューの結果を表す。
- **Context**: user-profile-socialの仮1(2026-10-24に開発者がCに確定)により、apiの4:21のジョブ`user-profile-social.orphaned-file-sweep`(`order` 600)が、保有者の利用者が存在しないファイルを物理削除する。`media_files`の保有者は利用者のテーブルへの外部キーを持たないため、退会の波及処理の導入より前に物理削除された利用者のファイルなどは、保有者の識別子が分からないと見つけられない。user-profile-socialのdesign.mdが、そのための`MediaFiles`への操作の追加を本specへ依頼していた。
- **改訂の内容**: `MediaFiles`に`listOwnerIds(input: { readonly kind: UploaderKind; readonly after: string | undefined; readonly limit: number }): Promise<{ readonly ownerIds: readonly string[]; readonly next: string | undefined }>`を加える。`owner_kind`が`kind`の`media_files`の`owner_id`を重複を除いて昇順に最大`limit`(1〜500。`OWNER_ID_LIST_MAX_LIMIT`)件返し、`after`はその値を含まない続きの位置とし、続きがあれば`ownerIds`の最後の識別子を`next`に入れる。ファイルの状態(保存の完了・紐付け・論理削除・削除待ち・隔離中)と用途によらず列挙し、索引`(owner_kind, owner_id)`を使う。範囲外の`limit`は`AppError(bad_request)`にする。リポジトリには`findOwnerIds`を加え、`limit`+1件まで読んで続きの有無を決める。user-profile-socialのdesign.mdの依頼の型と規則に一致させた。
- **Alternatives Considered**:
  1. 保有者の識別子を重複無しで列挙する読み取りの操作を加える(採用。削除の判断はuser-profile-socialに残り、本specは利用者のテーブルを参照しない)
  2. 保有者の識別子と存在を確かめる関数を受け取り、本specが削除まで行う操作(存在の判定という業務の知識が本specへ入り、1回の上限件数と失敗の扱いが2つのspecにまたがる)
  3. 利用者のテーブルとの結合で保有者の居ないファイルを照会する(identity-authのテーブルに依存しないという本specの境界に反する)
- **Rationale**: 既存の索引`(owner_kind, owner_id)`で重複の除去と並べ替えができ、表の追加やマイグレーションが要らない。読み取りだけで状態を変えないため、冪等性と既存の保有者単位の操作(`eraseOwnedBy`)の規則を変えない。
- **要件**: ドメインspecへ提供する手段の追加で、既存の要件13(ファイルの削除とライフサイクル)の目的に当たるため、受け入れ基準13.10を加えた。
- **変えた箇所**: 要件の「承認後の改訂」の表・In scope・Adjacent expectations・13.10。設計のRevalidation Triggers・File Structure Planの`media-files-service.ts`の注記・追跡表(13.10)・コンポーネントの表(`MediaFile(型と隔離の規則)・MediaMessages`・`D1MediaFileStore・R2MediaObjectStore`・`MediaEraser・MediaFilesService・MediaQuarantineService`)・`MediaFile・MediaMessages・ports`の要件の欄(13.10)・`MediaFiles`の契約(`OWNER_ID_LIST_MAX_LIMIT`・`listOwnerIds`)と規則・`MediaFileStore`の`findOwnerIds`と照会の説明・`MediaFilesService`の責務・論理データモデルの保有者の注記・Testing StrategyのWorkers統合テスト。タスク3.5・4.1・4.4の詳細と要件(13.10を追加)。番号の変更と、新しいタスク・依存の変更は無い。
- **後続への影響**: user-profile-socialのタスク6.3(4:21のジョブ)は、本specのタスク4.4の完了まで保留される(user-profile-socialの設計のとおり)。
- **変更部分のタスクの検証**: kiro-spec-tasksのタスクのグラフのサニティレビューを、変更部分に絞って2回行った。どちらも新しいサブエージェントによる独立した確認(independent)である。
  - 1回目はNEEDS_FIXES(必須1件・軽微2件)だった。必須の指摘は、契約を置く`MediaFile・MediaMessages・ports`の要件の欄とコンポーネントの表の行に13.10が無く、13.10を対応付けたタスク3.5の境界と食い違ったこと(両方に13.10を加えた)。軽微の指摘(要件のIn scopeへの列挙の追加、`spec.json`の`updated_at`の更新)も直した。
  - 2回目はPASSだった。軽微の指摘2件(File Structure Planの`media-files-service.ts`の注記への列挙の追加、`system`の行の`owner_id`を「空」ではなく「NULL」と書くこと)に従って直した。タスクの承認(`approvals.tasks.approved: true`)を保った。

## 上流(api-gateway)の改訂3の反映(2026-10-27)

- api-gatewayの実装後の改訂3で、backend-platformの`AppErrorKind`に`payload_too_large`(413)と`unsupported_media_type`(415)が加わった。design.mdの「アップロード」の説明にあった「411・413・415は`AppError`の種類に無い」は事実と合わなくなったため、413・415は`AppError`で表せ、411だけが種類に無いと改めた。受付の経路が共通のエラー形式の組み立て部品で応答を作る設計は変えていない(413・415も同じ部品で作ってよい)。要件・タスクは変えていない。
- 同じ改訂3で、api-gatewayの内部RESTに共通の後処理が加わった。サブアプリが要求ごとに`SessionAccess`を作って`c.var.session`で経路へ渡し、経路の後(共通エラー・想定外の例外の応答を含む)に`Cache-Control: no-store`とセッションの指示を付ける。経路が付けた`Cache-Control`は`no-store`で上書きされる(開発者の決定)。design.mdの依存の一覧・内部RESTの前提・経路の説明・`session`の型の説明・ダウンロードの応答のヘッダーと、tasks.mdの5.3の応答の確認を、`c.var.session`と`no-store`に改めた。R2のオブジェクトのメタデータの`private, no-store`(要件の該当箇所)は応答ではないため変えていない。

## frontend-platformの確定した契約の反映(2026-10-28)

- **状態**: frontend-platformのタスク10.4として、frontend-platformが実装で確定した契約(frontend-platformのdesign.mdの「実装で確定した契約による発火と影響を受ける下流spec」の表と「決定事項」)に本specの設計とタスクを合わせた。2026-10-28に開発者が下流specの設計の改訂を決めた(frontend-platformの判断11)。受け入れ基準は変えていない。
- **中継の経路の形**: 中継の経路は`defineRelayRoute`で定義して凍結し、素のオブジェクトは各アプリの`composition.unit.test.ts`の検査を通らない契約になった。上流の5xxで`Content-Type`がJSONでない応答は、実行基盤が返した失敗とみなされて503`upstream_unavailable`に置き換わる(frontend-platformの要件2.10の例外)。`UPLOAD_RELAY_ROUTE`・`FILE_DOWNLOAD_RELAY_ROUTE`を`defineRelayRoute`で定義し、末尾`/*`の経路として`RELAY_ROUTES`の完全一致の経路の後に置き、ファイルを返す経路も5xxは共通のエラー形式(JSON)で返すことと、アップロードの部品が中継の503を再試行できる失敗として扱うことを書いた。
- **管理者側の画面**: 本specが管理者側のルートに加えるのは`routes/__root.tsx`の`ImagesOriginProvider`の配置と`relay-routes.ts`への経路の追加だけで、ルートに失敗の表示(`ErrorState`・`UnexpectedErrorView`)を置かないことを確かめ、Modified Filesに明記した。エラーの画面と`contactHref`の扱いはfrontend-platformのままである。一方、共通部品の`ImageUploadField`・`AttachmentUploadField`は管理者側(admin-foundationの管理者のプロフィール画像`admin-avatar`)にも置かれ、想定外の応答と`upload_purpose_not_found`で問い合わせを促す`UNEXPECTED_ERROR_MESSAGE`を出していた。管理者側では問い合わせを促さない契約(frontend-platformの判断9とその追加)に合わせ、2つの入力欄に必須の`contactAvailable: boolean`を加え、`useFileUpload`・`parseUploadResponse`へ渡し、想定外の応答の文言をfrontend-platformの`errorMessageOf(error, contactAvailable)`で選ぶ(真なら`UNEXPECTED_ERROR_MESSAGE`、偽なら`UNEXPECTED_ERROR_MESSAGE_WITHOUT_CONTACT`)。利用者側の画面は`CLIENT_PROFILE.contactAvailable`、管理者側の画面は`ADMIN_PROFILE.contactAvailable`を渡す。必須にしたのは、渡し忘れを型検査で見つけるためである。`account_unavailable`の文言は問い合わせを促すが、利用者側の呼び出しだけに返るため変えない。
- **変えた箇所**: design.mdのAllowed Dependencies・Existing Architecture Analysis・File Structure Planの注記・Modified Files(`__root.tsx`・`relay-routes.ts`)・MediaRelayRoutes・アップロードの部品群(2つの入力欄のprops・`useFileUpload`・`parseUploadResponse`・`contactAvailable`の規約)・エラーの表(`upload_purpose_not_found`・`account_unavailable`)・Testing Strategy(`utilities/media`の単体テスト・`ImageUploadField`のブラウザテスト)、tasks.mdの8.1・8.2・8.5。admin-foundationが`ADMIN_PROFILE.contactAvailable`を渡す記述は、admin-foundationの改訂で加える。
