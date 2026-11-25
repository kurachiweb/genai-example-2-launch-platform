export type RouteState =
  | 'with-data'
  | 'empty'
  | 'error'
  | 'signed-out'
  | 'signed-in'
  | 'role-viewer'
  | 'role-moderator';

export type RouteApp = 'client' | 'admin';

export interface RouteEntry {
  readonly app: RouteApp;
  readonly path: string;
  readonly states: readonly RouteState[];
  readonly prepare: string;
  readonly excluded?: string;
}

const NO_PREPARATION = '用意は要らない(ログイン不要の公開の画面)';

const SIGNED_IN_USER =
  '`registerVerifiedAccount`で確認済みの利用者を作りログインする';

const ADMIN_SIGN_IN =
  '`signInAsNewAdmin`で最上位管理者としてログインする(ロールの状態は同じ関数のroleに閲覧のみ・モデレーターを渡す)';

const INVALID_LINK =
  'トークンを付けずに開き、無効なリンクの表示を確かめる(有効なトークンの経路は各機能のE2Eが持つ)';

const client = (
  path: string,
  states: readonly RouteState[],
  prepare: string,
): RouteEntry => ({ app: 'client', path, states, prepare });

const admin = (
  path: string,
  states: readonly RouteState[],
  prepare: string,
): RouteEntry => ({ app: 'admin', path, states, prepare });

const clientExcluded = (path: string, excluded: string): RouteEntry => ({
  app: 'client',
  path,
  states: [],
  prepare: '',
  excluded,
});

const SETTINGS_REDIRECT =
  '設定の入口は最初の設定の画面(`/settings/profile`など)へ移すだけで、自身の画面を描かない。移動先の各経路で検査する';

const ROLE_STATES: readonly RouteState[] = ['role-viewer', 'role-moderator'];

