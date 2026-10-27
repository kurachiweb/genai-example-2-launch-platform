import type { ValidatedFrontendEnv } from '../env/frontend-env.ts';

// 並び順はapi-gatewayのPermissions-Policyと同じにする
const PERMISSION_FEATURES = [
  'accelerometer',
  'autoplay',
  'camera',
  'display-capture',
  'encrypted-media',
  'fullscreen',
  'geolocation',
  'gyroscope',
  'magnetometer',
  'microphone',
  'midi',
  'payment',
  'publickey-credentials-get',
  'screen-wake-lock',
  'usb',
  'xr-spatial-tracking',
] as const;

export type PermissionFeature = (typeof PERMISSION_FEATURES)[number];

export type PermissionAllowlists = Readonly<
  Partial<Record<PermissionFeature, readonly string[]>>
>;

export interface SecurityPolicySources {
  readonly scriptSrc?: readonly string[];
  readonly styleSrc?: readonly string[];
  readonly imgSrc?: readonly string[];
  readonly fontSrc?: readonly string[];
  readonly connectSrc?: readonly string[];
  readonly frameSrc?: readonly string[];
  readonly formAction?: readonly string[];
  // 値はヘッダーの表記のまま書く。例: { payment: ['self', '"https://js.stripe.com"'] }
  readonly permissions?: PermissionAllowlists;
}

type SourceDirective = Exclude<keyof SecurityPolicySources, 'permissions'>;

const SOURCE_DIRECTIVES = [
  'scriptSrc',
  'styleSrc',
  'imgSrc',
  'fontSrc',
  'connectSrc',
  'frameSrc',
  'formAction',
] as const satisfies readonly SourceDirective[];

const SELF_SOURCE = "'self'";
const NONE_SOURCE = "'none'";
const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';

const ORIGIN_PATTERN =
  /^(?:https:\/\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*|http:\/\/localhost:\d{1,5})$/u;

// CSPのnonce-sourceのbase64-valueの文法。ヘッダーへの区切りや引用符の混入を防ぐ
const NONCE_PATTERN = /^[A-Za-z0-9+/_-]+={0,2}$/u;

const isSource = (value: string): boolean =>
  value === SELF_SOURCE || ORIGIN_PATTERN.test(value);

// Permissions-Policyは構造化フィールドの表記で、selfはトークン、オリジンは二重引用符の文字列になる
const isPermissionSource = (value: string): boolean =>
  value === 'self' ||
  (value.startsWith('"') &&
    value.endsWith('"') &&
    ORIGIN_PATTERN.test(value.slice(1, -1)));

const isPermissionFeature = (value: string): value is PermissionFeature =>
  (PERMISSION_FEATURES as readonly string[]).includes(value);

const uniqueFrozen = (values: readonly string[]): readonly string[] =>
  Object.freeze([...new Set(values)]);

const assertSources = (
  name: string,
  values: readonly string[],
  isValid: (value: string) => boolean,
): void => {
  const invalid = values.find((value) => !isValid(value));
  if (invalid !== undefined) {
    throw new Error(`${name}に許可できない値があります: ${invalid}`);
  }
};

const mergeDirective = (
  directive: SourceDirective,
  sources: readonly SecurityPolicySources[],
): readonly string[] => {
  const values = uniqueFrozen(
    sources.flatMap((source) => source[directive] ?? []),
  );
  assertSources(directive, values, isSource);
  return values;
};

const mergePermissions = (
  sources: readonly SecurityPolicySources[],
): PermissionAllowlists => {
  const entries = sources.flatMap((source) =>
    Object.entries(source.permissions ?? {}),
  );
  const unknown = entries.find(([feature]) => !isPermissionFeature(feature));
  if (unknown !== undefined) {
    throw new Error(`Permissions-Policyの未知の機能です: ${unknown[0]}`);
  }
  return Object.freeze(
    Object.fromEntries(
      PERMISSION_FEATURES.flatMap((feature) => {
        const values = uniqueFrozen(
          entries.flatMap(([name, allowlist]) =>
            name === feature ? allowlist : [],
          ),
        );
        assertSources(feature, values, isPermissionSource);
        return values.length > 0 ? [[feature, values]] : [];
      }),
    ),
  );
};

