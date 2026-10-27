// 時差の無い文字列は実行環境のタイムゾーンで解釈され、サーバーとブラウザで時点が食い違うため、時差かZを持つISO形式だけを受け付ける
const ISO_DATE_TIME_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/u;

const INVALID_DATE_TIME_MESSAGE =
  '日時の値は、時差を含むISO形式の文字列か有効なDateである必要があります。';

export const toDateTimeValue = (value: string | Date): Date => {
  const date =
    typeof value === 'string'
      ? ISO_DATE_TIME_WITH_OFFSET.test(value)
        ? new Date(value)
        : null
      : value;
  if (date === null || Number.isNaN(date.getTime())) {
    throw new RangeError(INVALID_DATE_TIME_MESSAGE);
  }
  return date;
};
