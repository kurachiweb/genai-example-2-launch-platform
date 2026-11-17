import { z } from 'zod';

import { parseBusinessDate } from '../../../../../lib/core/time/business-time.ts';

const DATE_INVALID_MESSAGE = '日付の指定が正しくありません。';

// 画面は業務日付を自ら求めて渡すため、形式の違反と存在しない日付は同じ文言で拒否する
const businessDate = z.string().transform((value, context) => {
  try {
    return parseBusinessDate(value);
  } catch {
    context.addIssue({ code: 'custom', message: DATE_INVALID_MESSAGE });
    return z.NEVER;
  }
});

export const YEAR_TOURNAMENT_BOARD_ARGS = z.object({ date: businessDate });
