// 画面は共通部品の固定の題名「現在ご利用いただけません。」に続けてこの文を示す
export const PAYMENTS_UNAVAILABLE_REASON =
  '決済サービスで障害が発生しています。閲覧やその他の操作は引き続きご利用いただけます。';

// APIのエラーの文言は題名を伴わずに単独で読まれるため、決済を利用できない旨を前に置く
export const PAYMENTS_UNAVAILABLE_MESSAGE = `現在、決済をご利用いただけません。${PAYMENTS_UNAVAILABLE_REASON}`;
