import { z } from 'zod';

import { UPPERCASE_ULID_PATTERN } from '../../../../../lib/core/ids/uppercase-ulid.ts';
import { parseBusinessDate } from '../../../../../lib/core/time/business-time.ts';
import { LAUNCH_ID_INVALID_MESSAGE } from './errors.ts';

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

// 欄ごとの詳細を1件にするため、ULIDの形式の違反で大文字の検査を止める
export const START_YEAR_TOURNAMENT_CHECKOUT_ARGS = z.object({
  launchId: z
    .ulid({ error: LAUNCH_ID_INVALID_MESSAGE, abort: true })
    .regex(UPPERCASE_ULID_PATTERN, LAUNCH_ID_INVALID_MESSAGE),
});
