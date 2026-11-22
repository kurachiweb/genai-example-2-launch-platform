import { countGraphemes } from '../text/graphemes.ts';
import { trimWhiteSpace } from '../text/white-space.ts';

export const REPORT_TARGET_KINDS = Object.freeze([
  'user',
  'product',
  'comment',
] as const);

export type ReportTargetKind = (typeof REPORT_TARGET_KINDS)[number];

export const REPORT_REASON_MAX = 1000;

export const REPORT_CONTACT_EMAIL_MAX = 254;

export type ReportReasonCheck = 'ok' | 'empty' | 'too-long';

export const checkReportReason = (value: string): ReportReasonCheck => {
  const graphemes = countGraphemes(trimWhiteSpace(value));
  if (graphemes === 0) {
    return 'empty';
  }
  return graphemes > REPORT_REASON_MAX ? 'too-long' : 'ok';
};

export const REPORT_CATEGORY_INFRINGEMENT_ID = '01JE0000000000000000000001';

export const REPORT_CATEGORY_OTHER_ID = '01JE0000000000000000000002';

export const REPORT_CATEGORY_INFRINGEMENT_NAME = '権利侵害';

export const REPORT_CATEGORY_OTHER_NAME = 'その他';

export const isInfringementCategory = (categoryId: string): boolean =>
  categoryId === REPORT_CATEGORY_INFRINGEMENT_ID;

// 停止中の利用者は通報者として記録しないため、未ログインと同じguestとして渡す
export type ReporterKind = 'member' | 'guest';

export interface ContactEmailRequirementInput {
  readonly reporterKind: ReporterKind;
  readonly categoryId: string;
}

// 権利侵害の申出者へ対応結果を知らせる宛先は、ログイン中なら登録メールアドレスがあるため、未ログインの権利侵害だけで求める
export const requiresContactEmail = ({
  reporterKind,
  categoryId,
}: ContactEmailRequirementInput): boolean =>
  reporterKind === 'guest' && isInfringementCategory(categoryId);

export interface SortableReportCategory {
  readonly id: string;
  readonly systemDefault: boolean;
  readonly createdAt: Date;
}

const STANDARD_CATEGORY_ORDER: readonly string[] = [
  REPORT_CATEGORY_INFRINGEMENT_ID,
  REPORT_CATEGORY_OTHER_ID,
];

const standardRank = (category: SortableReportCategory): number => {
  if (!category.systemDefault) {
    return -1;
  }
  const rank = STANDARD_CATEGORY_ORDER.indexOf(category.id);
  return rank === -1 ? STANDARD_CATEGORY_ORDER.length : rank;
};

const compareCategories = (
  left: SortableReportCategory,
  right: SortableReportCategory,
): number =>
  standardRank(left) - standardRank(right) ||
  left.createdAt.getTime() - right.createdAt.getTime() ||
  (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

export const sortReportCategories = <T extends SortableReportCategory>(
  categories: readonly T[],
): readonly T[] => [...categories].sort(compareCategories);
