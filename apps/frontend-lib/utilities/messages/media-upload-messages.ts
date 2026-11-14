export const UPLOAD_RETRY_LABEL = '再試行';

export const UPLOAD_STATUS_WAITING = '送信待ち';

export const UPLOAD_STATUS_SENDING = '送信中';

export const UPLOAD_STATUS_UPLOADED = 'アップロード済み';

// サーバー側の描画とブラウザで同じ文言にするため、利用者のロケールによらず日本語の3桁区切りにする
const countFormat = new Intl.NumberFormat('ja-JP');

export const uploadingAnnouncement = (fileName: string): string =>
  `${fileName}を送信しています。`;

export const uploadedAnnouncement = (fileNames: readonly string[]): string => {
  const [onlyName] = fileNames;
  if (onlyName === undefined) {
    return '';
  }
  if (fileNames.length === 1) {
    return `${onlyName}をアップロードしました。`;
  }
  return `${fileNames.join('、')}の${countFormat.format(fileNames.length)}件をアップロードしました。`;
};

export const uploadPendingSubmitMessage = (subjectLabel: string): string =>
  `${subjectLabel}のアップロードが終わってから、もう一度お試しください。`;