const CLIENT_ROUTES: readonly RouteEntry[] = [
  client(
    '/',
    ['signed-out', 'signed-in', 'with-data'],
    '`createMatchCategory`・`moveLaunchesToDate`・`startQualifiers`で予選のマッチを用意して開く。ログイン済みは`registerVerifiedAccount`で作る',
  ),
  client(
    '/@{$handle}',
    ['signed-out', 'signed-in', 'with-data', 'error'],
    '`registerVerifiedAccount`で作った利用者の`profilePath`を代表の値にする。errorは存在しないハンドルを開く(`createProfileHandle`で作った未登録のハンドル)',
  ),
  client('/api-docs', ['signed-out'], NO_PREPARATION),
  client(
    '/contact',
    ['signed-out', 'signed-in'],
    '未ログインは用意が要らず、ログイン済みは`registerVerifiedAccount`で作る。`openContactForm`で開く',
  ),
  client(
    '/pricing',
    ['signed-out', 'signed-in'],
    '`setUltrasPromotionFlag`で訴求の有無を切り替える。ログイン済みは`registerVerifiedAccount`で作る',
  ),
  client(
    '/unsubscribe',
    ['with-data', 'error'],
    '`registerVerifiedAccount`で作った利用者の`findUserIdByEmail`のIDから`createUnsubscribeToken`で配信停止のトークンを作る。errorはトークンの無い経路を開く',
  ),
  clientExcluded('/settings', SETTINGS_REDIRECT),
  client(
    '/auth/login',
    ['signed-out', 'error'],
    'errorは`submitLogin`に誤ったパスワードを渡して失敗の表示を出す。ログイン済みは移されるため状態に含めない',
  ),
  client('/auth/register', ['signed-out'], NO_PREPARATION),
  client(
    '/auth/verify-email',
    ['signed-in'],
    '`registerAccount`で登録し、メールの確認の前の利用者で開く',
  ),
  client(
    '/help/$handle',
    ['with-data', 'error'],
    '管理者の`signInAsNewAdmin`(moderator)と`createHelpArticle`・`createHelpHandle`で公開の記事を作り、そのハンドルを代表の値にする。errorは存在しないハンドルを開く',
  ),
  client(
    '/p/$handle',
    ['signed-out', 'signed-in', 'with-data', 'error'],
    '`registerProduct`で登録したプロダクトか`createListedProducts`で作った掲載中のプロダクトのハンドルを代表の値にする。errorは存在しないハンドルを開く',
  ),
  client('/system/status', ['signed-out'], NO_PREPARATION),
  client(
    '/help/',
    ['signed-out', 'with-data'],
    '`signInAsNewAdmin`と`createHelpArticle`で公開の記事を2件以上作る',
  ),
  client(
    '/legal/',
    ['empty', 'with-data'],
    '公開の版が無ければ準備中の表示(empty)。with-dataは管理者の画面で法務文書を公開した状態で、公開できるのは最上位管理者だけのため`signInAsNewAdmin`の最上位管理者が行う',
  ),
  client(
    '/p/',
    ['signed-out', 'with-data', 'empty'],
    'with-dataは`createListedProducts`で1ページの件数より1件多く作る。emptyは`directorySearchPath`に一致しない検索語を渡して開く',
  ),
  client(
    '/privacy/',
    ['empty', 'with-data'],
    '「/legal/」と同じ。種別がプライバシーポリシーの文書を公開する',
  ),
  client(
    '/terms/',
    ['empty', 'with-data'],
    '「/legal/」と同じ。種別が利用規約の文書を公開する',
  ),
  client(
    '/checkout/$purchaseId',
    ['signed-in'],
    '`startSmokeCheckout`で決済の画面へ進み、購入のIDを代表の値にする。決済の転送が揃わない環境では`SMOKE_CHECKOUT_SKIP_REASON`を表示して対象外にする',
  ),
  client(
    '/checkout/return',
    ['signed-in', 'error'],
    'signed-inは`startSmokeCheckout`と`preparePaymentWithTestCard`・`confirmPayment`の後の戻り先。決済の転送が揃わなければ対象外、errorは検索の値の無い戻り先を開く',
  ),
  client(
    '/inquiries/$inquiryId',
    ['signed-in', 'error'],
    '`registerVerifiedAccount`で作った利用者が`submitMemberInquiry`で送った問い合わせのIDを代表の値にする。errorは他人の問い合わせのIDを開く',
  ),
  client(
    '/settings/account',
    ['signed-in'],
    `${SIGNED_IN_USER}。\`openAccountSettings\`で開く`,
  ),
  client(
    '/settings/api-keys',
    ['signed-in', 'empty', 'with-data'],
    `${SIGNED_IN_USER}。with-dataは\`issueApiKey\`でキーを1件発行する`,
  ),
  client(
    '/settings/billing',
    ['signed-in', 'empty', 'with-data'],
    `${SIGNED_IN_USER}。emptyは支払いの履歴の無い利用者、with-dataは\`startSmokeCheckout\`で決済を済ませた利用者`,
  ),
  client(
    '/settings/export',
    ['signed-in', 'empty', 'with-data'],
    `${SIGNED_IN_USER}。with-dataは\`requestDataExport\`で要求した後`,
  ),
  client(
    '/settings/follows',
    ['signed-in', 'empty', 'with-data'],
    `${SIGNED_IN_USER}。with-dataは別の利用者を\`followFromProfile\`でフォローした後`,
  ),
  client(
    '/settings/notifications',
    ['signed-in'],
    `${SIGNED_IN_USER}。\`openNotificationSettings\`で開く`,
  ),
  client(
    '/settings/plan',
    ['signed-in'],
    `${SIGNED_IN_USER}。\`openPlanFromSettingsNavigation\`で開く`,
  ),
  client(
    '/settings/profile',
    ['signed-in'],
    `${SIGNED_IN_USER}。\`openProfileEditor\`で開く`,
  ),
  client(
    '/settings/security',
    ['signed-in'],
    `${SIGNED_IN_USER}。\`openSecuritySettings\`で開く`,
  ),
  client(
    '/settings/sponsorships',
    ['signed-in', 'empty', 'with-data'],
    '`registerSponsorshipOwner`で作った利用者。with-dataは`createPaidSponsorship`で支払い済みの掲載を作る',
  ),
  client('/auth/email-change/confirm', ['signed-out', 'error'], INVALID_LINK),
  client(
    '/auth/password-change/confirm',
    ['signed-out', 'error'],
    INVALID_LINK,
  ),
  client('/auth/password-reset/confirm', ['signed-out', 'error'], INVALID_LINK),
  client(
    '/legal/revisions/$versionNumber',
    ['with-data', 'error'],
    '管理者が公開した法務文書の版番号1を代表の値にする(`signInAsNewAdmin`の最上位管理者が公開する)。errorは存在しない版番号を開く',
  ),
  client(
    '/privacy/revisions/$versionNumber',
    ['with-data', 'error'],
    '「/legal/revisions/$versionNumber」と同じ。プライバシーポリシーの版番号1を代表の値にする',
  ),
  client(
    '/terms/revisions/$versionNumber',
    ['with-data', 'error'],
    '「/legal/revisions/$versionNumber」と同じ。利用規約の版番号1を代表の値にする',
  ),
  client(
    '/tournaments/week/$week',
    ['with-data', 'error'],
    '`createWeekTournamentEntrants`のweekStartの値から作る週の識別子(2026-W47の形)を代表の値にし、`startWeekFinalToday`で決勝を進行中にする。errorは存在しない週を開く',
  ),
  client(
    '/tournaments/year/$year',
    ['with-data', 'error'],
    '`createYearTournamentEntrants`で作った年を代表の値にし、`startYearFinalToday`で決勝を進行中にする。errorは存在しない年を開く',
  ),
  clientExcluded('/settings/', SETTINGS_REDIRECT),
  client('/auth/password-reset/', ['signed-out'], NO_PREPARATION),
  client(
    '/my/products/new',
    ['signed-in'],
    `${SIGNED_IN_USER}。\`openProductRegistration\`で開く`,
  ),
  client(
    '/my/products/',
    ['signed-in', 'empty', 'with-data'],
    `${SIGNED_IN_USER}。with-dataは\`registerProduct\`で1件登録する`,
  ),
  client(
    '/my/products/$handle/edit',
    ['signed-in'],
    '`registerProduct`で登録したプロダクトのハンドルを代表の値にし、`myProductEditPath`で開く',
  ),
];

