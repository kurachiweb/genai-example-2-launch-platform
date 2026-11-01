export const IMAGE_CROP_DIALOG_TITLE = '画像の編集';

export const IMAGE_CROP_AREA_LABEL = '切り取る範囲';

export const IMAGE_CROP_AREA_KEYBOARD_HINT =
  '矢印キーで画像を動かします。Shiftキーを押しながら操作すると細かく動かします。';

export const IMAGE_CROP_LOADING_MESSAGE = '画像を読み込んでいます';

export const IMAGE_CROP_ZOOM_LABEL = '拡大率';

export const IMAGE_CROP_ZOOM_OUT_LABEL = '縮小';

export const IMAGE_CROP_ZOOM_IN_LABEL = '拡大';

export const IMAGE_CROP_MOVE_GROUP_LABEL = '画像の位置';

export const IMAGE_CROP_MOVE_UP_LABEL = '上へ移動';

export const IMAGE_CROP_MOVE_DOWN_LABEL = '下へ移動';

export const IMAGE_CROP_MOVE_LEFT_LABEL = '左へ移動';

export const IMAGE_CROP_MOVE_RIGHT_LABEL = '右へ移動';

export const IMAGE_CROP_CONFIRM_LABEL = '確定';

export const IMAGE_CROP_CONFIRMING_LABEL = '処理中';

export const IMAGE_CROP_CANCEL_LABEL = 'キャンセル';

export const IMAGE_CROP_UNREADABLE_MESSAGE =
  '画像を読み込めませんでした。画像が壊れていないか確認して、別の画像を選択してください。';

export const IMAGE_CROP_ENCODE_FAILED_MESSAGE =
  '編集した画像を作成できませんでした。もう一度お試しください。';

export const imageCropDescription = (fileName: string): string =>
  `${fileName}の切り取る範囲を、位置と拡大率で調整してください。`;

// 拡大率を支援技術へ倍率でなく百分率の文言で伝える
export const imageCropZoomValueText = (zoom: number): string =>
  `${String(Math.round(zoom * 100))}%`;
