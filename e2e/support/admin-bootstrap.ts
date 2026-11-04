import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { expect, type Locator, type Page } from '@playwright/test';

import {
  ADMIN_ROLE_LABELS,
  type AdminRole,
} from '../../apps/common-lib/admin/admin-roles.ts';
import {
  EMAIL_LABEL,
  INVITATION_COMPLETE_SUBMIT_LABEL,
  INVITATION_COMPLETED_MESSAGE,
  INVITATION_PROFILE_FORM_LABEL,
  INVITATION_PROFILE_SUBMIT_LABEL,
  LOGIN_PAGE_TITLE,
  LOGIN_SUBMIT_LABEL,
  NICKNAME_LABEL,
  PASSWORD_LABEL,
  PROCEED_TO_DASHBOARD_LABEL,
  RECOVERY_CODE_LABEL,
  REQUIRED_SUFFIX,
  SECOND_FACTOR_FORM_LABEL,
  TOTP_CODE_LABEL,
  TOTP_SETUP_HEADING,
  USE_RECOVERY_CODE_LABEL,
} from '../../apps/admin/src/components/auth/admin-auth-messages.ts';
import { DASHBOARD_TITLE } from '../../apps/admin/src/components/dashboard/dashboard-messages.ts';
import {
  ADMIN_LOGGED_OUT_MESSAGE,
  ADMIN_LOGOUT_LABEL,
  ADMIN_NAVIGATION_LABEL,
} from '../../apps/admin/src/components/layout/admin-shell-messages.ts';
import { ADMIN_NAV_ITEMS } from '../../apps/admin/src/composition/admin-navigation.ts';
import { RECOVERY_CODES_LABEL } from '../../apps/frontend-lib/utilities/messages/auth-messages.ts';
import {
  type IssuedSuperAdminInvitation,
  parseSuperAdminInvitationOutput,
  readAdminIds,
  readSingleAdminId,
  superAdminInvitationArgs,
} from './admin-bootstrap-parsing.ts';
import { waitForBotToken } from './bot-verification.ts';
import { REACTION_TIMEOUT_MS, RETRY_TIMEOUT_MS } from './hydration-retry.ts';
import { executeLocalD1, sqlStringLiteral } from './local-d1.ts';
import { TEST_EMAIL_DOMAIN } from './test-email.ts';
import { createTotpCodeSource, type TotpCodeSource } from './totp.ts';

export type { IssuedSuperAdminInvitation } from './admin-bootstrap-parsing.ts';
export { currentTotpCode } from './totp.ts';

export interface AdminProfileInput {
  readonly nickname: string;
  readonly password: string;
}

export interface CompletedAdminInvitation extends AdminProfileInput {
  // 招待の完了の画面の手入力用の文字列
  readonly totpSecret: string;
  // 招待の完了の画面でだけ表示されたリカバリコード
  readonly recoveryCodes: readonly string[];
}

export interface BootstrappedAdmin extends CompletedAdminInvitation {
  readonly adminId: string;
  readonly email: string;
  readonly role: AdminRole;
}

export const ISSUED_RECOVERY_CODE_COUNT = 10;

// 招待の発行コマンドとローカルのD1の操作がそれぞれ数秒かかり、認証コードの時間窓が切り替わるまで最大30秒待つことがあるため、既定の30秒では足りない
export const ADMIN_FLOW_TIMEOUT_MS = 180_000;

const API_DIR = join(import.meta.dirname, '..', '..', 'apps', 'api');

const SUPER_ADMIN_ROLE = sqlStringLiteral('super_admin');

const MODERATOR_ROLE = sqlStringLiteral('moderator');

const ACTIVE_STATUS = sqlStringLiteral('active');

const runFile = promisify(execFile);

// 前のテストや前回の実行の管理者・メールと衝突せず、漏洩パスワードの照合にも当たらないよう、実行ごとに乱数から作る
export function createAdminEmail(): string {
  return `e2e-${randomBytes(8).toString('hex')}@${TEST_EMAIL_DOMAIN}`;
}

export function createAdminProfile(): AdminProfileInput {
  return {
    nickname: `E2E管理者${randomBytes(3).toString('hex')}`,
    password: randomBytes(18).toString('base64url'),
  };
}

