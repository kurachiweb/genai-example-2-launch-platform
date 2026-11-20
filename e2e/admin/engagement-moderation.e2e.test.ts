import {
  ADMIN_FLOW_TIMEOUT_MS,
  signInAsNewAdmin,
} from '../support/admin-bootstrap.ts';
import {
  createModerationTargets,
  readModerationTargetsState,
} from '../support/moderation-fixtures.ts';
import {
  commentArticleOf,
  expectRatingSummary,
  expectRemovedComment,
  launchCommentsSectionOf,
  openEngagementProductPage,
} from '../client/engagement-steps.ts';
import { expect, test } from './client-page-test.ts';
import {
  hideCommentFromList,
  invalidateRatingFromList,
} from './engagement-moderation-steps.ts';

test.describe.configure({ timeout: ADMIN_FLOW_TIMEOUT_MS });

const HIDE_REASON = 'E2Eの確認のため、コメントを非公開にします。';

const INVALIDATE_REASON = 'E2Eの確認のため、評価を無効化します。';

// 補助が作る行は実行ごとにハンドルの乱数の接尾辞で分かれるため、後片付けをしない
test.describe('コメントと評価の措置(管理者側)', () => {
  test('モデレーターが補助で作ったコメントを非公開化すると利用者側で削除の置き換えの表示になり、5と1の評価の1を無効化すると平均値と件数が変わる', async ({
    page,
    clientPage,
  }) => {
    const targets = await createModerationTargets();
    const [highRating, lowRating] = targets.ratings;
    if (highRating?.score !== 5 || lowRating?.score !== 1) {
      throw new Error('補助の既定の評価は5と1の2件の想定です');
    }
    expect(await readModerationTargetsState(targets)).toStrictEqual({
      ownerStatus: 'active',
      productHidden: false,
      commentHidden: false,
      validRatingCount: 2,
      validRatingAverage: 3,
    });
    const product = {
      handle: targets.productHandle,
      name: targets.productName,
    };
    await openEngagementProductPage(clientPage, product);
    const comments = launchCommentsSectionOf(clientPage);
    const commentArticle = commentArticleOf(
      comments,
      targets.comment.author.nickname,
      targets.comment.body,
    );
    await expect(commentArticle).toBeVisible();
    await expectRatingSummary(clientPage, { average: '3.0', count: 2 });

    await signInAsNewAdmin(page, { role: 'moderator' });
    await hideCommentFromList(page, targets, HIDE_REASON);
    await invalidateRatingFromList(page, lowRating.rater, INVALIDATE_REASON);

    await openEngagementProductPage(clientPage, product);
    await expectRemovedComment(comments);
    await expect(commentArticle).toHaveCount(0);
    await expect(comments).not.toContainText(targets.comment.body);
    await expectRatingSummary(clientPage, { average: '5.0', count: 1 });
    expect(await readModerationTargetsState(targets)).toStrictEqual({
      ownerStatus: 'active',
      productHidden: false,
      commentHidden: true,
      validRatingCount: 1,
      validRatingAverage: 5,
    });
  });
});
