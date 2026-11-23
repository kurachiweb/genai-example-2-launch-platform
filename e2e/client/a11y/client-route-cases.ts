import { randomBytes } from 'node:crypto';

import { expect, type Browser, type Page } from '@playwright/test';

import type { LegalDocumentKind } from '../../../apps/common-lib/legal/legal-documents.ts';
import {
  createTestAccount,
  INVALID_CREDENTIALS_MESSAGE,
  loginForm,
  registerAccount,
  submitLogin,
  VERIFY_EMAIL_PATH,
} from '../auth/account-steps.ts';
import { directorySearchPath } from '../directory-steps.ts';
import { myProductEditPath } from '../product-steps.ts';
import { createProfileHandle, profilePath } from '../profile-steps.ts';
import {
  adminWorld,
  emptyUserWorld,
  matchWorld,
  memberWorld,
  rivalWorld,
} from './client-route-world.ts';
import {
  checkoutWorld,
  publishedLegalWorld,
  readLegalLatestVersions,
  listedProductsWorld,
  isUnavailable,
  paidCheckoutWorld,
  sponsorshipWorld,
  tournamentWorld,
  type Unavailable,
  unsubscribeUserWorld,
} from './client-route-flows-world.ts';
import { routeCaseKey } from './client-route-report.ts';
import { type StorageState, withSessionPage } from './route-sessions.ts';

export interface RouteTarget {
  readonly url: string;
  readonly storageState?: StorageState;
  readonly beforeOpen?: (page: Page) => Promise<void>;
  readonly afterOpen?: (page: Page) => Promise<void>;
  readonly expectedStatus?: number;
}

export interface SkippedRoute {
  readonly skip: string;
}

export type RouteOutcome = RouteTarget | SkippedRoute;

export type RouteResolver = (browser: Browser) => Promise<RouteOutcome>;

export const isSkipped = (outcome: RouteOutcome): outcome is SkippedRoute =>
  'skip' in outcome;

const randomToken = (): string => randomBytes(12).toString('hex');

const DUMMY_LINK_TOKEN = 'e2e-dummy-token';

const LEGAL_KINDS = [
  { path: '/legal', kind: 'legal-notice', inventory: '/legal' },
  { path: '/privacy', kind: 'privacy', inventory: '/privacy' },
  { path: '/terms', kind: 'terms', inventory: '/terms' },
] as const;

const MISSING_REVISION_NUMBER = 999_999;

const MISSING_WEEK = '2000-W01';

const MISSING_YEAR = '2000';

const OK_STATUS = 200;

const PUBLISH_VISIBLE_TIMEOUT_MS = 60_000;

const NOT_FOUND_STATUS = 404;

const missing = (url: string): RouteResolver =>
  guest(url, { expectedStatus: NOT_FOUND_STATUS });

const guest =
  (url: string, hooks: Partial<RouteTarget> = {}): RouteResolver =>
  () =>
    Promise.resolve({ url, ...hooks });

const asMember =
  (
    urlOf: (member: Awaited<ReturnType<typeof memberWorld>>) => string,
  ): RouteResolver =>
  async (browser) => {
    const member = await memberWorld(browser);
    return { url: urlOf(member), storageState: member.storageState };
  };

const asMemberAt = (url: string): RouteResolver => asMember(() => url);

const asEmptyUser =
  (url: string): RouteResolver =>
  async (browser) => ({
    url,
    storageState: (await emptyUserWorld(browser)).storageState,
  });

const afterMatchStarted =
  (resolve: RouteResolver): RouteResolver =>
  async (browser) => {
    await matchWorld(browser);
    return resolve(browser);
  };

const withMatch =
  (resolve: RouteResolver): RouteResolver =>
  async (browser) => {
    const { started } = await matchWorld(browser);
    return started
      ? resolve(browser)
      : {
          skip: '業務時刻の締め切りの直前でマッチを開始できないため、マッチのある状態を飛ばします',
        };
  };

