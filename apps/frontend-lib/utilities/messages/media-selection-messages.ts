export const FILE_DROP_HINT = 'ここにドラッグ&ドロップしても選択できます。';

export const FILE_DROP_ACTIVE_HINT = 'ここでドロップすると選択できます。';

export const SELECTED_FILES_LABEL = '選択したファイル';

export const UNKNOWN_FILE_TYPE_LABEL = '不明な形式';

// サーバー側の描画とブラウザで同じ文言にするため、利用者のロケールによらず日本語の3桁区切りにする
const countFormat = new Intl.NumberFormat('ja-JP');

export const fileSelectionAnnouncement = (
  fileNames: readonly string[],
): string => {
  const [onlyName] = fileNames;
  if (onlyName === undefined) {
    return '';
  }
  if (fileNames.length === 1) {
    return `${onlyName}を選択しました。`;
  }
  return `${fileNames.join('、')}の${countFormat.format(fileNames.length)}件を選択しました。`;
};
