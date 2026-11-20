import { sqlStringLiteral } from '../../apps/api/scripts/admin/sql-string-literal.ts';
import type { RatingScore } from '../../apps/common-lib/engagement/engagement-rules.ts';
import type { LocalD1Row } from './local-d1-command.ts';
import { TEST_EMAIL_DOMAIN } from './test-email.ts';

export interface ModerationProduct {
  readonly productId: string;
  readonly launchId: string;
  readonly ownerUserId: string;
  readonly ownerHandle: string;
  readonly ownerEmail: string;
}

export interface FixtureUser {
  readonly id: string;
  readonly pseudonymousId: string;
  readonly handle: string;
  readonly nickname: string;
  readonly email: string;
}

export interface PlannedModerationComment {
  readonly commentId: string;
  readonly body: string;
  readonly author: FixtureUser;
}

export interface PlannedModerationRating {
  readonly ratingId: string;
  readonly score: RatingScore;
  readonly rater: FixtureUser;
}

export interface EngagementTargetsInput {
  readonly product: ModerationProduct;
  readonly ratingScores: readonly RatingScore[];
  readonly suffix: string;
  readonly now: Date;
  readonly nextId: () => string;
}

export interface EngagementTargetsPlan {
  readonly product: ModerationProduct;
  readonly comment: PlannedModerationComment;
  readonly ratings: readonly PlannedModerationRating[];
  readonly now: Date;
}

export interface ModerationTargetsState {
  readonly ownerStatus: string;
  readonly productHidden: boolean;
  readonly commentHidden: boolean;
  readonly validRatingCount: number;
  readonly validRatingAverage: number | null;
}

const MIN_RATINGS = 1;

const MAX_RATINGS = 9;

const SUFFIX_PATTERN = /^[0-9a-z]{4,12}$/u;

// ログインさせない利用者のため、どのパスワードの検証にも一致しない値にする
const UNUSABLE_PASSWORD_HASH = sqlStringLiteral('e2e-fixture-unusable');

const TOP_LEVEL_DEPTH = '1';

const integerLiteral = (value: number): string => {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(
      `SQLの整数のリテラルにできない値です: ${String(value)}`,
    );
  }
  return String(value);
};

const valuesOf = (values: readonly string[]): string =>
  `(${values.join(', ')})`;

// 措置の対象は画面と同じ掲載の条件(公開中のプロダクト・有効で確認済みの投稿者・取り消されていない勝ちのローンチ)を満たすものに限る
export function moderationProductSql(productHandle: string): string {
  return `SELECT p.id AS product_id, l.id AS launch_id, u.id AS owner_user_id, u.handle AS owner_handle, u.email AS owner_email FROM products p JOIN users u ON u.id = p.user_id JOIN product_launches l ON l.product_id = p.id AND l.outcome = 'won' AND l.cancelled_at IS NULL WHERE p.handle = ${sqlStringLiteral(productHandle)} AND p.deleted_at IS NULL AND p.hidden_at IS NULL AND u.deleted_at IS NULL AND u.status = 'active' AND u.email_verified_at IS NOT NULL;`;
}

export function parseModerationProduct(
  rows: readonly LocalD1Row[],
  productHandle: string,
): ModerationProduct {
  const [row] = rows;
  if (row === undefined || rows.length !== 1) {
    throw new Error(
      `プロダクト(${productHandle})の掲載中のローンチが見つかりません。確認済みの利用者の公開中のプロダクトで、勝ちのローンチを1件だけ持つハンドルを指定してください`,
    );
  }
  const {
    product_id: productId,
    launch_id: launchId,
    owner_user_id: ownerUserId,
    owner_handle: ownerHandle,
    owner_email: ownerEmail,
  } = row;
  if (
    typeof productId !== 'string' ||
    typeof launchId !== 'string' ||
    typeof ownerUserId !== 'string' ||
    typeof ownerHandle !== 'string' ||
    typeof ownerEmail !== 'string'
  ) {
    throw new Error(
      `プロダクトの照会の結果の形式が正しくありません: ${JSON.stringify(rows)}`,
    );
  }
  return { productId, launchId, ownerUserId, ownerHandle, ownerEmail };
}

const fixtureUserOf = (
  handle: string,
  nickname: string,
  nextId: () => string,
): FixtureUser => ({
  id: nextId(),
  pseudonymousId: nextId(),
  handle,
  nickname,
  email: `${handle}@${TEST_EMAIL_DOMAIN}`,
});

export function planEngagementTargets({
  product,
  ratingScores,
  suffix,
  now,
  nextId,
}: EngagementTargetsInput): EngagementTargetsPlan {
  if (ratingScores.length < MIN_RATINGS || ratingScores.length > MAX_RATINGS) {
    throw new RangeError(
      `評価の数は${String(MIN_RATINGS)}〜${String(MAX_RATINGS)}で指定してください: ${String(ratingScores.length)}`,
    );
  }
  if (!SUFFIX_PATTERN.test(suffix)) {
    throw new RangeError(
      `識別子の接尾辞は英小文字と数字の4〜12文字で指定してください: ${suffix}`,
    );
  }
  const handlePrefix = `e2e-mod-${suffix}`;
  const author = fixtureUserOf(
    `${handlePrefix}-c`,
    `E2Eモデレーションの投稿者${suffix}`,
    nextId,
  );
  const comment = {
    commentId: nextId(),
    body: `E2Eモデレーションのコメント${suffix}です。`,
    author,
  };
  const ratings = ratingScores.map((score, index) => {
    const number = String(index + 1);
    const rater = fixtureUserOf(
      `${handlePrefix}-r${number}`,
      `E2Eモデレーションの評価者${suffix}-${number}`,
      nextId,
    );
    return { ratingId: nextId(), score, rater };
  });
  return { product, comment, ratings, now };
}

