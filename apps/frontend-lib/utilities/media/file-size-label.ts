const KILOBYTE = 1024;

const MEGABYTE = KILOBYTE * KILOBYTE;

const FRACTION_SCALE = 10;

const sizeFormatter = new Intl.NumberFormat('ja-JP', {
  maximumFractionDigits: 1,
});

// 切り上げにより、上限を1バイトでも超えたサイズが上限と同じ表記になるのを防ぐ
const ceilToOneDecimal = (value: number): number =>
  Math.ceil(value * FRACTION_SCALE) / FRACTION_SCALE;

// 文言規則の容量の単位に従い、1,024を基数とするkB・MBで書く
export const formatFileSize = (bytes: number): string => {
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new RangeError('バイト数は0以上の整数で指定してください。');
  }
  const kilobytes = ceilToOneDecimal(bytes / KILOBYTE);
  if (kilobytes < KILOBYTE) {
    return `${sizeFormatter.format(kilobytes)}kB`;
  }
  return `${sizeFormatter.format(ceilToOneDecimal(bytes / MEGABYTE))}MB`;
};
