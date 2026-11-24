export const API_DOCS_PAGE_TITLE = 'APIドキュメント';

export const API_KEY_SETTINGS_HREF = '/settings/api-keys';

// 回数は公開APIの回数の制限と同じ値を示す。制限を変えた時は合わせて直す
export const API_DOCS_MESSAGES = Object.freeze({
  intro:
    '公開APIを使うと、プロダクト・ローンチ履歴・Upvote・コメント・評価・公開プロフィールなどの公開データを読み取り、自分のプロフィールとプロダクトの説明文を更新できます。',
  apiKeyHeading: 'APIキー',
  apiKeyDescription:
    'APIキーは設定のAPIキーのページで発行できます。発行の時に、機能ごとに使える操作を選びます。',
  apiKeySettingsLink: 'APIキーの設定を開く',
  authHeading: '認証',
  authBeforeHeaderName: '要求の',
  authHeaderName: 'Authorization',
  authBeforeScheme: 'ヘッダーに',
  authScheme: 'Bearer <APIキー>',
  authAfterScheme:
    'の形でAPIキーを付けてください。下のAPIリファレンスでは、APIキーを入力して経路を試せます。入力したAPIキーはブラウザに保存されません。',
  rateLimitHeading: 'レート制限',
  rateLimitDescription:
    'APIキーの持ち主ごとに、全てのAPIキーの要求を合わせて、読み取りは1分あたり30回、更新は1分あたり15回までです。加えて、IPアドレスごとに1分あたり60回までです。上限を超えた要求には429を返します。',
  referenceHeading: 'APIリファレンス',
  referenceLoadingLabel: 'APIドキュメントを読み込み中',
  serverSelectLabel: 'サーバー',
  closeDialogLabel: '閉じる',
  loadError:
    'APIドキュメントを読み込めませんでした。時間をおいて再度お試しください。解決しない場合はお問い合わせください。',
});
