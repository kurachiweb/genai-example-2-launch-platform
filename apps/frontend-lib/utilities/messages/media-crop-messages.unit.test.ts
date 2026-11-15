import { describe, expect, test } from 'bun:test';

import {
  IMAGE_CROP_AREA_KEYBOARD_HINT,
  IMAGE_CROP_AREA_LABEL,
  IMAGE_CROP_CANCEL_LABEL,
  IMAGE_CROP_CONFIRM_LABEL,
  IMAGE_CROP_CONFIRMING_LABEL,
  IMAGE_CROP_DIALOG_TITLE,
  IMAGE_CROP_ENCODE_FAILED_MESSAGE,
  IMAGE_CROP_LOADING_MESSAGE,
  IMAGE_CROP_MOVE_DOWN_LABEL,
  IMAGE_CROP_MOVE_GROUP_LABEL,
  IMAGE_CROP_MOVE_LEFT_LABEL,
  IMAGE_CROP_MOVE_RIGHT_LABEL,
  IMAGE_CROP_MOVE_UP_LABEL,
  IMAGE_CROP_UNREADABLE_MESSAGE,
  IMAGE_CROP_ZOOM_IN_LABEL,
  IMAGE_CROP_ZOOM_LABEL,
  IMAGE_CROP_ZOOM_OUT_LABEL,
  imageCropDescription,
  imageCropZoomValueText,
} from './media-crop-messages.ts';

describe('画像の編集ダイアログの文言', () => {
  test('題名・名前・操作は体言止めにし、末尾に「。」を付けない', () => {
    expect(IMAGE_CROP_DIALOG_TITLE).toBe('画像の編集');
    expect(IMAGE_CROP_AREA_LABEL).toBe('切り取る範囲');
    expect(IMAGE_CROP_LOADING_MESSAGE).toBe('画像を読み込んでいます');
    expect(IMAGE_CROP_ZOOM_LABEL).toBe('拡大率');
    expect(IMAGE_CROP_ZOOM_OUT_LABEL).toBe('縮小');
    expect(IMAGE_CROP_ZOOM_IN_LABEL).toBe('拡大');
    expect(IMAGE_CROP_MOVE_GROUP_LABEL).toBe('画像の位置');
    expect([
      IMAGE_CROP_MOVE_UP_LABEL,
      IMAGE_CROP_MOVE_DOWN_LABEL,
      IMAGE_CROP_MOVE_LEFT_LABEL,
      IMAGE_CROP_MOVE_RIGHT_LABEL,
    ]).toStrictEqual(['上へ移動', '下へ移動', '左へ移動', '右へ移動']);
    expect(IMAGE_CROP_CONFIRM_LABEL).toBe('確定');
    expect(IMAGE_CROP_CONFIRMING_LABEL).toBe('処理中');
    expect(IMAGE_CROP_CANCEL_LABEL).toBe('キャンセル');
  });

  test('説明・案内・エラーは文末に「。」を付ける', () => {
    expect(IMAGE_CROP_AREA_KEYBOARD_HINT).toBe(
      '矢印キーで画像を動かします。Shiftキーを押しながら操作すると細かく動かします。',
    );
    expect(IMAGE_CROP_UNREADABLE_MESSAGE).toBe(
      '画像を読み込めませんでした。画像が壊れていないか確認して、別の画像を選択してください。',
    );
    expect(IMAGE_CROP_ENCODE_FAILED_MESSAGE).toBe(
      '編集した画像を作成できませんでした。もう一度お試しください。',
    );
    expect(imageCropDescription('photo.jpg')).toBe(
      'photo.jpgの切り取る範囲を、位置と拡大率で調整してください。',
    );
  });

  test('拡大率は四捨五入した百分率で伝える', () => {
    expect(imageCropZoomValueText(1)).toBe('100%');
    expect(imageCropZoomValueText(1.256)).toBe('126%');
    expect(imageCropZoomValueText(3)).toBe('300%');
  });
});