const wrongPasswordLogin: RouteResolver = () =>
  Promise.resolve({
    url: '/auth/login',
    afterOpen: async (page) => {
      await submitLogin(
        page,
        `e2e-${randomToken()}@test.example`,
        randomToken(),
      );
      await expect(
        loginForm(page)
          .getByRole('alert')
          .filter({ hasText: INVALID_CREDENTIALS_MESSAGE }),
      ).toBeVisible();
    },
  });

const unverifiedAccount: RouteResolver = () =>
  Promise.resolve({
    url: VERIFY_EMAIL_PATH,
    beforeOpen: (page) => registerAccount(page, createTestAccount()),
  });

const unsubscribeLink: RouteResolver = async (browser) => {
  const { token } = await unsubscribeUserWorld(browser);
  return { url: `/unsubscribe#token=${token}` };
};

// 公開の直後に公開側で読めない時間があり得るため、公開の記事が読めるまで待ってから開く。開いた後の状態コードは別に確かめる
const helpArticle: RouteResolver = async (browser) => {
  const [article] = (await adminWorld(browser)).helpArticles;
  if (article === undefined) {
    throw new Error('公開のヘルプ記事を用意できませんでした');
  }
  const url = `/help/${article.handle}`;
  await withSessionPage(browser, 'client', async (page) => {
    await expect
      .poll(async () => (await page.request.get(url)).status(), {
        timeout: PUBLISH_VISIBLE_TIMEOUT_MS,
      })
      .toBe(OK_STATUS);
  });
  return { url };
};

const LEGAL_EMPTY_UNAVAILABLE_REASON =
  '公開は取り消せないため、公開済みの法務文書では準備中の表示を作れません';

const legalEmptyState =
  (kind: LegalDocumentKind, path: string): RouteResolver =>
  async () => {
    const latest = (await readLegalLatestVersions())[kind] ?? 0;
    return latest === 0
      ? { url: path }
      : { skip: `${kind}: ${LEGAL_EMPTY_UNAVAILABLE_REASON}` };
  };

const legalPublishedState =
  (kind: LegalDocumentKind, path: string): RouteResolver =>
  async (browser) => {
    await publishedLegalWorld(browser, kind);
    return { url: path };
  };

const legalRevision =
  (
    kind: LegalDocumentKind,
    path: string,
    wantPublished: boolean,
  ): RouteResolver =>
  async (browser) => {
    if (!wantPublished) {
      return {
        url: `${path}/revisions/${String(MISSING_REVISION_NUMBER)}`,
        expectedStatus: NOT_FOUND_STATUS,
      };
    }
    await publishedLegalWorld(browser, kind);
    return { url: `${path}/revisions/1` };
  };

const withPayments =
  <T extends object>(
    world: (browser: Browser) => Promise<T | Unavailable>,
    toTarget: (value: T) => RouteTarget,
  ): RouteResolver =>
  async (browser) => {
    const value = await world(browser);
    return isUnavailable(value) ? { skip: value.unavailable } : toTarget(value);
  };

const tournament =
  (
    pathOf: (world: { readonly week: string; readonly year: string }) => string,
  ): RouteResolver =>
  async () => {
    const world = await tournamentWorld();
    return isUnavailable(world)
      ? { skip: world.unavailable }
      : { url: pathOf(world) };
  };

const linkConfirmation = (
  path: string,
): readonly [
  readonly [string, RouteResolver],
  readonly [string, RouteResolver],
] => [
  [
    routeCaseKey(path, 'signed-out'),
    guest(`${path}#token=${DUMMY_LINK_TOKEN}`),
  ],
  [routeCaseKey(path, 'error'), guest(path)],
];

const settingsStates = (
  path: string,
  states: {
    readonly empty?: RouteResolver;
    readonly withData?: RouteResolver;
  } = {},
): readonly (readonly [string, RouteResolver])[] => [
  [routeCaseKey(path, 'signed-in'), asMemberAt(path)],
  ...(states.empty === undefined
    ? []
    : ([[routeCaseKey(path, 'empty'), states.empty]] as const)),
  ...(states.withData === undefined
    ? []
    : ([[routeCaseKey(path, 'with-data'), states.withData]] as const)),
];