// サーバーは同じ管理者が使った時間窓とそれより前の時間窓を拒否するため、同じ秘密鍵の認証コードはテストの中で1つの発生源から得る
const totpSources = new Map<string, TotpCodeSource>();

const totpSourceOf = (secret: string): TotpCodeSource => {
  const existing = totpSources.get(secret);
  if (existing !== undefined) {
    return existing;
  }
  const created = createTotpCodeSource(secret);
  totpSources.set(secret, created);
  return created;
};

export function nextTotpCode(
  admin: Pick<CompletedAdminInvitation, 'totpSecret'>,
): Promise<string> {
  return totpSourceOf(admin.totpSecret).nextCode();
}

// 設定し直すとサーバーは使用済みの時間窓を確定に使った時間窓で上書きし、前の秘密鍵の時間窓とは比べない。前の秘密鍵で使った時間窓と同じか前の時間窓の認証コードを送らないよう、新しい秘密鍵の発生源はその後から始める
export function withTotpSecret<TAdmin extends BootstrappedAdmin>(
  admin: TAdmin,
  totpSecret: string,
): TAdmin {
  const usedStep = totpSourceOf(admin.totpSecret).lastUsedStep();
  totpSources.set(
    totpSecret,
    createTotpCodeSource(totpSecret, undefined, usedStep),
  );
  return { ...admin, totpSecret };
}

const errorOutputOf = (error: unknown): string => {
  if (typeof error !== 'object' || error === null) {
    return String(error);
  }
  const stderr: unknown = Reflect.get(error, 'stderr');
  const stdout: unknown = Reflect.get(error, 'stdout');
  return [stdout, stderr]
    .filter((text): text is string => typeof text === 'string')
    .map((text) => text.trim())
    .filter((text) => text !== '')
    .join('\n');
};

// 招待の発行コマンドはペッパーを環境変数から読むため、E2Eテストのコマンドへ注入されたシークレットをそのまま引き継ぐ
export async function issueSuperAdminInvitation(
  email: string,
): Promise<IssuedSuperAdminInvitation> {
  let stdout: string;
  try {
    ({ stdout } = await runFile('bun', [...superAdminInvitationArgs(email)], {
      cwd: API_DIR,
    }));
  } catch (error) {
    throw new Error(
      `招待の発行コマンドが失敗しました。\n${errorOutputOf(error)}`,
      { cause: error },
    );
  }
  return parseSuperAdminInvitationOutput(stdout);
}

export async function findAdminIdByEmail(email: string): Promise<string> {
  return readSingleAdminId(
    await executeLocalD1(
      `SELECT id FROM admins WHERE email = ${sqlStringLiteral(email)};`,
    ),
    email,
  );
}

// ロールは要求ごとに保存済みの値から読まれるため、次の要求から反映される
export async function setAdminRole(
  adminId: string,
  role: AdminRole,
): Promise<void> {
  const updated = await executeLocalD1(
    `UPDATE admins SET role = ${sqlStringLiteral(role)} WHERE id = ${sqlStringLiteral(adminId)} AND status = ${ACTIVE_STATUS} RETURNING id;`,
  );
  if (readAdminIds(updated).length !== 1) {
    throw new Error(
      `ローカルのD1で有効な管理者${adminId}のロールを変えられませんでした`,
    );
  }
}

// 最後の最上位管理者の保護は有効な全ての最上位管理者を数えるため、前のテスト・前回の実行・開発者が用意した最上位管理者をこの間だけモデレーターにし、終わったら戻す
export async function withSoleActiveSuperAdmin<T>(
  admin: Pick<BootstrappedAdmin, 'adminId'>,
  action: () => Promise<T>,
): Promise<T> {
  const demoted = readAdminIds(
    await executeLocalD1(
      `UPDATE admins SET role = ${MODERATOR_ROLE} WHERE role = ${SUPER_ADMIN_ROLE} AND status = ${ACTIVE_STATUS} AND id <> ${sqlStringLiteral(admin.adminId)} RETURNING id;`,
    ),
  );
  try {
    return await action();
  } finally {
    if (demoted.length > 0) {
      await restoreSuperAdmins(demoted);
    }
  }
}

