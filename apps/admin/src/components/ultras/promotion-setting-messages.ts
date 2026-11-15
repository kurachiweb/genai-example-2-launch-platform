export const PROMOTION_SETTING_TITLE = 'Ultras導線の機能フラグ';

export const PROMOTION_SETTING_DESCRIPTION =
  'オフにすると未加入者への導線と新規加入を止めます。加入中の利用者には影響しません。';

export const PROMOTION_SWITCH_LABEL = '未加入者への導線と新規加入';

export const PROMOTION_UPDATED_AT_LABEL = '最後に変更した日時';

export const PROMOTION_UPDATED_BY_LABEL = '変更した管理者';

export const PROMOTION_NONE_LABEL = 'なし';

export const PROMOTION_READ_ONLY_NOTICE = '最上位管理者だけが変更できます。';

export const PROMOTION_VERSION_CONFLICT_MESSAGE =
  '他の管理者が設定を変更しました。最新の内容を読み込んでから操作してください。';

const ENABLE_DESCRIPTION = '未加入者への導線と新規加入を始めます。';

const DISABLE_DESCRIPTION =
  '未加入者への導線と新規加入を止めます。加入中の利用者には影響しません。';

export const promotionStateLabelOf = (enabled: boolean): string =>
  enabled ? 'オン' : 'オフ';

export const promotionConfirmTitleOf = (enabled: boolean): string =>
  `${PROMOTION_SETTING_TITLE}を${promotionStateLabelOf(enabled)}にしますか?`;

export const promotionConfirmDescriptionOf = (enabled: boolean): string =>
  enabled ? ENABLE_DESCRIPTION : DISABLE_DESCRIPTION;

export const promotionConfirmLabelOf = (enabled: boolean): string =>
  `${promotionStateLabelOf(enabled)}にする`;

export const promotionChangedMessageOf = (enabled: boolean): string =>
  `${PROMOTION_SETTING_TITLE}を${promotionStateLabelOf(enabled)}にしました。`;