const legalCases = (): readonly (readonly [string, RouteResolver])[] =>
  LEGAL_KINDS.flatMap(({ path, kind, inventory }) => [
    [
      routeCaseKey(`${inventory}/`, 'empty'),
      legalEmptyState(kind, path),
    ] as const,
    [
      routeCaseKey(`${inventory}/`, 'with-data'),
      legalPublishedState(kind, path),
    ] as const,
    [
      routeCaseKey(`${inventory}/revisions/$versionNumber`, 'with-data'),
      legalRevision(kind, path, true),
    ] as const,
    [
      routeCaseKey(`${inventory}/revisions/$versionNumber`, 'error'),
      legalRevision(kind, path, false),
    ] as const,
  ]);

export const CLIENT_ROUTE_CASES: ReadonlyMap<string, RouteResolver> = new Map([
  [routeCaseKey('/', 'signed-out'), afterMatchStarted(guest('/'))],
  [routeCaseKey('/', 'signed-in'), afterMatchStarted(asMemberAt('/'))],
  [routeCaseKey('/', 'with-data'), withMatch(guest('/'))],
  [
    routeCaseKey('/@{$handle}', 'signed-out'),
    async (browser) => ({
      url: profilePath((await memberWorld(browser)).handle),
    }),
  ],
  [
    routeCaseKey('/@{$handle}', 'signed-in'),
    async (browser) => {
      const rival = await rivalWorld(browser);
      const member = await memberWorld(browser);
      return {
        url: profilePath(rival.handle),
        storageState: member.storageState,
      };
    },
  ],
  [
    routeCaseKey('/@{$handle}', 'with-data'),
    async (browser) => ({
      url: profilePath((await rivalWorld(browser)).handle),
    }),
  ],
  [
    routeCaseKey('/@{$handle}', 'error'),
    missing(profilePath(createProfileHandle())),
  ],
  [routeCaseKey('/api-docs', 'signed-out'), guest('/api-docs')],
  [routeCaseKey('/contact', 'signed-out'), guest('/contact')],
  [routeCaseKey('/contact', 'signed-in'), asMemberAt('/contact')],
  [routeCaseKey('/pricing', 'signed-out'), guest('/pricing')],
  [routeCaseKey('/pricing', 'signed-in'), asMemberAt('/pricing')],
  [routeCaseKey('/unsubscribe', 'with-data'), unsubscribeLink],
  [routeCaseKey('/unsubscribe', 'error'), guest('/unsubscribe')],
  [routeCaseKey('/auth/login', 'signed-out'), guest('/auth/login')],
  [routeCaseKey('/auth/login', 'error'), wrongPasswordLogin],
  [routeCaseKey('/auth/register', 'signed-out'), guest('/auth/register')],
  [routeCaseKey('/auth/verify-email', 'signed-in'), unverifiedAccount],
  [routeCaseKey('/help/$handle', 'with-data'), helpArticle],
  [
    routeCaseKey('/help/$handle', 'error'),
    missing(`/help/e2e-missing-${randomToken()}`),
  ],
  [routeCaseKey('/help/', 'signed-out'), guest('/help')],
  [
    routeCaseKey('/help/', 'with-data'),
    async (browser) => {
      await adminWorld(browser);
      return { url: '/help' };
    },
  ],
  ...legalCases(),
  [
    routeCaseKey('/checkout/$purchaseId', 'signed-in'),
    withPayments(checkoutWorld, ({ purchaseId, storageState }) => ({
      url: `/checkout/${purchaseId}`,
      storageState,
    })),
  ],
  [
    routeCaseKey('/checkout/return', 'signed-in'),
    withPayments(paidCheckoutWorld, ({ returnPath, storageState }) => ({
      url: returnPath,
      storageState,
    })),
  ],
  [routeCaseKey('/checkout/return', 'error'), asMemberAt('/checkout/return')],
  [
    routeCaseKey('/inquiries/$inquiryId', 'signed-in'),
    asMember(({ inquiryPath }) => inquiryPath),
  ],
  [
    routeCaseKey('/inquiries/$inquiryId', 'error'),
    async (browser) => {
      const member = await memberWorld(browser);
      const other = await emptyUserWorld(browser);
      return {
        url: member.inquiryPath,
        storageState: other.storageState,
        expectedStatus: NOT_FOUND_STATUS,
      };
    },
  ],
  ...settingsStates('/settings/account'),
  ...settingsStates('/settings/api-keys', {
    empty: asEmptyUser('/settings/api-keys'),
    withData: asMemberAt('/settings/api-keys'),
  }),
  ...settingsStates('/settings/billing', {
    empty: asEmptyUser('/settings/billing'),
    withData: withPayments(paidCheckoutWorld, ({ storageState }) => ({
      url: '/settings/billing',
      storageState,
    })),
  }),
  ...settingsStates('/settings/export', {
    empty: asEmptyUser('/settings/export'),
    withData: asMemberAt('/settings/export'),
  }),
  ...settingsStates('/settings/follows', {
    empty: asEmptyUser('/settings/follows'),
    withData: asMemberAt('/settings/follows'),
  }),
  ...settingsStates('/settings/notifications'),
  ...settingsStates('/settings/plan'),
  ...settingsStates('/settings/profile'),
  ...settingsStates('/settings/security'),
  ...settingsStates('/settings/sponsorships', {
    empty: asEmptyUser('/settings/sponsorships'),
    withData: async (browser) => ({
      url: '/settings/sponsorships',
      storageState: (await sponsorshipWorld(browser)).storageState,
    }),
  }),
  [
    routeCaseKey('/p/$handle', 'signed-out'),
    async () => ({ url: `/p/${(await listedProductsWorld()).firstHandle}` }),
  ],
  [
    routeCaseKey('/p/$handle', 'signed-in'),
    async (browser) => {
      const listed = await listedProductsWorld();
      const viewer = await emptyUserWorld(browser);
      return {
        url: `/p/${listed.firstHandle}`,
        storageState: viewer.storageState,
      };
    },
  ],
  [
    routeCaseKey('/p/$handle', 'with-data'),
    asMember(({ productHandle }) => `/p/${productHandle}`),
  ],
  [
    routeCaseKey('/p/$handle', 'error'),
    missing(`/p/e2e-missing-${randomToken()}`),
  ],
  [routeCaseKey('/system/status', 'signed-out'), guest('/system/status')],
  [
    routeCaseKey('/p/', 'signed-out'),
    async () => {
      await listedProductsWorld();
      return { url: '/p' };
    },
  ],
  [
    routeCaseKey('/p/', 'with-data'),
    async () => {
      await listedProductsWorld();
      return { url: '/p' };
    },
  ],
  [
    routeCaseKey('/p/', 'empty'),
    guest(directorySearchPath(`e2eにも一致しない語${randomToken()}`)),
  ],
  [
    routeCaseKey('/tournaments/week/$week', 'with-data'),
    tournament(({ week }) => `/tournaments/week/${week}`),
  ],
  [
    routeCaseKey('/tournaments/week/$week', 'error'),
    missing(`/tournaments/week/${MISSING_WEEK}`),
  ],
  [
    routeCaseKey('/tournaments/year/$year', 'with-data'),
    tournament(({ year }) => `/tournaments/year/${year}`),
  ],
  [
    routeCaseKey('/tournaments/year/$year', 'error'),
    missing(`/tournaments/year/${MISSING_YEAR}`),
  ],
  ...[
    '/auth/email-change/confirm',
    '/auth/password-change/confirm',
    '/auth/password-reset/confirm',
  ].flatMap(linkConfirmation),
  [
    routeCaseKey('/auth/password-reset/', 'signed-out'),
    guest('/auth/password-reset'),
  ],
  [
    routeCaseKey('/my/products/new', 'signed-in'),
    asMemberAt('/my/products/new'),
  ],
  [routeCaseKey('/my/products/', 'signed-in'), asMemberAt('/my/products')],
  [routeCaseKey('/my/products/', 'empty'), asEmptyUser('/my/products')],
  [routeCaseKey('/my/products/', 'with-data'), asMemberAt('/my/products')],
  [
    routeCaseKey('/my/products/$handle/edit', 'signed-in'),
    asMember(({ productHandle }) => myProductEditPath(productHandle)),
  ],
]);