// 戻せなかった時に手作業で戻せるよう、モデレーターにしたままの管理者のIDを示して失敗する
async function restoreSuperAdmins(adminIds: readonly string[]): Promise<void> {
  try {
    await executeLocalD1(
      `UPDATE admins SET role = ${SUPER_ADMIN_ROLE} WHERE role = ${MODERATOR_ROLE} AND id IN (${adminIds.map(sqlStringLiteral).join(', ')});`,
    );
  } catch (error) {
    throw new Error(
      `一時的にモデレーターにした最上位管理者を戻せませんでした: ${adminIds.join(', ')}`,
      { cause: error },
    );
  }
}

export const accountMenuButton = (
  page: Page,
  admin: Pick<AdminProfileInput, 'nickname'>,
): Locator =>
  page.getByRole('banner').getByRole('button', { name: admin.nickname });

export const loginForm = (page: Page): Locator =>
  page.getByRole('form', { name: LOGIN_PAGE_TITLE });

export const secondFactorForm = (page: Page): Locator =>
  page.getByRole('form', { name: SECOND_FACTOR_FORM_LABEL });

export const recoveryCodeItems = (scope: Page | Locator): Locator =>
  scope.getByRole('list', { name: RECOVERY_CODES_LABEL }).getByRole('listitem');

export async function expectDashboard(
  page: Page,
  admin: Pick<AdminProfileInput, 'nickname'>,
): Promise<void> {
  await expect(
    page.getByRole('heading', { level: 1, name: DASHBOARD_TITLE }),
  ).toBeVisible();
  await expect(accountMenuButton(page, admin)).toBeVisible();
}

// 招待のリンクのトークンはフラグメントで渡り、画面はハイドレーションの後に読み取ってからフォームを描くため、フォームが現れてから入力する
export async function completeAdminInvitation(
  page: Page,
  link: string,
  profile: AdminProfileInput = createAdminProfile(),
): Promise<CompletedAdminInvitation> {
  await page.goto(link);
  const profileForm = page.getByRole('form', {
    name: INVITATION_PROFILE_FORM_LABEL,
  });
  await profileForm
    .getByLabel(`${NICKNAME_LABEL}${REQUIRED_SUFFIX}`, { exact: true })
    .fill(profile.nickname);
  await profileForm
    .getByLabel(`${PASSWORD_LABEL}${REQUIRED_SUFFIX}`, { exact: true })
    .fill(profile.password);
  await profileForm
    .getByRole('button', { name: INVITATION_PROFILE_SUBMIT_LABEL })
    .click();

  const totpStep = page.getByRole('region', { name: TOTP_SETUP_HEADING });
  const totpSecret = await totpStep.locator('code').innerText();
  const totpForm = totpStep.getByRole('form', {
    name: SECOND_FACTOR_FORM_LABEL,
  });
  await totpForm
    .getByLabel(`${TOTP_CODE_LABEL}${REQUIRED_SUFFIX}`, { exact: true })
    .fill(await nextTotpCode({ totpSecret }));
  await totpForm
    .getByRole('button', { name: INVITATION_COMPLETE_SUBMIT_LABEL })
    .click();

  await expect(page.getByText(INVITATION_COMPLETED_MESSAGE)).toBeVisible();
  const items = recoveryCodeItems(page);
  await expect(items).toHaveCount(ISSUED_RECOVERY_CODE_COUNT);
  const recoveryCodes = await items.allInnerTexts();
  await page.getByRole('link', { name: PROCEED_TO_DASHBOARD_LABEL }).click();
  await expectDashboard(page, profile);
  return { ...profile, totpSecret, recoveryCodes };
}

export async function expectAdminRole(
  page: Page,
  admin: Pick<BootstrappedAdmin, 'nickname' | 'role'>,
): Promise<void> {
  await expect(accountMenuButton(page, admin)).toContainText(
    ADMIN_ROLE_LABELS[admin.role],
  );
}

// 招待の発行コマンドで最上位管理者として招待し、画面で完了させてから、ロールをローカルのD1で設定する。返す時のpageは、そのロールでログインしたダッシュボードにある
export async function signInAsNewAdmin(
  page: Page,
  options: { readonly role: AdminRole },
): Promise<BootstrappedAdmin> {
  const email = createAdminEmail();
  const { link } = await issueSuperAdminInvitation(email);
  const adminId = await findAdminIdByEmail(email);
  const completed = await completeAdminInvitation(page, link);
  if (options.role !== 'super_admin') {
    await setAdminRole(adminId, options.role);
    await page.reload();
    await expectDashboard(page, completed);
  }
  const admin: BootstrappedAdmin = {
    ...completed,
    adminId,
    email,
    role: options.role,
  };
  await expectAdminRole(page, admin);
  return admin;
}

