import { randomBytes } from 'node:crypto';

import { expect, type Locator, type Page } from '@playwright/test';

import { PRODUCT_CATEGORIES_TITLE } from '../../apps/admin/src/components/product/product-category-messages.ts';
import { QUALIFIER_SCHEDULE } from '../../apps/backend-lib/core/match/match-model.ts';
import {
  type BusinessTimeOfDay,
  toBusinessDateTime,
} from '../../apps/backend-lib/core/time/business-time.ts';
import {
  cancelUpvoteLabel,
  matchCardLabel,
  UPVOTE_DISABLED_REASONS,
  upvoteLabel,
  VOTE_UNIT,
} from '../../apps/client/src/components/match/match-card-messages.ts';
import {
  UPVOTE_CANCELLED_MESSAGE,
  UPVOTED_MESSAGE,
} from '../../apps/client/src/components/match/upvote-messages.ts';
import { AUTO_REFRESH_LABEL } from '../../apps/client/src/components/top/top-page-messages.ts';
import {
  LIVE_MATCH_BADGE,
  UNLISTED_BADGE,
} from '../../apps/client/src/components/upvote-history/upvote-history-messages.ts';
import { CATEGORIES_PATH, createCategory } from '../admin/category-steps.ts';
import {
  openFromAdminNavigation,
  signInAsNewAdmin,
} from '../support/admin-bootstrap.ts';
import { waitForBotToken } from '../support/bot-verification.ts';
import {
  REACTION_TIMEOUT_MS,
  RETRY_TIMEOUT_MS,
} from '../support/hydration-retry.ts';
import { executeLocalD1, sqlStringLiteral } from '../support/local-d1.ts';
import {
  addBusinessDays,
  businessDateOf,
  triggerScheduled,
} from '../support/scheduled-trigger.ts';
import { profilePath } from './profile-steps.ts';

export type MatchProductNames = readonly [string, string];

const TOP_PAGE_PATH = '/';

const UPVOTE_HISTORY_TAB = 'upvotes';

const MINUTES_PER_HOUR = 60;

// 1回の流れ(管理者の用意・3人の登録・2件のプロダクトの登録・Upvote)は10分弱かかるため、23:40の締め切りより前に終えられない時刻を避ける
const QUALIFIER_DEADLINE_MARGIN_MINUTES = 20;

// 通知は数秒で消える。同じ文言が続く操作で前の通知と取り違えないよう、前の通知が消えるのを待つ上限
const TOAST_DISMISS_TIMEOUT_MS = 15_000;

const minutesOf = ({ hour, minute }: BusinessTimeOfDay): number =>
  hour * MINUTES_PER_HOUR + minute;

