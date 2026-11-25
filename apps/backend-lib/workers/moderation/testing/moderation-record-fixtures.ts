import { env } from 'cloudflare:workers';
import { asc } from 'drizzle-orm';

import { createDatabase } from '../../../../db/client.ts';
import { moderationActions } from '../../../../db/schema/moderation/moderation-actions.ts';
import type { NewModerationRecord } from '../../../core/moderation/ports.ts';

export const db = createDatabase(env.DB);

export const T0 = new Date('2026-11-20T04:21:00.000Z');

const HOUR_MS = 60 * 60 * 1000;

export function minutesBefore(minutes: number): Date {
  return new Date(T0.getTime() - minutes * 60 * 1000);
}

export function hoursAfter(hours: number): Date {
  return new Date(T0.getTime() + hours * HOUR_MS);
}

export function moderationIdOf(index: number): string {
  return `01JQ0MDR${String(index).padStart(18, '0')}`;
}

export function moderatedUserIdOf(index: number): string {
  return `01JQ0USR${String(index).padStart(18, '0')}`;
}

export function moderatedProductIdOf(index: number): string {
  return `01JQ0PRD${String(index).padStart(18, '0')}`;
}

export const OPERATOR_ADMIN_ID = '01JQ0ADM000000000000000001';

export function newRecordOf(
  index: number,
  overrides: Partial<NewModerationRecord> = {},
): NewModerationRecord {
  return {
    id: moderationIdOf(index),
    action: 'user.suspend',
    targetId: moderatedUserIdOf(index),
    subjectUserId: moderatedUserIdOf(index),
    productId: null,
    operatorAdminId: OPERATOR_ADMIN_ID,
    reason: '規約違反の投稿を繰り返したため',
    lifecycleEventId: null,
    occurredAt: T0,
    noticeStatus: 'none',
    ...overrides,
  };
}

export async function clearModerationRecords(): Promise<void> {
  await db.delete(moderationActions);
}

export async function readModerationRows() {
  return db.select().from(moderationActions).orderBy(asc(moderationActions.id));
}

export async function readModerationIds(): Promise<string[]> {
  return (await readModerationRows()).map((row) => row.id);
}
