import { randomBytes } from 'node:crypto';

import {
  expect,
  type Browser,
  type Page,
  type Response,
} from '@playwright/test';

import { QUARANTINED_IMAGE_LIST_EMPTY_MESSAGE } from '../../../apps/admin/src/components/moderation/shared/moderation-messages.ts';
import { SPONSORSHIP_LIST_EMPTY_MESSAGE } from '../../../apps/admin/src/components/sponsorship/admin-sponsorships-messages.ts';
import { LEGAL_DOCUMENT_LABELS } from '../../../apps/common-lib/legal/legal-documents.ts';
import type { AdminRole } from '../../../apps/common-lib/admin/admin-roles.ts';
import type { LegalDocumentKind } from '../../../apps/common-lib/legal/legal-documents.ts';
import { routeCaseKey } from '../../support/route-audit-report.ts';
import type { StorageState } from '../../support/route-sessions.ts';
import { INVALID_CREDENTIALS_MESSAGE } from '../../client/auth/account-steps.ts';
import {
  createAdminEmail,
  issueSuperAdminInvitation,
  loginForm,
  submitAdminCredentials,
} from '../../support/admin-bootstrap.ts';
import type { RouteState } from '../../support/route-inventory.ts';
import {
  helpArticleEditPath,
  openHelpArticleOrder,
} from '../help-center-steps.ts';
import {
  adminSession,
  engagementWorld,
  firstEmptyListPath,
  helpWorld,
  inquiryPathWorld,
  legalWorld,
  ownerWorld,
  productPathWorld,
  quarantinedAvatarWorld,
  reportCasePathWorld,
  sponsorshipWorld,
  waitForEditorToolbar,
} from './admin-route-world.ts';
import {
  commentsOfProductPath,
  emptyCommentsPath,
  emptyHelpArticlesPath,
  emptyInquiriesPath,
  emptyRatingsPath,
  emptyReportsPath,
  legalEditorPath,
  legalRevisionPath,
  productsByHandlePath,
  QUARANTINED_IMAGE_PATHS,
  ratingsOfProductPath,
  SPONSORSHIP_FILTER_PATHS,
  usersByEmailPath,
} from './admin-route-urls.ts';

export interface RouteTarget {
  readonly url: string;
  readonly storageState?: StorageState;
  readonly expectedPath?: string;
  readonly expectedStatus?: number;
  readonly open?: (page: Page) => Promise<Response | null>;
  readonly afterOpen?: (page: Page) => Promise<void>;
}

export interface SkippedRoute {
  readonly skip: string;
}

export type RouteOutcome = RouteTarget | SkippedRoute;

export type RouteResolver = (browser: Browser) => Promise<RouteOutcome>;

export const isSkipped = (outcome: RouteOutcome): outcome is SkippedRoute =>
  'skip' in outcome;

type CaseEntry = readonly [string, RouteResolver];

const DUMMY_LINK_TOKEN = 'e2e-dummy-token';

const LEGAL_AUDIT_KIND: LegalDocumentKind = 'terms';

const HELP_ARTICLES_PATH = '/help-articles';

const HELP_ARTICLE_NEW_PATH = `${HELP_ARTICLES_PATH}/new`;

const HELP_ARTICLE_ORDER_PATH = `${HELP_ARTICLES_PATH}/order`;

const FIRST_VERSION_NUMBER = 1;

const NAVIGATION_TIMEOUT_MS = 120_000;

const randomToken = (): string => randomBytes(6).toString('hex');

const hasModeratorRole = (role: AdminRole): boolean => role !== 'viewer';

const roleOfState = (state: RouteState): AdminRole => {
  switch (state) {
    case 'role-viewer':
      return 'viewer';
    case 'role-moderator':
      return 'moderator';
    default:
      return 'super_admin';
  }
};

const ALL_ROLE_STATES: readonly RouteState[] = [
  'with-data',
  'role-viewer',
  'role-moderator',
];

const guest =
  (url: string, hooks: Partial<RouteTarget> = {}): RouteResolver =>
  () =>
    Promise.resolve({ url, ...hooks });

const asAdmin =
  (
    role: AdminRole,
    urlOf: (browser: Browser) => Promise<string> | string,
    hooks: Partial<RouteTarget> = {},
  ): RouteResolver =>
  async (browser) => {
    const url = await urlOf(browser);
    const { storageState } = await adminSession(browser, role);
    return { url, storageState, ...hooks };
  };

// 状態ごとに、ロールの状態は閲覧のみ・モデレーターの管理者で、それ以外は最上位管理者で開く
const forStates = (
  path: string,
  states: readonly RouteState[],
  resolverOf: (role: AdminRole, state: RouteState) => RouteResolver,
): readonly CaseEntry[] =>
  states.map((state) => [
    routeCaseKey(path, state),
    resolverOf(roleOfState(state), state),
  ]);

