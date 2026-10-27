export const NO_INDEX_ROBOTS_CONTENT = 'noindex, nofollow';

const TITLE_SEPARATOR = ' | ';

// 正規のURLを同じオリジンのパスに限るため、仮のオリジンを基準に解釈してオリジンが変わらないことを確かめる
const CANONICAL_RESOLUTION_BASE = 'https://canonical.invalid';

export interface PageHeadInput {
  readonly title: string;
  readonly siteName: string;
  readonly canonicalUrl?: string;
  readonly noIndex?: boolean;
}

export interface PageHead {
  readonly meta: readonly Readonly<Record<string, string>>[];
  readonly links: readonly Readonly<Record<string, string>>[];
}

const buildTitle = (title: string, siteName: string): string => {
  const pageName = title.trim();
  const site = siteName.trim();
  return pageName === '' ? site : `${pageName}${TITLE_SEPARATOR}${site}`;
};

// クエリとフラグメントを除いたパスだけを返す。外部のオリジンを指し得る値(絶対URL・プロトコル相対・バックスラッシュや制御文字で区切りを偽る値)は使わない
const toCanonicalHref = (canonicalUrl: string): string | undefined => {
  if (!canonicalUrl.startsWith('/')) {
    return undefined;
  }
  try {
    const resolved = new URL(canonicalUrl, CANONICAL_RESOLUTION_BASE);
    return resolved.origin === CANONICAL_RESOLUTION_BASE
      ? resolved.pathname
      : undefined;
  } catch {
    return undefined;
  }
};

export const buildPageHead = ({
  title,
  siteName,
  canonicalUrl,
  noIndex = false,
}: PageHeadInput): PageHead => {
  const meta = [
    Object.freeze({ title: buildTitle(title, siteName) }),
    ...(noIndex
      ? [Object.freeze({ name: 'robots', content: NO_INDEX_ROBOTS_CONTENT })]
      : []),
  ];
  const canonicalHref =
    canonicalUrl === undefined ? undefined : toCanonicalHref(canonicalUrl);
  const links =
    canonicalHref === undefined
      ? []
      : [Object.freeze({ rel: 'canonical', href: canonicalHref })];
  return Object.freeze({
    meta: Object.freeze(meta),
    links: Object.freeze(links),
  });
};
