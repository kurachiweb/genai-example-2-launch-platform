export type SecurityHeaderTarget = 'page' | 'non-page' | 'static-file';

export interface HostedScriptTag {
  readonly source: string;
  readonly defer: boolean;
  readonly nonce: string | undefined;
}

export interface CspViolation {
  readonly effectiveDirective: string;
  readonly blockedURI: string;
  readonly sourceFile: string;
  readonly lineNumber: number;
  readonly sample: string;
}

// PlaywrightのPageのうち使う部分だけを、ページへ送る引数を文字列に絞った形で受ける
interface InitScriptTarget {
  addInitScript(script: (arg: string) => void, arg: string): Promise<unknown>;
}

interface EvaluationTarget {
  evaluate<R>(pageFunction: (arg: string) => R, arg: string): Promise<R>;
}

interface HeaderRule {
  readonly name: string;
  readonly displayName: string;
  readonly isValid: (value: string) => boolean;
}

type CspDirectives = ReadonlyMap<string, readonly string[]>;

const CSP_HEADER_NAME = 'content-security-policy';
const CSP_DISPLAY_NAME = 'Content-Security-Policy';

const directiveTokensOf = (value: string, separator: RegExp): string[] =>
  value
    .split(separator)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token !== '');

const CACHE_CONTROL_HEADER_NAME = 'cache-control';

const HEADER_RULES: readonly HeaderRule[] = [
  {
    name: 'strict-transport-security',
    displayName: 'Strict-Transport-Security',
    isValid: (value) =>
      directiveTokensOf(value, /;/u).some((token) =>
        /^max-age=[1-9]\d*$/u.test(token),
      ),
  },
  {
    name: 'x-content-type-options',
    displayName: 'X-Content-Type-Options',
    isValid: (value) => value.trim().toLowerCase() === 'nosniff',
  },
  {
    name: 'referrer-policy',
    displayName: 'Referrer-Policy',
    isValid: (value) => value.trim().toLowerCase() === 'same-origin',
  },
  {
    name: 'permissions-policy',
    displayName: 'Permissions-Policy',
    isValid: (value) => value.trim() !== '',
  },
  {
    name: CACHE_CONTROL_HEADER_NAME,
    displayName: 'Cache-Control',
    isValid: (value) => directiveTokensOf(value, /,/u).includes('no-store'),
  },
];

const FORBIDDEN_SCRIPT_SOURCES: readonly string[] = [
  "'unsafe-inline'",
  "'unsafe-eval'",
  "'strict-dynamic'",
];

const NONCE_SOURCE_PATTERN = /^'nonce-(?<value>[^']+)'$/u;

// 同じ指示子が重なった時はブラウザと同じく最初のものだけを有効とする
function parseCsp(csp: string): CspDirectives {
  const directives = new Map<string, readonly string[]>();
  for (const directive of csp.split(';')) {
    const [name, ...sources] = directive.trim().split(/\s+/u);
    if (name === undefined || name === '') {
      continue;
    }
    const lowerName = name.toLowerCase();
    if (!directives.has(lowerName)) {
      directives.set(lowerName, sources);
    }
  }
  return directives;
}

const nonceOfSources = (sources: readonly string[]): string | undefined =>
  sources
    .map((source) => NONCE_SOURCE_PATTERN.exec(source)?.groups?.value)
    .find((value) => value !== undefined);

function findCspProblems(
  csp: string,
  target: SecurityHeaderTarget,
): readonly string[] {
  const directives = parseCsp(csp);
  const frameAncestors = directives.get('frame-ancestors');
  const frameAncestorsProblems =
    frameAncestors?.length === 1 && frameAncestors[0] === "'none'"
      ? []
      : [`${CSP_DISPLAY_NAME}にframe-ancestors 'none'がありません`];
  if (target !== 'page') {
    return frameAncestorsProblems;
  }
  const scriptSources = directives.get('script-src') ?? [];
  const nonceProblems =
    nonceOfSources(scriptSources) === undefined
      ? [`${CSP_DISPLAY_NAME}のscript-srcにnonceがありません`]
      : [];
  const forbiddenProblems = FORBIDDEN_SCRIPT_SOURCES.filter((source) =>
    scriptSources.some((value) => value.toLowerCase() === source),
  ).map((source) => `${CSP_DISPLAY_NAME}のscript-srcに${source}があります`);
  return [...frameAncestorsProblems, ...nonceProblems, ...forbiddenProblems];
}

