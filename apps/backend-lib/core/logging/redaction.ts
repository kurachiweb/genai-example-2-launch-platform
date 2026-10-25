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

// 既製のLuhnの検査は保ち、検査を通った部分の既製の置き換えの文字列だけを差し替える
const CREDIT_CARD_PATTERN: RedactionPattern = {
  pattern: CREDIT_CARD_NUMBER_PATTERN.pattern,
  replacement: (match: string, ...rest: readonly unknown[]) =>
    (typeof libraryCreditCardReplacement === 'string'
      ? libraryCreditCardReplacement
      : libraryCreditCardReplacement(match, ...rest)
    ).replaceAll(LIBRARY_CREDIT_CARD_NUMBER_REPLACEMENT, REDACTED),
};

// redactByPatternは配列の順に置き換えるため、キーの一部が他のパターンに先に当たって形が崩れないよう、公開APIのキーを先頭に置く
export const REDACTION_PATTERNS: RedactionPatterns = Object.freeze([
  API_KEY_PATTERN,
  BEARER_TOKEN_PATTERN,
  { pattern: JWT_PATTERN.pattern, replacement: REDACTED },
  { pattern: EMAIL_ADDRESS_PATTERN.pattern, replacement: REDACTED },
  CREDIT_CARD_PATTERN,
  IPV4_PATTERN,
  IPV6_PATTERN,
]);