export async function submitAdminCredentials(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  const form = loginForm(page);
  await waitForBotToken(form);
  await form.getByLabel(EMAIL_LABEL, { exact: true }).fill(email);
  await form.getByLabel(PASSWORD_LABEL, { exact: true }).fill(password);
  await form.getByRole('button', { name: LOGIN_SUBMIT_LABEL }).click();
}

export async function startAdminLogin(
  page: Page,
  admin: Pick<BootstrappedAdmin, 'email' | 'password'>,
): Promise<Locator> {
  await page.goto('/auth/login');
  await submitAdminCredentials(page, admin.email, admin.password);
  const form = secondFactorForm(page);
  await expect(form).toBeVisible();
  return form;
}

// ログアウトした後やセッションが無効になった後に、メールアドレス・パスワード・認証コードでログインし直す
export async function signInAdmin(
  page: Page,
  admin: BootstrappedAdmin,
): Promise<void> {
  const form = await startAdminLogin(page, admin);
  await form
    .getByLabel(TOTP_CODE_LABEL, { exact: true })
    .fill(await nextTotpCode(admin));
  await form.getByRole('button', { name: LOGIN_SUBMIT_LABEL }).click();
  await expectDashboard(page, admin);
}

export async function signInAdminWithRecoveryCode(
  page: Page,
  admin: BootstrappedAdmin,
  recoveryCode: string,
): Promise<void> {
  const form = await startAdminLogin(page, admin);
  await form.getByRole('button', { name: USE_RECOVERY_CODE_LABEL }).click();
  await form
    .getByLabel(RECOVERY_CODE_LABEL, { exact: true })
    .fill(recoveryCode);
  await form.getByRole('button', { name: LOGIN_SUBMIT_LABEL }).click();
  await expectDashboard(page, admin);
}

export async function chooseAccountMenuItem(
  page: Page,
  admin: Pick<AdminProfileInput, 'nickname'>,
  item: Locator,
): Promise<void> {
  await expect(async () => {
    if (!(await item.isVisible())) {
      await accountMenuButton(page, admin).click();
    }
    await expect(item).toBeVisible({ timeout: REACTION_TIMEOUT_MS });
  }).toPass({ timeout: RETRY_TIMEOUT_MS });
  await item.click();
}

export async function signOutAdmin(
  page: Page,
  admin: Pick<AdminProfileInput, 'nickname'>,
): Promise<void> {
  await chooseAccountMenuItem(
    page,
    admin,
    page.getByRole('menuitem', { name: ADMIN_LOGOUT_LABEL }),
  );
  await expect(page.getByText(ADMIN_LOGGED_OUT_MESSAGE)).toBeVisible();
  await expect(accountMenuButton(page, admin)).toHaveCount(0);
}

const navLabelOf = (path: string): string => {
  const item = ADMIN_NAV_ITEMS.find(({ to }) => to === path);
  if (item === undefined) {
    throw new Error(`管理メニューに${path}の項目がありません`);
  }
  return item.label;
};

// bot判定のウィジェットを持たないフォームはハイドレーションの完了を待つ手掛かりが無いため、開閉にハイドレーションを要するアカウントのメニューを一度開いて閉じてから、管理メニューのリンクのルーターの遷移で開く
export async function openFromAdminNavigation(
  page: Page,
  admin: Pick<AdminProfileInput, 'nickname'>,
  path: string,
): Promise<void> {
  const menu = page.getByRole('menu');
  await expect(async () => {
    if (!(await menu.isVisible())) {
      await accountMenuButton(page, admin).click();
    }
    await expect(menu).toBeVisible({ timeout: REACTION_TIMEOUT_MS });
  }).toPass({ timeout: RETRY_TIMEOUT_MS });
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await page
    .getByRole('navigation', { name: ADMIN_NAVIGATION_LABEL })
    .getByRole('link', { name: navLabelOf(path), exact: true })
    .click();
  await expect(page).toHaveURL(path);
}
