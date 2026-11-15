export type LinkRelToken =
  'noopener' | 'noreferrer' | 'nofollow' | 'ugc' | 'sponsored';

export interface MarkdownRenderOptions {
  readonly siteOrigin: string;
  readonly externalLinkRel: readonly LinkRelToken[];
  readonly sameOriginLinkRel?: readonly LinkRelToken[];
  readonly idScope?: string;
}

type MarkdownOptionsField =
  'siteOrigin' | 'externalLinkRel' | 'sameOriginLinkRel' | 'idScope';

export class MarkdownOptionsError extends Error {
  override readonly name = 'MarkdownOptionsError';

  readonly field: MarkdownOptionsField;

  constructor(field: MarkdownOptionsField, message: string) {
    super(message);
    this.field = field;
  }
}

export const DEFAULT_ID_PREFIX = 'user-content-';

const LINK_REL_TOKENS: ReadonlySet<string> = new Set<LinkRelToken>([
  'noopener',
  'noreferrer',
  'nofollow',
  'ugc',
  'sponsored',
]);

const SITE_ORIGIN_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);

const ID_SCOPE_PATTERN = /^[a-z0-9]{1,32}$/u;

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

const assertSiteOrigin = (siteOrigin: string): void => {
  const url = parseUrl(siteOrigin);
  if (
    url === undefined ||
    !SITE_ORIGIN_PROTOCOLS.has(url.protocol) ||
    url.origin !== siteOrigin
  ) {
    throw new MarkdownOptionsError(
      'siteOrigin',
      `siteOriginはhttpかhttpsのオリジン(例: https://client.example)で指定してください: ${JSON.stringify(siteOrigin)}`,
    );
  }
};

const assertLinkRel = (
  field: 'externalLinkRel' | 'sameOriginLinkRel',
  tokens: readonly LinkRelToken[],
): void => {
  const invalid = tokens.find((token) => !LINK_REL_TOKENS.has(token));
  if (invalid !== undefined) {
    throw new MarkdownOptionsError(
      field,
      `${field}に許可していない値があります: ${JSON.stringify(invalid)}`,
    );
  }
  if (new Set(tokens).size !== tokens.length) {
    throw new MarkdownOptionsError(
      field,
      `${field}に重複した値があります: ${JSON.stringify(tokens)}`,
    );
  }
};

const assertIdScope = (idScope: string): void => {
  if (!ID_SCOPE_PATTERN.test(idScope)) {
    throw new MarkdownOptionsError(
      'idScope',
      `idScopeは1〜32文字の英小文字と数字で指定してください: ${JSON.stringify(idScope)}`,
    );
  }
};

export const validateRenderOptions = (options: MarkdownRenderOptions): void => {
  assertSiteOrigin(options.siteOrigin);
  assertLinkRel('externalLinkRel', options.externalLinkRel);
  if (options.sameOriginLinkRel !== undefined) {
    assertLinkRel('sameOriginLinkRel', options.sameOriginLinkRel);
  }
  if (options.idScope !== undefined) {
    assertIdScope(options.idScope);
  }
};

export const idPrefixFor = (idScope: string | undefined): string => {
  if (idScope === undefined) {
    return DEFAULT_ID_PREFIX;
  }
  assertIdScope(idScope);
  return `${DEFAULT_ID_PREFIX}${idScope}-`;
};
