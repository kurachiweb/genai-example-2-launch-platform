// サーバー側の描画とブラウザで同じ文言にするため、利用者のロケールによらず日本語の3桁区切りにする
const countFormat = new Intl.NumberFormat('ja-JP');

export const formatCount = (count: number): string => countFormat.format(count);

export const lengthOverLimitAnnouncement = (max: number): string =>
  `文字数が上限の${formatCount(max)}文字を超えています。`;

export const LENGTH_WITHIN_LIMIT_ANNOUNCEMENT =
  '文字数が上限以内に戻りました。';