const staticList = (
  inventoryPath: string,
  url: string,
  states: readonly RouteState[] = ALL_ROLE_STATES,
): readonly CaseEntry[] =>
  forStates(inventoryPath, states, (role) => asAdmin(role, () => url));

const linkConfirmation = (path: string): readonly CaseEntry[] => [
  [
    routeCaseKey(path, 'signed-out'),
    guest(`${path}#token=${DUMMY_LINK_TOKEN}`),
  ],
  [routeCaseKey(path, 'error'), guest(path)],
];

const invitationLink: RouteResolver = async () => {
  const { link } = await issueSuperAdminInvitation(createAdminEmail());
  return { url: link };
};

const wrongCredentialsLogin: RouteResolver = () =>
  Promise.resolve({
    url: '/auth/login',
    afterOpen: async (page) => {
      await submitAdminCredentials(
        page,
        `e2e-${randomToken()}@test.example`,
        randomToken(),
      );
      await expect(
        loginForm(page).getByText(INVALID_CREDENTIALS_MESSAGE),
      ).toBeVisible();
    },
  });

const editorHooks = (role: AdminRole): Partial<RouteTarget> =>
  hasModeratorRole(role) ? { afterOpen: waitForEditorToolbar } : {};

// 作成の画面は閲覧のみの管理者を記事の一覧へ戻す設計のため、閲覧のみでは戻り先の一覧を検査する
const helpArticleNew = (role: AdminRole): RouteResolver =>
  asAdmin(
    role,
    () => HELP_ARTICLE_NEW_PATH,
    role === 'viewer'
      ? { expectedPath: HELP_ARTICLES_PATH }
      : editorHooks(role),
  );

const helpArticleEdit = (role: AdminRole): RouteResolver =>
  asAdmin(
    role,
    async (browser) => {
      const [article] = (await helpWorld(browser)).articles;
      if (article === undefined) {
        throw new Error('ヘルプ記事を用意できませんでした');
      }
      return helpArticleEditPath(article.id);
    },
    editorHooks(role),
  );

// 並べ替えの画面は開いた後にカテゴリを選ぶ手順まで上流の補助が持つため、その手順で開き、文書の取得の応答を捕まえる
const helpArticleOrder =
  (role: AdminRole): RouteResolver =>
  async (browser) => {
    const { categoryName } = await helpWorld(browser);
    const { storageState } = await adminSession(browser, role);
    return {
      url: HELP_ARTICLE_ORDER_PATH,
      storageState,
      open: async (page) => {
        const [response] = await Promise.all([
          page.waitForResponse(
            (candidate) =>
              candidate.request().isNavigationRequest() &&
              new URL(candidate.url()).pathname === HELP_ARTICLE_ORDER_PATH,
            { timeout: NAVIGATION_TIMEOUT_MS },
          ),
          openHelpArticleOrder(page, categoryName),
        ]);
        return response;
      },
    };
  };

const legalEditor = (role: AdminRole): RouteResolver =>
  asAdmin(
    role,
    async (browser) => {
      await legalWorld(browser, LEGAL_AUDIT_KIND);
      return legalEditorPath(LEGAL_AUDIT_KIND);
    },
    {
      afterOpen: async (page) => {
        await expect(
          page.getByRole('heading', {
            level: 1,
            name: LEGAL_DOCUMENT_LABELS[LEGAL_AUDIT_KIND],
          }),
        ).toBeVisible();
        if (role === 'super_admin') {
          await waitForEditorToolbar(page);
        }
      },
    },
  );

const emptyListOf =
  (
    name: string,
    paths: readonly string[],
    message: string,
    fallback: string,
  ): RouteResolver =>
  async (browser) => {
    const found = await firstEmptyListPath(browser, name, paths, message);
    if (found === null) {
      return {
        skip: `他のテストのデータで${fallback}の全ての絞り込みに結果があり、0件の表示を作れないため飛ばします`,
      };
    }
    const { storageState } = await adminSession(browser, 'super_admin');
    return { url: found, storageState };
  };

