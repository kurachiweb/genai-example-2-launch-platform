import { inArray } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  snakeCase,
  text,
} from 'drizzle-orm/sqlite-core';

import { timestamps, ulidPrimaryKey } from '../_shared/columns.ts';

const DISPLAY_STOP_SUBJECT_KINDS = ['product', 'user'] as const;

export const sponsorshipDisplayStops = snakeCase.table(
  'sponsorship_display_stops',
  {
    id: ulidPrimaryKey(),
    subjectKind: text({ enum: DISPLAY_STOP_SUBJECT_KINDS }).notNull(),
    // プロダクトIDまたは利用者ID。上流の物理削除の順に縛られないよう外部キーにしない
    subjectId: text().notNull(),
    startedAt: integer({ mode: 'timestamp_ms' }).notNull(),
    endedAt: integer({ mode: 'timestamp_ms' }),
    ...timestamps(),
  },
  // 値をバインド変数のままにすると、生成するマイグレーションのCHECK制約に`?`が残るため、値を埋め込む
  (table) => [
    index('sponsorship_display_stops_subject_idx').on(
      table.subjectKind,
      table.subjectId,
      table.startedAt,
    ),
    check(
      'sponsorship_display_stops_subject_kind_check',
      inArray(table.subjectKind, DISPLAY_STOP_SUBJECT_KINDS).inlineParams(),
    ),
  ],
);