// 静的なファイルはWorkerを通らず配信され、ハッシュ付きの名前で長期にキャッシュさせるため、no-storeを求めない
const headerRulesFor = (target: SecurityHeaderTarget): readonly HeaderRule[] =>
  target === 'static-file'
    ? HEADER_RULES.filter(({ name }) => name !== CACHE_CONTROL_HEADER_NAME)
    : HEADER_RULES;

// 全応答に共通のセキュリティヘッダーと、ページならnonce付きのCSPを確かめ、問題を人が読める文で返す
export function findSecurityHeaderProblems(
  headers: Readonly<Record<string, string>>,
  target: SecurityHeaderTarget,
): readonly string[] {
  const lowerCaseHeaders = new Map(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
  const headerProblems = headerRulesFor(target).flatMap(
    ({ name, displayName, isValid }) => {
      const value = lowerCaseHeaders.get(name);
      if (value === undefined) {
        return [`${displayName}がありません`];
      }
      return isValid(value) ? [] : [`${displayName}の値が不正です: ${value}`];
    },
  );
  const csp = lowerCaseHeaders.get(CSP_HEADER_NAME);
  const cspProblems =
    csp === undefined
      ? [`${CSP_DISPLAY_NAME}がありません`]
      : findCspProblems(csp, target);
  return [...headerProblems, ...cspProblems];
}

export function scriptNonceOf(csp: string): string | undefined {
  const scriptSources = parseCsp(csp).get('script-src');
  return scriptSources === undefined
    ? undefined
    : nonceOfSources(scriptSources);
}

interface HtmlTag {
  readonly name: string;
  readonly source: string;
  readonly attributes: ReadonlyMap<string, string>;
}

const TAG_PATTERN = /<(?<name>script|link)(?=[\s>/])(?<rest>[^>]*)>/giu;

const ATTRIBUTE_PATTERN =
  /(?<name>[^\s"'<>/=]+)(?:\s*=\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)'|(?<bare>[^\s"'=<>`]+)))?/gu;

function parseAttributes(rest: string): ReadonlyMap<string, string> {
  const attributes = new Map<string, string>();
  for (const match of rest.matchAll(ATTRIBUTE_PATTERN)) {
    const groups = match.groups ?? {};
    const name = (groups.name ?? '').toLowerCase();
    if (name !== '' && !attributes.has(name)) {
      attributes.set(name, groups.double ?? groups.single ?? groups.bare ?? '');
    }
  }
  return attributes;
}

// サーバーが返したHTMLの文字列から、script要素とlink要素の開始タグを文書の順に取り出す
function parseTags(html: string): readonly HtmlTag[] {
  return Array.from(html.matchAll(TAG_PATTERN), (match) => ({
    name: (match.groups?.name ?? '').toLowerCase(),
    source: match[0],
    attributes: parseAttributes(match.groups?.rest ?? ''),
  }));
}

const scriptTagsOf = (html: string): readonly HtmlTag[] =>
  parseTags(html).filter((tag) => tag.name === 'script');

const isModuleScript = (tag: HtmlTag): boolean =>
  tag.attributes.get('type')?.trim().toLowerCase() === 'module';

export function findScriptTagsWithoutNonce(
  html: string,
  nonce: string,
): readonly string[] {
  return scriptTagsOf(html)
    .filter((tag) => tag.attributes.get('nonce') !== nonce)
    .map((tag) => tag.source);
}

// モジュールのスクリプトは既定で遅延して実行されるため、asyncやdeferと同じく最初の描画を妨げないとみなす
export function findParserBlockingScriptTags(html: string): readonly string[] {
  return scriptTagsOf(html)
    .filter(
      (tag) =>
        tag.attributes.has('src') &&
        !tag.attributes.has('async') &&
        !tag.attributes.has('defer') &&
        !isModuleScript(tag),
    )
    .map((tag) => tag.source);
}

const isModulePreload = (tag: HtmlTag): boolean =>
  tag.name === 'link' &&
  directiveTokensOf(tag.attributes.get('rel') ?? '', /\s+/u).includes(
    'modulepreload',
  );

const scriptUrlOf = (tag: HtmlTag): string | undefined => {
  if (tag.name === 'script') {
    return tag.attributes.get('src');
  }
  return isModulePreload(tag) ? tag.attributes.get('href') : undefined;
};

// Viteの開発サーバーは`/@`で始まる経路でモジュールを要求のたびに変換して配信し、ビルドの成果物とも静的なファイルの配信とも異なる
const isDevServerModule = (url: URL): boolean => url.pathname.startsWith('/@');

// 最初の描画の時点で読み込まれる同じオリジンのビルドの成果物のスクリプト(script要素とmodulepreload)のURLを、重複を除いて返す
export function staticScriptUrlsOf(
  html: string,
  pageUrl: string,
): readonly string[] {
  const { origin } = new URL(pageUrl);
  const urls = parseTags(html)
    .map(scriptUrlOf)
    .filter((url): url is string => url !== undefined)
    .map((url) => new URL(url, pageUrl))
    .filter((url) => url.origin === origin && !isDevServerModule(url))
    .map((url) => url.href);
  return [...new Set(urls)];
}

const hostOf = (src: string): string | undefined => {
  try {
    return new URL(src).host;
  } catch {
    return undefined;
  }
};

export function scriptTagsFromHost(
  html: string,
  host: string,
): readonly HostedScriptTag[] {
  return scriptTagsOf(html)
    .filter((tag) => hostOf(tag.attributes.get('src') ?? '') === host)
    .map((tag) => ({
      source: tag.source,
      defer: tag.attributes.has('defer'),
      nonce: tag.attributes.get('nonce'),
    }));
}

const CSP_VIOLATIONS_KEY = '__e2eCspViolations';

// ページの関数はブラウザへ文字列として送られるため、このモジュールの他の値を参照しない
function recordCspViolations(key: string): void {
  const violations: CspViolation[] = [];
  Reflect.set(globalThis, key, violations);
  document.addEventListener('securitypolicyviolation', (event) => {
    violations.push({
      effectiveDirective: event.effectiveDirective,
      blockedURI: event.blockedURI,
      sourceFile: event.sourceFile,
      lineNumber: event.lineNumber,
      sample: event.sample,
    });
  });
}

// ページを開くより前に呼び、以降に開いた文書ごとに、読み込みの最初からCSPの違反を記録する
export async function installCspViolationRecorder(
  page: InitScriptTarget,
): Promise<void> {
  await page.addInitScript(recordCspViolations, CSP_VIOLATIONS_KEY);
}

export async function readCspViolations(
  page: EvaluationTarget,
): Promise<readonly CspViolation[]> {
  const violations = await page.evaluate(
    (key: string): readonly CspViolation[] | null =>
      (Reflect.get(globalThis, key) as readonly CspViolation[] | undefined) ??
      null,
    CSP_VIOLATIONS_KEY,
  );
  if (violations === null) {
    throw new Error(
      'CSPの違反の記録が始まっていません。ページを開く前にinstallCspViolationRecorderを呼んでください',
    );
  }
  return violations;
}

// 後から差し込まれたscript要素は既定でasyncになるため、文書の現在の状態で、パーサーを止めるスクリプトだけが残る
export async function readParserBlockingScriptSources(
  page: EvaluationTarget,
): Promise<readonly string[]> {
  return page.evaluate(
    (selector: string): readonly string[] =>
      Array.from(document.querySelectorAll<HTMLScriptElement>(selector))
        .filter(
          (script) =>
            !script.async &&
            !script.defer &&
            script.type.toLowerCase() !== 'module',
        )
        .map((script) => script.src),
    'script[src]',
  );
}