export const ADMIN_ROUTE_CASES: ReadonlyMap<string, RouteResolver> = new Map([
  ...forStates('/', ['with-data'], (role) => asAdmin(role, () => '/')),
  [routeCaseKey('/auth/invitation', 'signed-out'), invitationLink],
  [routeCaseKey('/auth/invitation', 'error'), guest('/auth/invitation')],
  [routeCaseKey('/auth/login', 'signed-out'), guest('/auth/login')],
  [routeCaseKey('/auth/login', 'error'), wrongCredentialsLogin],
  [routeCaseKey('/system/status', 'signed-out'), guest('/system/status')],
  ...forStates('/help-articles/$articleId', ALL_ROLE_STATES, (role) =>
    helpArticleEdit(role),
  ),
  ...forStates(
    '/help-articles/new',
    ['role-viewer', 'role-moderator'],
    (role) => helpArticleNew(role),
  ),
  ...forStates('/help-articles/order', ALL_ROLE_STATES, (role) =>
    helpArticleOrder(role),
  ),
  ...forStates('/inquiries/$inquiryId', ALL_ROLE_STATES, (role) =>
    asAdmin(role, inquiryPathWorld),
  ),
  ...forStates('/products/$productId', ALL_ROLE_STATES, (role) =>
    asAdmin(role, productPathWorld),
  ),
  ...forStates('/reports/$caseId', ALL_ROLE_STATES, (role) =>
    asAdmin(role, () => reportCasePathWorld()),
  ),
  ...linkConfirmation('/auth/email-change/confirm'),
  ...linkConfirmation('/auth/password-reset/confirm'),
  ...staticList('/account/', '/account', ['with-data']),
  ...staticList('/accounts/', '/accounts'),
  ...staticList('/audit-logs/', '/audit-logs', ['with-data']),
  ...staticList('/categories/', '/categories'),
  ...forStates(
    '/comments/',
    ['with-data', 'empty', 'role-viewer', 'role-moderator'],
    (role, state) =>
      asAdmin(role, async () => {
        const { productHandle } = await engagementWorld();
        return state === 'empty'
          ? emptyCommentsPath(randomToken())
          : commentsOfProductPath(productHandle);
      }),
  ),
  ...forStates(
    '/help-articles/',
    ['with-data', 'empty', 'role-viewer', 'role-moderator'],
    (role, state) =>
      asAdmin(role, async (browser) => {
        await helpWorld(browser);
        return state === 'empty'
          ? emptyHelpArticlesPath(randomToken())
          : HELP_ARTICLES_PATH;
      }),
  ),
  ...forStates('/inquiries/', ['with-data', 'empty'], (role, state) =>
    asAdmin(role, async (browser) => {
      await inquiryPathWorld(browser);
      return state === 'empty' ? emptyInquiriesPath() : '/inquiries';
    }),
  ),
  ...staticList('/legal-documents/', '/legal-documents', ['with-data']),
  ...forStates(
    '/media-moderation/',
    ['with-data', 'role-viewer', 'role-moderator'],
    (role) =>
      asAdmin(role, async (browser) => {
        await quarantinedAvatarWorld(browser);
        return '/media-moderation';
      }),
  ),
  [
    routeCaseKey('/media-moderation/', 'empty'),
    emptyListOf(
      'media-moderation',
      QUARANTINED_IMAGE_PATHS,
      QUARANTINED_IMAGE_LIST_EMPTY_MESSAGE,
      '隔離理由',
    ),
  ],
  ...forStates('/products/', ['with-data'], (role) =>
    asAdmin(role, async (browser) =>
      productsByHandlePath((await ownerWorld(browser)).productHandle),
    ),
  ),
  ...forStates(
    '/ratings/',
    ['with-data', 'empty', 'role-viewer', 'role-moderator'],
    (role, state) =>
      asAdmin(role, async () => {
        const { productHandle } = await engagementWorld();
        return state === 'empty'
          ? emptyRatingsPath(randomToken())
          : ratingsOfProductPath(productHandle);
      }),
  ),
  ...forStates('/reports/', ['with-data', 'empty'], (role, state) =>
    asAdmin(role, async () => {
      await reportCasePathWorld();
      return state === 'empty' ? emptyReportsPath() : '/reports';
    }),
  ),
  ...staticList('/settings/', '/settings', ['role-viewer', 'role-moderator']),
  ...forStates('/sponsorships/', ['with-data'], (role) =>
    asAdmin(role, async (browser) => {
      await sponsorshipWorld(browser);
      return '/sponsorships';
    }),
  ),
  [
    routeCaseKey('/sponsorships/', 'empty'),
    emptyListOf(
      'sponsorships',
      SPONSORSHIP_FILTER_PATHS,
      SPONSORSHIP_LIST_EMPTY_MESSAGE,
      '掲載状況とティア',
    ),
  ],
  ...forStates('/users/', ALL_ROLE_STATES, (role) =>
    asAdmin(role, async (browser) =>
      usersByEmailPath((await ownerWorld(browser)).email),
    ),
  ),
  [
    routeCaseKey('/auth/password-reset/', 'signed-out'),
    guest('/auth/password-reset'),
  ],
  ...forStates('/legal-documents/$kind/', ALL_ROLE_STATES, (role) =>
    legalEditor(role),
  ),
  ...forStates(
    '/legal-documents/$kind/revisions/$versionNumber',
    ['with-data'],
    (role) =>
      asAdmin(role, async (browser) => {
        await legalWorld(browser, LEGAL_AUDIT_KIND);
        return legalRevisionPath(LEGAL_AUDIT_KIND, FIRST_VERSION_NUMBER);
      }),
  ),
]);
