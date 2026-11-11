import {
  CREDIT_CARD_NUMBER_PATTERN,
  DEFAULT_REDACT_FIELDS,
  EMAIL_ADDRESS_PATTERN,
  type FieldPatterns,
  JWT_PATTERN,
  type RedactionPattern,
  type RedactionPatterns,
} from '@logtape/redaction';

export const REDACTED = '[REDACTED]';

export const REDACTED_FIELD_PATTERNS: FieldPatterns = [
  ...DEFAULT_REDACT_FIELDS,
  /^ip$/i,
  /^ipAddress$/i,
  /^clientIp$/i,
  /^remoteIp$/i,
  /^email$/i,
  /^mail$/i,
  /cookie/i,
  /^authorization$/i,
  /^token$/i,
  /^turnstileToken$/i,
  /^pepper$/i,
  /^secret$/i,
];

// 公開APIのキー(public-apiのAPI_KEY_TOKEN_PATTERNと同じ、lsk_と32バイトのbase64url)
const API_KEY_PATTERN: RedactionPattern = {
  pattern: /lsk_[A-Za-z0-9_-]{43}/g,
  replacement: REDACTED,
};

// RFC 6750のb64tokenの文字の並び
const BEARER_TOKEN_PATTERN: RedactionPattern = {
  pattern: /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  replacement: REDACTED,
};

const IPV4_OCTET = String.raw`(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)`;

// 4つ組の前後に数字や「.数字」が続くもの(5つ以上の組の一部)は対象にしない
const IPV4_PATTERN: RedactionPattern = {
  pattern: new RegExp(
    String.raw`(?<!\d|\d\.)(?:${IPV4_OCTET}\.){3}${IPV4_OCTET}(?!\.?\d)`,
    'g',
  ),
  replacement: REDACTED,
};

const H = '[0-9A-Fa-f]{1,4}';

// 8組の完全な表記か「::」による省略を含む表記だけを対象にし、時刻(12:34:56)や名前空間の区切り(std::)に当たらないよう前後を英数字・コロンで挟まないものに限る
const IPV6_PATTERN: RedactionPattern = {
  pattern: new RegExp(
    String.raw`(?<![\w:.])(?:` +
      [
        `(?:${H}:){7}${H}`,
        `(?:${H}:){1,7}:`,
        `(?:${H}:){1,6}:${H}`,
        `(?:${H}:){1,5}(?::${H}){1,2}`,
        `(?:${H}:){1,4}(?::${H}){1,3}`,
        `(?:${H}:){1,3}(?::${H}){1,4}`,
        `(?:${H}:){1,2}(?::${H}){1,5}`,
        `${H}:(?::${H}){1,6}`,
        `:(?::${H}){1,7}`,
      ].join('|') +
      String.raw`)(?![\w:])`,
    'g',
  ),
  replacement: REDACTED,
};

const LIBRARY_CREDIT_CARD_NUMBER_REPLACEMENT = 'XXXX-XXXX-XXXX-XXXX';
const libraryCreditCardReplacement = CREDIT_CARD_NUMBER_PATTERN.replacement;

const UUID_PATTERN = /[0-9A-Fa-f]{8}(?:-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}/g;

const isInsideUuid = (text: string, start: number, end: number): boolean =>
  [...text.matchAll(UUID_PATTERN)].some(
    ({ index, 0: uuid }) => index <= start && end <= index + uuid.length,
  );

// String.prototype.replaceAllの置き換えの関数は、捕捉グループの後に一致の位置(数値)と対象の文字列を受け取る
const isMatchInsideUuid = (
  match: string,
  rest: readonly unknown[],
): boolean => {
  const offsetIndex = rest.findIndex((value) => typeof value === 'number');
  const offset = rest[offsetIndex];
  const text = rest[offsetIndex + 1];
  return (
    typeof offset === 'number' &&
    typeof text === 'string' &&
    isInsideUuid(text, offset, offset + match.length)
  );
};

// 既製のLuhnの検査は保ち、検査を通った部分の既製の置き換えの文字列だけを差し替える。ランダムなUUIDの区切りの数字の並びが検査を通ってIDが欠けないよう、UUIDの中に収まる一致は残す
const CREDIT_CARD_PATTERN: RedactionPattern = {
  pattern: CREDIT_CARD_NUMBER_PATTERN.pattern,
  replacement: (match: string, ...rest: readonly unknown[]) => {
    if (isMatchInsideUuid(match, rest)) {
      return match;
    }
    return (
      typeof libraryCreditCardReplacement === 'string'
        ? libraryCreditCardReplacement
        : libraryCreditCardReplacement(match, ...rest)
    ).replaceAll(LIBRARY_CREDIT_CARD_NUMBER_REPLACEMENT, REDACTED);
  },
};

const QUERY_FAILURE_PREFIX = 'Failed query: ';

// 値は改行を含み得て、どこまでが値か分からないため、区切りから末尾までを伏せる。
// 例外のstackを先に伏せた形(区切りの後が伏せ字とフレームの行だけ)は、フレームを残すためにそのままにする。
// 区切りまでの間に次のクエリの失敗の文言を含めないのは、区切りの無い文言が繰り返されたときに探す時間が長さの2乗で増えないためである
const QUERY_PARAMS_PATTERN: RedactionPattern = {
  pattern: new RegExp(
    String.raw`(${QUERY_FAILURE_PREFIX}(?:(?!${QUERY_FAILURE_PREFIX})[\s\S])*?\nparams: )(?!\[REDACTED\](?:\n[ \t]+at [^\n]*)*$)[\s\S]*`,
    'g',
  ),
  replacement: (_match: string, prefix: unknown) =>
    `${String(prefix)}${REDACTED}`,
};

// redactByPatternは配列の順に置き換える。クエリの失敗の値は、他のパターンが値の先頭を先に伏せると伏せ字済みの形に見えて残るため、最初に末尾まで伏せる。
// 次に、キーの一部が他のパターンに先に当たって形が崩れないよう、公開APIのキーを他のパターンより先に伏せる
export const REDACTION_PATTERNS: RedactionPatterns = Object.freeze([
  QUERY_PARAMS_PATTERN,
  API_KEY_PATTERN,
  BEARER_TOKEN_PATTERN,
  { pattern: JWT_PATTERN.pattern, replacement: REDACTED },
  { pattern: EMAIL_ADDRESS_PATTERN.pattern, replacement: REDACTED },
  CREDIT_CARD_PATTERN,
  IPV4_PATTERN,
  IPV6_PATTERN,
]);

const QUERY_PARAMS_SEPARATOR = '\nparams: ';

// SQL文は値をプレースホルダーで持つため残し、利用者の入力を含み得るバインドした値だけを伏せる
export function redactQueryParams(message: string): string {
  if (!message.startsWith(QUERY_FAILURE_PREFIX)) {
    return message;
  }
  const separatorIndex = message.indexOf(QUERY_PARAMS_SEPARATOR);
  return separatorIndex === -1
    ? message
    : `${message.slice(0, separatorIndex)}${QUERY_PARAMS_SEPARATOR}${REDACTED}`;
}