export const mergeSecurityPolicySources = (
  ...sources: readonly SecurityPolicySources[]
): SecurityPolicySources => {
  const directives = SOURCE_DIRECTIVES.flatMap((directive) => {
    const values = mergeDirective(directive, sources);
    return values.length > 0 ? [[directive, values] as const] : [];
  });
  const permissions = mergePermissions(sources);
  return Object.freeze({
    ...Object.fromEntries(directives),
    ...(Object.keys(permissions).length > 0 ? { permissions } : {}),
  });
};

export const BASE_SECURITY_POLICY_SOURCES: SecurityPolicySources =
  Object.freeze({
    scriptSrc: Object.freeze([TURNSTILE_ORIGIN]),
    frameSrc: Object.freeze([TURNSTILE_ORIGIN]),
  });

const originOf = (url: string | undefined): readonly string[] => {
  const parsed = url === undefined ? null : URL.parse(url);
  return parsed === null ? [] : [parsed.origin];
};

export const runtimeSecurityPolicySources = (
  env: Pick<ValidatedFrontendEnv, 'IMAGES_ORIGIN' | 'SENTRY_DSN'>,
): SecurityPolicySources => {
  const sentryOrigins = originOf(env.SENTRY_DSN);
  return Object.freeze({
    imgSrc: Object.freeze([env.IMAGES_ORIGIN]),
    ...(sentryOrigins.length > 0
      ? { connectSrc: Object.freeze(sentryOrigins) }
      : {}),
  });
};

export const NON_PAGE_CONTENT_SECURITY_POLICY =
  "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export interface PageContentSecurityPolicyInput {
  readonly nonce: string;
  readonly sources: SecurityPolicySources;
  readonly upgradeInsecureRequests: boolean;
}

const directive = (
  name: string,
  fixed: readonly string[],
  extra: readonly string[] = [],
): string => [name, ...new Set([...fixed, ...extra])].join(' ');

export const buildPageContentSecurityPolicy = ({
  nonce,
  sources,
  upgradeInsecureRequests,
}: PageContentSecurityPolicyInput): string => {
  if (!NONCE_PATTERN.test(nonce)) {
    throw new Error('nonceがbase64の形式ではありません');
  }
  const merged = mergeSecurityPolicySources(sources);
  const frameSources = merged.frameSrc ?? [];
  return [
    directive('default-src', [SELF_SOURCE]),
    directive(
      'script-src',
      [SELF_SOURCE, `'nonce-${nonce}'`],
      merged.scriptSrc,
    ),
    directive('style-src', [SELF_SOURCE, "'unsafe-inline'"], merged.styleSrc),
    directive('img-src', [SELF_SOURCE, 'data:', 'blob:'], merged.imgSrc),
    directive('font-src', [SELF_SOURCE], merged.fontSrc),
    directive('connect-src', [SELF_SOURCE], merged.connectSrc),
    directive(
      'frame-src',
      frameSources.length > 0 ? [] : [NONE_SOURCE],
      frameSources,
    ),
    directive('object-src', [NONE_SOURCE]),
    directive('base-uri', [NONE_SOURCE]),
    directive('form-action', [SELF_SOURCE], merged.formAction),
    directive('frame-ancestors', [NONE_SOURCE]),
    directive('manifest-src', [SELF_SOURCE]),
    ...(upgradeInsecureRequests ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
};

export const buildPermissionsPolicy = (
  sources: SecurityPolicySources,
): string => {
  const { permissions = {} } = mergeSecurityPolicySources(sources);
  return PERMISSION_FEATURES.map(
    (feature) => `${feature}=(${(permissions[feature] ?? []).join(' ')})`,
  ).join(', ');
};
