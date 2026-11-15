import { z } from '../../../lib/utilities/validation/zod.ts';

// Customer Portalの戻り先のURLに付く検索パラメータの値
export const PORTAL_RETURNED = 'returned';

export interface PlanSearch {
  readonly portal?: typeof PORTAL_RETURNED | undefined;
}

const SEARCH_SCHEMA = z.object({
  portal: z.literal(PORTAL_RETURNED).optional().catch(undefined),
});

// 戻った印でない値は欠落と同じに扱う。ルーターは検証の結果をURLの元の値に重ねるため、元の値を残さないよう常に項目を返す
export const toPlanSearch = (search: Record<string, unknown>): PlanSearch => ({
  portal: SEARCH_SCHEMA.parse(search).portal,
});