const businessTimeText = ({ hour, minute }: BusinessTimeOfDay): string =>
  `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

const SKIP_FROM_MINUTES =
  minutesOf(QUALIFIER_SCHEDULE.fullTime) - QUALIFIER_DEADLINE_MARGIN_MINUTES;

// 業務時刻の締め切りの前の幅から業務日付の境界(24:00)までは、流れの途中でUpvoteの受け付けが終わるか業務日付が変わる
export function isNearQualifierFullTime(now: Date): boolean {
  return minutesOf(toBusinessDateTime(now)) >= SKIP_FROM_MINUTES;
}

export const QUALIFIER_FULL_TIME_SKIP_REASON = `業務時刻の${businessTimeText({
  hour: Math.floor(SKIP_FROM_MINUTES / MINUTES_PER_HOUR),
  minute: SKIP_FROM_MINUTES % MINUTES_PER_HOUR,
})}〜24:00は予選のUpvoteの締め切りと業務日付の境界に近く、流れの途中で受け付けが終わるため、マッチのE2Eを飛ばします`;

// (0)他のテストの残りのローンチが日付の経過で当日になり「その他」で組まれ得るため、自分の2つのローンチだけを置く専用のカテゴリを作る。カテゴリはハンドルの名前空間に関わるため、ローカルのD1へ直接入れず管理画面で作る
export async function createMatchCategory(page: Page): Promise<string> {
  const admin = await signInAsNewAdmin(page, { role: 'moderator' });
  await openFromAdminNavigation(page, admin, CATEGORIES_PATH);
  const suffix = randomBytes(6).toString('hex');
  const name = `E2Eマッチのカテゴリ${suffix}`;
  await createCategory(page, PRODUCT_CATEGORIES_TITLE, {
    name,
    handle: `e2e-match-${suffix}`,
  });
  return name;
}

// (1)画面では当日をローンチ日に選べないため、指定した2つのプロダクトの未確定のローンチ日だけを当日の業務日付へ書き換える
export async function moveLaunchesToDate(
  productHandles: readonly [string, string],
  businessDate: string,
): Promise<void> {
  const handles = productHandles.map((handle) => sqlStringLiteral(handle));
  const updated = await executeLocalD1(
    `UPDATE product_launches SET launch_date = ${sqlStringLiteral(businessDate)}, updated_at = ${String(Date.now())} WHERE outcome IS NULL AND cancelled_at IS NULL AND product_id IN (SELECT id FROM products WHERE handle IN (${handles.join(', ')}) AND deleted_at IS NULL) RETURNING id;`,
  );
  if (updated.length !== productHandles.length) {
    throw new Error(
      `ローンチ日を書き換えたローンチが${String(updated.length)}件でした。プロダクト(${productHandles.join(', ')})の未確定のローンチが1件ずつある必要があります`,
    );
  }
}

// (2)前日の23:45のジョブが当日の予選を組み、当日の0:00のジョブがマッチを開始する。ジョブの失敗も応答は成功になるため、結果はトップページの対戦カードで確かめる
export async function startQualifiers(businessDate: string): Promise<void> {
  await triggerScheduled({
    worker: 'api',
    businessDate: addBusinessDays(businessDate, -1),
    businessTime: businessTimeText(QUALIFIER_SCHEDULE.pairing),
  });
  await triggerScheduled({
    worker: 'api',
    businessDate,
    businessTime: businessTimeText(QUALIFIER_SCHEDULE.kickoff),
  });
}

export function todayBusinessDate(): string {
  return businessDateOf(new Date());
}

// 左右の並びはUpvote数とIDで決まるため、どちらの並びの名前でも探す
export const matchCardOf = (
  page: Page,
  [first, second]: MatchProductNames,
): Locator =>
  page
    .getByRole('article', { name: matchCardLabel(first, second), exact: true })
    .or(
      page.getByRole('article', {
        name: matchCardLabel(second, first),
        exact: true,
      }),
    );

// 対戦カードのUpvoteはハイドレーションの後に描かれるbot判定のウィジェットのトークンを使うため、トークンを待ってから操作する
export async function openTopPageMatch(
  page: Page,
  names: MatchProductNames,
): Promise<Locator> {
  await page.goto(TOP_PAGE_PATH);
  await waitForBotToken(page.locator('body'));
  const card = matchCardOf(page, names);
  await expect(
    card,
    `トップページに「${names[0]}」と「${names[1]}」の対戦カードがありません。2つのローンチが当日の予選で互いに組まれ開始されていません(APIサーバーの23:45のペアリングと0:00の開始のジョブのログを確かめてください)`,
  ).toBeVisible();
  return card;
}

const escapeRegExp = (text: string): string =>
  text.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);

// ボタンの名前は見えているUpvote数と単位を続け「<名称>にUpvote 12票」の形になる。数と単位は別の要素のため、ブラウザは間に空白を挟むことがある
const buttonNamePattern = (label: string, count?: number): RegExp =>
  new RegExp(
    `^${escapeRegExp(label)}\\s+${count === undefined ? '[\\d,]+' : String(count)}\\s*${escapeRegExp(VOTE_UNIT)}$`,
    'u',
  );

const upvoteButton = (card: Locator, name: string): Locator =>
  card.getByRole('button', { name: buttonNamePattern(upvoteLabel(name)) });

const cancelButton = (card: Locator, name: string): Locator =>
  card.getByRole('button', {
    name: buttonNamePattern(cancelUpvoteLabel(name)),
  });

export async function expectUpvoteState(
  card: Locator,
  name: string,
  state: { readonly count: number; readonly upvoted: boolean },
): Promise<void> {
  const label = state.upvoted ? cancelUpvoteLabel(name) : upvoteLabel(name);
  await expect(
    card.getByRole('button', { name: buttonNamePattern(label, state.count) }),
  ).toHaveAttribute('aria-pressed', String(state.upvoted));
}

// 押下が効くまでは押す前の名前のボタンが残るため、そのボタンが見えている間だけ押し直す。表示はサーバーの結果でだけ変わるため、送信中の押下は部品が無視する
async function pressUntilNotified(
  page: Page,
  button: Locator,
  message: string,
): Promise<void> {
  const toast = page.getByText(message, { exact: true });
  await expect(toast).toHaveCount(0, { timeout: TOAST_DISMISS_TIMEOUT_MS });
  await expect(async () => {
    if (!(await toast.isVisible()) && (await button.isVisible())) {
      await button.click({ timeout: REACTION_TIMEOUT_MS });
    }
    await expect(toast).toBeVisible({ timeout: REACTION_TIMEOUT_MS });
  }).toPass({ timeout: RETRY_TIMEOUT_MS });
}

// (3)まだUpvoteしていない側を押すと、Upvoteか、別の側からの付け替えになる
export async function upvoteEntry(
  page: Page,
  card: Locator,
  name: string,
): Promise<void> {
  await pressUntilNotified(page, upvoteButton(card, name), UPVOTED_MESSAGE);
}

export async function cancelUpvote(
  page: Page,
  card: Locator,
  name: string,
): Promise<void> {
  await pressUntilNotified(
    page,
    cancelButton(card, name),
    UPVOTE_CANCELLED_MESSAGE,
  );
}

// 投稿者には自分の側のボタンが無く、相手の側のボタンは押せない理由を説明とツールチップで示す
export async function expectOwnMatchRestriction(
  page: Page,
  card: Locator,
  own: string,
  opponent: string,
): Promise<void> {
  await expect(
    card.getByRole('button', { name: new RegExp(escapeRegExp(own), 'u') }),
  ).toHaveCount(0);
  const button = upvoteButton(card, opponent);
  const reason = UPVOTE_DISABLED_REASONS.OWN_MATCH;
  await expect(button).toHaveAttribute('aria-disabled', 'true');
  await expect(button).toHaveAccessibleDescription(reason);
  const tooltip = page.getByRole('tooltip');
  await expect(async () => {
    await button.hover({ timeout: REACTION_TIMEOUT_MS });
    await expect(tooltip).toHaveText(reason, { timeout: REACTION_TIMEOUT_MS });
  }).toPass({ timeout: RETRY_TIMEOUT_MS });
}

export async function expectAutoRefreshSwitch(page: Page): Promise<void> {
  await expect(
    page.getByRole('switch', { name: AUTO_REFRESH_LABEL, exact: true }),
  ).toBeChecked();
}

// (4)公開プロフィールのUpvote履歴に、未掲載のプロダクトの項目がマッチ中として出る
export async function expectLiveUpvoteHistoryItem(
  page: Page,
  handle: string,
  productName: string,
): Promise<void> {
  await page.goto(`${profilePath(handle)}?tab=${UPVOTE_HISTORY_TAB}`);
  const item = page.getByRole('article', { name: productName, exact: true });
  await expect(item).toBeVisible();
  await expect(item.getByText(UNLISTED_BADGE, { exact: true })).toBeVisible();
  await expect(item.getByText(LIVE_MATCH_BADGE, { exact: true })).toBeVisible();
}