const ADMIN_ROUTES: readonly RouteEntry[] = [
  admin('/', ['with-data'], ADMIN_SIGN_IN),
  admin(
    '/auth/invitation',
    ['signed-out', 'error'],
    'with-dataの代わりに、`issueSuperAdminInvitation`で発行した招待のリンクを完了前に開く。errorは無効なトークンのリンクを開く',
  ),
  admin(
    '/auth/login',
    ['signed-out', 'error'],
    '`startAdminLogin`で開く。errorは`submitAdminCredentials`に誤った資格情報を渡す',
  ),
  admin('/system/status', ['signed-out'], NO_PREPARATION),
  admin(
    '/help-articles/$articleId',
    ['with-data', ...ROLE_STATES],
    '`createHelpArticle`が返す記事のIDを代表の値にし、`helpArticleEditPath`で開く',
  ),
  admin(
    '/help-articles/new',
    ROLE_STATES,
    `${ADMIN_SIGN_IN}。\`createHelpArticle\`の作成の画面を開く`,
  ),
  admin(
    '/help-articles/order',
    ['with-data', ...ROLE_STATES],
    'カテゴリと、カテゴリ内の記事を2件以上用意する(`createHelpArticle`でカテゴリ内にピン留めの公開記事を作り、`openHelpArticleOrder`で開く)',
  ),
  admin(
    '/inquiries/$inquiryId',
    ['with-data', ...ROLE_STATES],
    '`submitGuestInquiry`で送った問い合わせのIDを代表の値にし、`openInquiryDetailFromList`で開く',
  ),
  admin(
    '/products/$productId',
    ['with-data', ...ROLE_STATES],
    '`registerProduct`で登録したプロダクトのIDを代表の値にし、`openAdminProductDetail`で開く',
  ),
  admin(
    '/reports/$caseId',
    ['with-data', ...ROLE_STATES],
    '`createReport`で通報を作り、`findOpenReportCaseId`が返す案件のIDを代表の値にして`openReportCaseDetail`で開く',
  ),
  admin('/auth/email-change/confirm', ['signed-out', 'error'], INVALID_LINK),
  admin('/auth/password-reset/confirm', ['signed-out', 'error'], INVALID_LINK),
  admin('/account/', ['with-data'], ADMIN_SIGN_IN),
  admin(
    '/accounts/',
    ['with-data', ...ROLE_STATES],
    `${ADMIN_SIGN_IN}。一覧の管理者は\`signInAsNewAdmin\`で作った自身を含む`,
  ),
  admin(
    '/audit-logs/',
    ['with-data'],
    `${ADMIN_SIGN_IN}。操作の記録は\`createCategory\`などの管理操作で作る`,
  ),
  admin(
    '/categories/',
    ['with-data', ...ROLE_STATES],
    '`createCategory`でカテゴリを1件以上作り、`CATEGORIES_PATH`で開く',
  ),
  admin(
    '/comments/',
    ['with-data', 'empty', ...ROLE_STATES],
    '`createModerationTargets`でコメントを作る。emptyは検索条件に一致しない語で絞り込む',
  ),
  admin(
    '/help-articles/',
    ['with-data', 'empty', ...ROLE_STATES],
    '`createHelpArticle`で記事を作り、`HELP_ARTICLES_PATH`で開く',
  ),
  admin(
    '/inquiries/',
    ['with-data', 'empty'],
    '`submitGuestInquiry`で問い合わせを送り、`INQUIRIES_PATH`で開く',
  ),
  admin(
    '/legal-documents/',
    ['with-data'],
    `${ADMIN_SIGN_IN}。種別ごとの一覧は文書の有無によらず表示する`,
  ),
  admin(
    '/media-moderation/',
    ['with-data', 'empty', ...ROLE_STATES],
    '`registerAutoQuarantinedAvatar`で隔離された画像を作り、`openAutoQuarantinedAvatar`で開く',
  ),
  admin('/products/', ['with-data'], '`registerProduct`でプロダクトを登録する'),
  admin(
    '/ratings/',
    ['with-data', 'empty', ...ROLE_STATES],
    '`createModerationTargets`で評価を作る',
  ),
  admin('/reports/', ['with-data', 'empty'], '`createReport`で通報を作る'),
  admin(
    '/settings/',
    ROLE_STATES,
    `${ADMIN_SIGN_IN}。送信者情報と訴求の設定は最上位管理者だけが編集でき、閲覧のみ・モデレーターには読み取りの表示になる(\`openSenderInfoSettings\`)`,
  ),
  admin(
    '/sponsorships/',
    ['with-data', 'empty'],
    '`createPaidSponsorship`で支払い済みの掲載を作り、`openAdminSponsorships`で開く',
  ),
  admin(
    '/users/',
    ['with-data', ...ROLE_STATES],
    '`registerVerifiedAccount`で利用者を作り、`searchUsersByEmail`で絞り込む',
  ),
  admin('/auth/password-reset/', ['signed-out'], NO_PREPARATION),
  admin(
    '/legal-documents/$kind/',
    ['with-data', ...ROLE_STATES],
    '種別(legal-notice・privacy・terms)の1つを代表の値にする。下書きの編集と公開は最上位管理者だけで、閲覧のみ・モデレーターには読み取りの表示になる',
  ),
  admin(
    '/legal-documents/$kind/revisions/$versionNumber',
    ['with-data'],
    '種別の代表の値で公開した版番号1を代表の値にする(`signInAsNewAdmin`の最上位管理者が公開する)',
  ),
];

export const ROUTE_INVENTORY: readonly RouteEntry[] = [
  ...CLIENT_ROUTES,
  ...ADMIN_ROUTES,
];

const FULL_PATHS_PATTERN = /\bfullPaths:\s*((?:\|?\s*'[^']*'\s*)+)/;

export function routeTreeFullPaths(routeTreeSource: string): readonly string[] {
  const union = FULL_PATHS_PATTERN.exec(routeTreeSource)?.[1];
  if (union === undefined) {
    throw new Error(
      'ルートの木の本文からfullPathsの型を読み取れません。生成の形式が変わった可能性があります。',
    );
  }
  const paths = [...union.matchAll(/'([^']*)'/g)].map(
    (match) => match[1] ?? '',
  );
  return [...new Set(paths)];
}

export function routesMissingFromInventory(
  app: RouteApp,
  routeTreeSource: string,
): readonly string[] {
  const inventoried = new Set(
    ROUTE_INVENTORY.filter((entry) => entry.app === app).map(
      (entry) => entry.path,
    ),
  );
  return routeTreeFullPaths(routeTreeSource).filter(
    (path) => !inventoried.has(path),
  );
}
