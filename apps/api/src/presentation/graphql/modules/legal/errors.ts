// 入力の検証の失敗(validation_error)の欄ごとの文言。本文と変更概要の文言は共有の入力規則、ユースケースが投げるエラーの文言はapplication層のlegal-document-errors.tsにある
export const INPUT_MESSAGES = Object.freeze({
  versionNumberTooSmall: '版番号は1以上の整数で指定してください。',
});