// 画面の投稿と同じ形の行(トップレベルのコメントはroot_idに自身のIDを持つ)を作り、投稿の通知などの後続の処理は起こさない。利用者は前回の実行の行と接尾辞で分ける
export function engagementTargetsInsertSql({
  product,
  comment,
  ratings,
  now,
}: EngagementTargetsPlan): string {
  const created = integerLiteral(now.getTime());
  const productId = sqlStringLiteral(product.productId);
  const users = [comment.author, ...ratings.map(({ rater }) => rater)];
  const commentId = sqlStringLiteral(comment.commentId);
  return [
    `INSERT INTO users (id, pseudonymous_id, email, password_hash, nickname, handle, email_verified_at, terms_agreed_at, created_at, updated_at) VALUES ${users
      .map((user) =>
        valuesOf([
          sqlStringLiteral(user.id),
          sqlStringLiteral(user.pseudonymousId),
          sqlStringLiteral(user.email),
          UNUSABLE_PASSWORD_HASH,
          sqlStringLiteral(user.nickname),
          sqlStringLiteral(user.handle),
          created,
          created,
          created,
          created,
        ]),
      )
      .join(', ')};`,
    `INSERT INTO launch_comments (id, product_id, launch_id, root_id, depth, author_user_id, body, created_at, updated_at) VALUES ${valuesOf(
      [
        commentId,
        productId,
        sqlStringLiteral(product.launchId),
        commentId,
        TOP_LEVEL_DEPTH,
        sqlStringLiteral(comment.author.id),
        sqlStringLiteral(comment.body),
        created,
        created,
      ],
    )} RETURNING id;`,
    `INSERT INTO product_ratings (id, product_id, user_id, score, created_at, updated_at) VALUES ${ratings
      .map((rating) =>
        valuesOf([
          sqlStringLiteral(rating.ratingId),
          productId,
          sqlStringLiteral(rating.rater.id),
          integerLiteral(rating.score),
          created,
          created,
        ]),
      )
      .join(', ')} RETURNING id;`,
  ].join('\n');
}

export function parseEngagementTargetsInsert(
  rows: readonly LocalD1Row[],
  plan: EngagementTargetsPlan,
): void {
  const expected = [
    plan.comment.commentId,
    ...plan.ratings.map(({ ratingId }) => ratingId),
  ];
  const actual = rows.map((row) => row.id);
  if (
    actual.length !== expected.length ||
    expected.some((id) => !actual.includes(id))
  ) {
    throw new Error(
      `プロダクト(${plan.product.productId})へのコメント1件と評価${String(plan.ratings.length)}件を作れませんでした: ${JSON.stringify(rows)}`,
    );
  }
}

// 有効な評価の条件は利用者側の平均と同じく、無効化・論理削除されておらず、評価者が有効であること
export function moderationTargetsStateSql({
  product,
  comment,
}: EngagementTargetsPlan): string {
  const productId = sqlStringLiteral(product.productId);
  const validRatings = `FROM product_ratings r JOIN users ru ON ru.id = r.user_id WHERE r.product_id = ${productId} AND r.invalidated_at IS NULL AND r.deleted_at IS NULL AND ru.deleted_at IS NULL AND ru.status = 'active'`;
  return `SELECT u.status AS owner_status, p.hidden_at AS product_hidden_at, c.hidden_at AS comment_hidden_at, (SELECT COUNT(*) ${validRatings}) AS valid_rating_count, (SELECT AVG(r.score) ${validRatings}) AS valid_rating_average FROM products p JOIN users u ON u.id = p.user_id JOIN launch_comments c ON c.id = ${sqlStringLiteral(comment.commentId)} AND c.product_id = p.id WHERE p.id = ${productId};`;
}

export function parseModerationTargetsState(
  rows: readonly LocalD1Row[],
  plan: EngagementTargetsPlan,
): ModerationTargetsState {
  const [row] = rows;
  if (row === undefined || rows.length !== 1) {
    throw new Error(
      `ローカルのD1にプロダクト(${plan.product.productId})とコメント(${plan.comment.commentId})がありません`,
    );
  }
  const {
    owner_status: ownerStatus,
    product_hidden_at: productHiddenAt,
    comment_hidden_at: commentHiddenAt,
    valid_rating_count: validRatingCount,
    valid_rating_average: validRatingAverage,
  } = row;
  if (
    typeof ownerStatus !== 'string' ||
    (productHiddenAt !== null && typeof productHiddenAt !== 'number') ||
    (commentHiddenAt !== null && typeof commentHiddenAt !== 'number') ||
    typeof validRatingCount !== 'number' ||
    (validRatingAverage !== null && typeof validRatingAverage !== 'number')
  ) {
    throw new Error(
      `UGC管理の対象の状態の照会の結果の形式が正しくありません: ${JSON.stringify(rows)}`,
    );
  }
  return {
    ownerStatus,
    productHidden: productHiddenAt !== null,
    commentHidden: commentHiddenAt !== null,
    validRatingCount,
    validRatingAverage,
  };
}
