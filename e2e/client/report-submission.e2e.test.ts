import { randomBytes } from 'node:crypto';

import {
  REPORT_CATEGORY_INFRINGEMENT_ID,
  REPORT_CATEGORY_INFRINGEMENT_NAME,
  REPORT_CATEGORY_OTHER_ID,
  REPORT_CATEGORY_OTHER_NAME,
} from '../../apps/common-lib/reporting/report-rules.ts';
import { createListedProducts } from '../support/directory-fixtures.ts';
import { createModerationTargets } from '../support/moderation-fixtures.ts';
import { findUserIdByEmail } from '../support/notification-fixtures.ts';
import {
  findOpenReportCaseId,
  readReportCaseState,
} from '../support/report-fixtures.ts';
import { TEST_EMAIL_DOMAIN } from '../support/test-email.ts';
import {
  createTestAccount,
  MAIL_FLOW_TIMEOUT_MS,
  type TestAccount,
} from './auth/account-steps.ts';
import { expect, test } from './auth/auth-test.ts';
import {
  commentArticleOf,
  expectOwnProductRatingNotice,
  launchCommentsSectionOf,
  openEngagementProductPage,
  postComment,
  transferProductOwnership,
} from './engagement-steps.ts';
import {
  openProfileEditor,
  openPublicProfile,
  readCurrentHandle,
  registerVerifiedAccount,
} from './profile-steps.ts';
import {
  contactEmailField,
  expectContactEmailRequired,
  expectNoCommentReportAction,
  expectNoProfileReportAction,
  expectNoProductReportAction,
  openCommentReportForm,
  openProductReportForm,
  openProfileReportForm,
  submitReportForm,
} from './report-steps.ts';

// 登録のメールの待ちに、通報の操作の分を足す
test.describe.configure({ timeout: MAIL_FLOW_TIMEOUT_MS * 2 });

const suffixOf = (): string => randomBytes(4).toString('hex');

async function registerUser(
  page: Parameters<typeof registerVerifiedAccount>[0],
): Promise<TestAccount> {
  const account = createTestAccount();
  await registerVerifiedAccount(page, account);
  return account;
}

async function createListedProduct(): Promise<{
  readonly handle: string;
  readonly name: string;
}> {
  const {
    products: [product],
  } = await createListedProducts({ count: 1 });
  if (product === undefined) {
    throw new Error('掲載中のプロダクトを作れませんでした');
  }
  return product;
}

// 掲載中のプロダクトとコメントはローカルのD1へ直接作り、受け付けた通報もローカルのD1で確かめるため、@smokeタグを付けない
test.describe('通報の送信(利用者側)', () => {
  test('未ログインでプロダクトを「権利侵害」で通報すると連絡先メールアドレスが必須になり、入力すると受け付けられて連絡先付きの通報が案件に入る', async ({
    page,
  }) => {
    const product = await createListedProduct();
    const contactEmail = `e2e-rights-${suffixOf()}@${TEST_EMAIL_DOMAIN}`;
    const reason = `E2Eの権利侵害の申出${suffixOf()}です。私が撮影した写真が無断で使われています。`;

    await openEngagementProductPage(page, product);
    const form = await openProductReportForm(page);
    await expect(contactEmailField(form)).toHaveCount(0);

    await expectContactEmailRequired(form, {
      categoryName: REPORT_CATEGORY_INFRINGEMENT_NAME,
      reason,
    });

    await submitReportForm(page, form, {
      categoryName: REPORT_CATEGORY_INFRINGEMENT_NAME,
      reason,
      contactEmail,
    });

    const caseId = await findOpenReportCaseId({
      kind: 'product',
      productHandle: product.handle,
    });
    const state = await readReportCaseState(caseId);
    expect(state.status).toBe('open');
    expect(state.infringementReported).toBe(true);
    expect(state.reports).toStrictEqual([
      expect.objectContaining({
        reporterUserId: null,
        contactEmail,
        categoryId: REPORT_CATEGORY_INFRINGEMENT_ID,
        categoryName: REPORT_CATEGORY_INFRINGEMENT_NAME,
      }),
    ]);
  });

  test('ログイン中の利用者は他者の公開プロフィールとコメントを通報でき、「権利侵害」を選んでも連絡先を求められず、通報者として記録される', async ({
    page,
  }) => {
    const targets = await createModerationTargets();
    const member = await registerUser(page);
    const memberId = await findUserIdByEmail(member.email);
    const { author } = targets.comment;

    await openPublicProfile(page, author.handle);
    const profileForm = await openProfileReportForm(page, author.nickname);
    await submitReportForm(page, profileForm, {
      categoryName: REPORT_CATEGORY_OTHER_NAME,
      reason: `E2Eのプロフィールの通報${suffixOf()}です。`,
    });

    await openEngagementProductPage(page, {
      handle: targets.productHandle,
      name: targets.productName,
    });
    const commentForm = await openCommentReportForm(
      page,
      commentArticleOf(
        launchCommentsSectionOf(page),
        author.nickname,
        targets.comment.body,
      ),
    );
    await submitReportForm(page, commentForm, {
      categoryName: REPORT_CATEGORY_INFRINGEMENT_NAME,
      reason: `E2Eのコメントの権利侵害の申出${suffixOf()}です。`,
    });

    const userCase = await readReportCaseState(
      await findOpenReportCaseId({ kind: 'user', userHandle: author.handle }),
    );
    expect(userCase.reports).toStrictEqual([
      expect.objectContaining({
        reporterUserId: memberId,
        contactEmail: null,
        categoryId: REPORT_CATEGORY_OTHER_ID,
      }),
    ]);
    const commentCase = await readReportCaseState(
      await findOpenReportCaseId({
        kind: 'comment',
        commentId: targets.comment.commentId,
      }),
    );
    expect(commentCase.infringementReported).toBe(true);
    expect(commentCase.reports).toStrictEqual([
      expect.objectContaining({
        reporterUserId: memberId,
        contactEmail: null,
        categoryId: REPORT_CATEGORY_INFRINGEMENT_ID,
      }),
    ]);
  });

  test('自分の公開プロフィール・プロダクト・コメントには通報の操作が無い', async ({
    page,
  }) => {
    const product = await createListedProduct();
    const member = await registerUser(page);
    await transferProductOwnership(product.handle, member.email);

    const handle = await readCurrentHandle(
      await openProfileEditor(page, member),
    );
    await openPublicProfile(page, handle);
    await expectNoProfileReportAction(page, member.nickname);

    await openEngagementProductPage(page, product);
    await expectOwnProductRatingNotice(page);
    await expectNoProductReportAction(page);

    const ownComment = await postComment(
      page,
      `E2Eの自分のコメント${suffixOf()}`,
    );
    await expectNoCommentReportAction(page, ownComment);
  });
});
