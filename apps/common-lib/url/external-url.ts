import { trimWhiteSpace } from '../text/white-space.ts';

export const EXTERNAL_URL_MAX_LENGTH = 2048;

export type ExternalUrlCheck =
  'ok' | 'empty' | 'too-long' | 'not-absolute' | 'disallowed-scheme';

const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);

// ブラウザはhttps:a.exampleのように//の無い参照を、同じスキームのページでは相対URLとして解釈し、表示するホスト名とリンク先が食い違うため、スキームの直後に//が続くものだけを絶対URLとする
const HTTP_URL_WITH_AUTHORITY = /^https?:\/\//iu;

const HTTP_SCHEME = /^https?:/iu;

const ANY_SCHEME = /^[a-z][a-z0-9+.-]*:/iu;

// URLの解析は途中のタブ・改行を黙って除くため、解析の前に拒んで保存する値と解析した値を一致させる
const HAS_WHITE_SPACE_OR_CONTROL = /[\p{White_Space}\p{Cc}]/u;

const parseUrl = (value: string): URL | undefined => {
  try {
    return new URL(value);
  } catch (error: unknown) {
    if (error instanceof TypeError) {
      return undefined;
    }
    throw error;
  }
};

const checkScheme = (url: string): ExternalUrlCheck => {
  if (HTTP_SCHEME.test(url)) {
    return 'not-absolute';
  }
  return ANY_SCHEME.test(url) ? 'disallowed-scheme' : 'not-absolute';
};

export const checkExternalUrl = (value: string): ExternalUrlCheck => {
  const url = trimWhiteSpace(value);
  if (url.length === 0) {
    return 'empty';
  }
  if (url.length > EXTERNAL_URL_MAX_LENGTH) {
    return 'too-long';
  }
  if (!HTTP_URL_WITH_AUTHORITY.test(url)) {
    return checkScheme(url);
  }
  if (HAS_WHITE_SPACE_OR_CONTROL.test(url)) {
    return 'not-absolute';
  }
  const parsed = parseUrl(url);
  if (parsed === undefined) {
    return 'not-absolute';
  }
  return ALLOWED_PROTOCOLS.has(parsed.protocol) ? 'ok' : 'disallowed-scheme';
};

export const externalUrlHost = (value: string): string => {
  const url = trimWhiteSpace(value);
  if (checkExternalUrl(url) !== 'ok') {
    return '';
  }
  return parseUrl(url)?.hostname ?? '';
};
