export const EDIT_STATUS_SECTION_HEADING = 'ローンチの状態';

export const DANGER_SECTION_HEADING = '危険な操作';

export const DELETE_PRODUCT_LABEL = 'プロダクトを削除';

export const RELOAD_LATEST_LABEL = '最新の内容を読み込む';

export const HIDDEN_PRODUCT_NOTICE = Object.freeze({
  before: 'このプロダクトは公開が停止されています。内容を直したら、',
  link: 'お問い合わせ',
  after: 'から確認を依頼してください。',
});

// 固定の判定に失敗した間は、ローンチ日・カテゴリの変更と削除をサーバーが受け付けないため、無効にした欄とボタンの理由に時間をおいて試す旨を示す
export const LOCK_UNKNOWN_REASON =
  'ローンチの状態を確認できませんでした。時間をおいて再度お試しください。';

export const PRODUCT_SAVED_MESSAGE = '変更を保存しました。';

export const NEXT_LAUNCH_RESERVED_MESSAGE = '次回のローンチを予約しました。';

export const deleteConfirmTitleOf = (name: string): string =>
  `プロダクト『${name}』を削除しますか?`;

export const DELETE_CONFIRM_DESCRIPTION =
  'ローンチ予定と過去のローンチの記録が削除され、元に戻せません。';

export const DELETE_CANCEL_LABEL = 'キャンセル';

export const DELETE_CONFIRM_LABEL = '削除';

export const PRODUCT_DELETED_MESSAGE = 'プロダクトを削除しました。';
