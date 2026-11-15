import { randomBytes } from 'node:crypto';

import type { BrowserContext, Page } from '@playwright/test';

import {
  fromBusinessDateTime,
  parseBusinessDate,
} from '../../apps/backend-lib/core/time/business-time.ts';
import {
  RATED_MESSAGE,
  RATING_CANCELLED_MESSAGE,
  RATING_CHANGED_MESSAGE,
} from '../../apps/client/src/components/engagement/rating-messages.ts';
import { assumeDistinctClientIp } from '../support/client-ip.ts';
import { createListedProducts } from '../support/directory-fixtures.ts';
import { findUserIdByEmail } from '../support/notification-fixtures.ts';
import {
  addBusinessDays,
  businessDateOf,
  triggerScheduled,
} from '../support/scheduled-trigger.ts';
import {
  createTestAccount,
  logoutFromUserMenu,
  MAIL_FLOW_TIMEOUT_MS,
  type TestAccount,
} from './auth/account-steps.ts';
import { expect, test as base } from './auth/auth-test.ts';
import {
  appendToComment,
  cancelRatingFromSection,
  commentArticleOf,
  deleteComment,
  type EngagementProduct,
  expectDirectoryCommentCount,
  expectGuestPrompts,
  expectNoRatings,
  expectOwnProductRatingNotice,
  expectRatingSummary,
  expectRemovedComment,
  launchCommentsSectionOf,
  moveCommentDeletion,
  openEngagementProductPage,
  postComment,
  rateFromSection,
  readProductComments,
  replyButtonOf,
  replyToComment,
  transferProductOwnership,
} from './engagement-steps.ts';
import { registerVerifiedAccount } from './profile-steps.ts';

interface UserPageFixtures {
  // 2人の利用者を並べる流れのため、呼ぶたびに別の接続元を名乗る別のブラウザの文脈で開く。開いた文脈はテストの終わりに閉じる
  readonly openUserPage: () => Promise<Page>;
}

