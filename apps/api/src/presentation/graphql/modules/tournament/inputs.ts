import { z } from 'zod';

import { UPPERCASE_ULID_PATTERN } from '../../../../../lib/core/ids/uppercase-ulid.ts';
import { parseBusinessDate } from '../../../../../lib/core/time/business-time.ts';

const DATE_INVALID_MESSAGE = '日付の指定が正しくありません。';

// 画面は業務日付を自ら求めて渡すため、形式の違反と存在しない日付は同じ文言で拒否する
export const businessDateArg = z.string().transform((value, context) => {
  try {
    return parseBusinessDate(value);
  } catch {
    context.addIssue({ code: 'custom', message: DATE_INVALID_MESSAGE });
    return z.NEVER;
  }
});

export const TOURNAMENT_BOARD_ARGS = z.object({ date: businessDateArg });

// 欄ごとの詳細を1件にするため、ULIDの形式の違反で大文字の検査を止める
export const startTournamentCheckoutArgsOf = (launchIdInvalidMessage: string) =>
  z.object({
    launchId: z
      .ulid({ error: launchIdInvalidMessage, abort: true })
      .regex(UPPERCASE_ULID_PATTERN, launchIdInvalidMessage),
  });
