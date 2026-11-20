import {
  createModerationTargets,
  readModerationTargetsState,
} from '../support/moderation-fixtures.ts';
import { expect, test } from './admin-test.ts';

// ローカルのD1の操作(1回数秒)を4回含む
const FIXTURE_FLOW_TIMEOUT_MS = 90_000;

test.describe.configure({ timeout: FIXTURE_FLOW_TIMEOUT_MS });

test.describe('UGC管理の補助', () => {
  test('補助を使うと、ローカルのD1に掲載中のプロダクトを持つ確認済みの利用者と、そのプロダクトのローンチへのコメントと評価ができる', async () => {
    const targets = await createModerationTargets();

    expect(targets.productHandle).toMatch(/^e2e-dir-/u);
    expect(targets.comment.author.id).not.toBe(targets.product.ownerUserId);
    expect(targets.ratings.map(({ score }) => score)).toStrictEqual([5, 1]);
    expect(await readModerationTargetsState(targets)).toStrictEqual({
      ownerStatus: 'active',
      productHidden: false,
      commentHidden: false,
      validRatingCount: 2,
      validRatingAverage: 3,
    });
  });
});