const test = base.extend<UserPageFixtures>({
  openUserPage: async ({ browser, baseURL }, use) => {
    const contexts: BrowserContext[] = [];
    try {
      await use(async () => {
        const context = await browser.newContext({ baseURL });
        contexts.push(context);
        await assumeDistinctClientIp(context, baseURL);
        return context.newPage();
      });
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  },
});

// 2人の登録のメールの待ちに、コメントと評価の操作の分を足す
test.describe.configure({ timeout: MAIL_FLOW_TIMEOUT_MS * 3 });

const ANONYMIZATION_TIME = '04:21';

// 匿名化のジョブは業務日付の12日前の0:00より前に削除したコメントを匿名化する
const ANONYMIZED_DAYS_BEFORE = 13;
const KEPT_DAYS_BEFORE = 12;

const START_OF_DAY = { hour: 0, minute: 0 } as const;

const ANONYMIZATION_TIMEOUT_MS = 30_000;

const suffixOf = (): string => randomBytes(4).toString('hex');

async function createCommentableProduct(): Promise<{
  readonly product: EngagementProduct;
  readonly matchDate: string;
}> {
  const listed = await createListedProducts({ count: 1 });
  const [product] = listed.products;
  if (product === undefined) {
    throw new Error('掲載中のプロダクトを作れませんでした');
  }
  return { product, matchDate: listed.matchDate };
}

async function registerUser(page: Page): Promise<TestAccount> {
  const account = createTestAccount();
  await registerVerifiedAccount(page, account);
  return account;
}

const startOfBusinessDaysBefore = (date: string, days: number): Date =>
  fromBusinessDateTime(
    parseBusinessDate(addBusinessDays(date, -days)),
    START_OF_DAY,
  );

// 掲載中のプロダクトと確定した予選のローンチはローカルのD1へ直接作り、匿名化は定期実行の起動で起こすため、@smokeタグを付けない
test.describe('コメントと評価', () => {
  test('評価を添えたコメントに投稿者が第3階層まで返信し、編集で「(編集済み)」、削除で置き換え表示になっても返信が残り、評価欄の変更と取消で平均値と件数が変わり、投稿者本人には評価できない旨、未ログインの閲覧者にはログインへの導線が出て、ディレクトリの項目にコメント数が出る', async ({
    page,
    openUserPage,
  }) => {
    const { product, matchDate } = await createCommentableProduct();
    const memberPage = page;
    const ownerPage = await openUserPage();
    const member = await registerUser(memberPage);
    const owner = await registerUser(ownerPage);
    await transferProductOwnership(product.handle, owner.email);

    const suffix = suffixOf();
    const topBody = `E2Eのコメント${suffix}`;
    const firstReplyBody = `E2Eの投稿者の返信${suffix}`;
    const secondReplyBody = `E2Eの第3階層の返信${suffix}`;
    const addition = `(追記${suffix})`;

    await openEngagementProductPage(memberPage, product);
    await expectNoRatings(memberPage);
    const topArticle = await postComment(memberPage, topBody, 4);
    await expectRatingSummary(memberPage, { average: '4.0', count: 1 });

    await openEngagementProductPage(ownerPage, product);
    await expectOwnProductRatingNotice(ownerPage);
    await expectRatingSummary(ownerPage, { average: '4.0', count: 1 });
    const ownerSection = launchCommentsSectionOf(ownerPage);
    const ownerTopArticle = commentArticleOf(
      ownerSection,
      member.nickname,
      topBody,
    );
    await replyToComment(ownerPage, ownerTopArticle, firstReplyBody);
    const firstReply = commentArticleOf(
      ownerSection,
      owner.nickname,
      firstReplyBody,
    );
    await expect(replyButtonOf(firstReply)).toBeVisible();
    await replyToComment(ownerPage, firstReply, secondReplyBody);
    const secondReply = commentArticleOf(
      ownerSection,
      owner.nickname,
      secondReplyBody,
    );
    await expect(secondReply).toBeVisible();
    await expect(replyButtonOf(secondReply)).toHaveCount(0);

    await appendToComment(memberPage, topArticle, addition);
    await expect(topArticle).toContainText(`${topBody}${addition}`);

    await rateFromSection(memberPage, 2, RATING_CHANGED_MESSAGE);
    await expectRatingSummary(memberPage, { average: '2.0', count: 1 });
    await cancelRatingFromSection(memberPage, RATING_CANCELLED_MESSAGE);
    await expectNoRatings(memberPage);
    await rateFromSection(memberPage, 5, RATED_MESSAGE);
    await expectRatingSummary(memberPage, { average: '5.0', count: 1 });

    await deleteComment(memberPage, topArticle);
    const memberSection = launchCommentsSectionOf(memberPage);
    await expectRemovedComment(memberSection);
    await expect(topArticle).toHaveCount(0);
    await memberPage.reload();
    await expectRemovedComment(memberSection);
    await expect(
      commentArticleOf(memberSection, owner.nickname, firstReplyBody),
    ).toBeVisible();
    await expect(
      commentArticleOf(memberSection, owner.nickname, secondReplyBody),
    ).toBeVisible();

    await logoutFromUserMenu(memberPage, member);
    await openEngagementProductPage(memberPage, product);
    await expectGuestPrompts(memberPage);
    await expectRatingSummary(memberPage, { average: '5.0', count: 1 });

    // 削除したコメントは数えず、投稿者の2件の返信だけを数える
    await expectDirectoryCommentCount(memberPage, matchDate, product.name, 2);
  });

  test('業務日付の13日前の0:00に削除したコメントは4:21のジョブで本文と投稿者の紐付けが消え、12日前の0:00に削除したコメントは変わらない', async ({
    page,
  }) => {
    const { product } = await createCommentableProduct();
    const member = await registerUser(page);
    const memberId = await findUserIdByEmail(member.email);
    const suffix = suffixOf();
    const anonymizedBody = `E2Eの匿名化するコメント${suffix}`;
    const keptBody = `E2Eの残すコメント${suffix}`;

    await openEngagementProductPage(page, product);
    const anonymizedArticle = await postComment(page, anonymizedBody);
    const keptArticle = await postComment(page, keptBody);
    await deleteComment(page, anonymizedArticle);
    await deleteComment(page, keptArticle);

    const comments = await readProductComments(product.handle);
    expect(comments).toHaveLength(2);
    const [anonymized, kept] = comments;
    if (anonymized === undefined || kept === undefined) {
      throw new Error('削除したコメントが見つかりません');
    }
    expect(anonymized).toMatchObject({ authorUserId: memberId });
    expect(kept).toMatchObject({ authorUserId: memberId });

    const businessDate = businessDateOf(new Date());
    await moveCommentDeletion(
      anonymized.id,
      startOfBusinessDaysBefore(businessDate, ANONYMIZED_DAYS_BEFORE),
    );
    await moveCommentDeletion(
      kept.id,
      startOfBusinessDaysBefore(businessDate, KEPT_DAYS_BEFORE),
    );
    await triggerScheduled({
      worker: 'api',
      businessDate,
      businessTime: ANONYMIZATION_TIME,
    });

    await expect
      .poll(async () => readProductComments(product.handle), {
        message:
          '4:21の匿名化のジョブの後に、13日前の0:00に削除したコメントだけが匿名化され12日前の0:00に削除したコメントが変わらない状態になりません。APIサーバーのログを確かめてください',
        timeout: ANONYMIZATION_TIMEOUT_MS,
      })
      .toEqual([{ id: anonymized.id, body: '', authorUserId: null }, kept]);
  });
});
