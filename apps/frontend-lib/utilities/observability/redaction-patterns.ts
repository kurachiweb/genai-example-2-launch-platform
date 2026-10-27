import {
  CREDIT_CARD_NUMBER_PATTERN,
  EMAIL_ADDRESS_PATTERN,
  JWT_PATTERN,
  type RedactionPattern,
  type RedactionPatterns,
} from '@logtape/redaction';

export const REDACTED = '[REDACTED]';

// 公開APIのキー(lsk_と32バイトのbase64url)
const API_KEY_PATTERN: RedactionPattern = {
  pattern: /lsk_[A-Za-z0-9_-]{43}/gu,
  replacement: REDACTED,
};

// RFC 6750のb64tokenの文字の並び
const BEARER_TOKEN_PATTERN: RedactionPattern = {
  pattern: /\bBearer\s+[A-Za-z0-9._~+/-]+=*/giu,
  replacement: REDACTED,
};

const IPV4_OCTET = String.raw`(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)`;

// 4つ組の前後に数字や「.数字」が続くもの(5つ以上の組の一部)は対象にしない
const IPV4_PATTERN: RedactionPattern = {
  pattern: new RegExp(
    String.raw`(?<!\d|\d\.)(?:${IPV4_OCTET}\.){3}${IPV4_OCTET}(?!\.?\d)`,
    'gu',
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
    'gu',
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

// 配列の順に置き換えるため、キーの一部が他のパターンに先に当たって断片が残らないよう、公開APIのキーを先頭に置く
export const REDACTION_PATTERNS: RedactionPatterns = Object.freeze([
  API_KEY_PATTERN,
  BEARER_TOKEN_PATTERN,
  { pattern: JWT_PATTERN.pattern, replacement: REDACTED },
  { pattern: EMAIL_ADDRESS_PATTERN.pattern, replacement: REDACTED },
  CREDIT_CARD_PATTERN,
  IPV4_PATTERN,
  IPV6_PATTERN,
]);

// Sentryの正規化が循環参照に付ける印と同じ表記にする
const CIRCULAR_REFERENCE_MARKER = '[Circular ~]';

export const redactText = (text: string): string =>
  REDACTION_PATTERNS.reduce(
    (current, { pattern, replacement }) =>
      typeof replacement === 'string'
        ? current.replaceAll(pattern, replacement)
        : current.replaceAll(pattern, replacement),
    text,
  );

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

// 祖先にあるオブジェクトを印に置き換えて循環参照の再帰を打ち切る。兄弟の位置での共有は循環ではないため、たどり終えたら祖先から外す
const redactValue = (value: unknown, ancestors: WeakSet<object>): unknown => {
  if (typeof value === 'string') {
    return redactText(value);
  }
  if (!Array.isArray(value) && !isPlainObject(value)) {
    return value;
  }
  if (ancestors.has(value)) {
    return CIRCULAR_REFERENCE_MARKER;
  }
  ancestors.add(value);
  const redacted = Array.isArray(value)
    ? value.map((item: unknown) => redactValue(item, ancestors))
    : Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          redactValue(item, ancestors),
        ]),
      );
  ancestors.delete(value);
  return redacted;
};

export const redactDeep = <T>(value: T): T =>
  redactValue(value, new WeakSet()) as T;
