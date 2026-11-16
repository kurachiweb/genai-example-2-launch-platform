import { z } from 'zod';

import { parseIsoWeek } from '../../../common-lib/tournament/week-period.ts';
import { UPPERCASE_ULID_PATTERN } from '../ids/uppercase-ulid.ts';

export const NOTIFICATION_EVENT_TYPES = Object.freeze([
  'match_preview',
  'match_result',
  'award',
] as const);

export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

export const AWARD_KINDS = Object.freeze([
  'product_of_the_week',
  'product_of_the_year',
] as const);

export type AwardKind = (typeof AWARD_KINDS)[number];

export type NotificationEvent =
  | { readonly type: 'match_preview'; readonly matchId: string }
  | { readonly type: 'match_result'; readonly matchId: string }
  | {
      readonly type: 'award';
      readonly award: AwardKind;
      // Weekは'2026-W37'(ISO週)、Yearは'2026'
      readonly period: string;
      readonly productId: string;
    };

export const NOTIFICATION_PUBLISH_EVENT_LIMIT = 50;

const YEAR_PERIOD_PATTERN = /^\d{4}$/u;
// <spec名>の形で、各部分の文字の規則はライフサイクルの処理の名前と同じにする
const PUBLISHER_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

// 送信枠のキー・重複のキーが同じIDから同じ文字列になるよう、採番の表記である大文字だけを受け付ける
const ulid = z.ulid().regex(UPPERCASE_ULID_PATTERN);

function isExistingYear(year: string): boolean {
  return YEAR_PERIOD_PATTERN.test(year) && Number(year) >= 1;
}

function isIsoWeekPeriod(period: string): boolean {
  return parseIsoWeek(period) !== undefined;
}

const PERIOD_RULES: Readonly<Record<AwardKind, (period: string) => boolean>> =
  Object.freeze({
    product_of_the_week: isIsoWeekPeriod,
    product_of_the_year: isExistingYear,
  });

const matchEventSchema = <TType extends 'match_preview' | 'match_result'>(
  type: TType,
) => z.object({ type: z.literal(type), matchId: ulid });

const awardEventSchema = z
  .object({
    type: z.literal('award'),
    award: z.enum(AWARD_KINDS),
    period: z.string(),
    productId: ulid,
  })
  .refine(({ award, period }) => PERIOD_RULES[award](period), {
    path: ['period'],
    message:
      '受賞の期間は賞に応じてISO週(YYYY-Www)か年(YYYY)で指定してください',
  });

export const notificationEventSchema: z.ZodType<NotificationEvent> =
  z.discriminatedUnion('type', [
    matchEventSchema('match_preview'),
    matchEventSchema('match_result'),
    awardEventSchema,
  ]);

export function notificationEventDedupeKey(event: NotificationEvent): string {
  if (event.type === 'award') {
    return `award:${event.award}:${event.period}:${event.productId}`;
  }
  return `${event.type}:${event.matchId}`;
}

export interface NotificationPublishRequest {
  // '<spec名>'。ログだけに使う
  readonly publisher: string;
  readonly events: readonly NotificationEvent[];
  readonly at: Date;
}

export interface NotificationPublishResult {
  readonly recorded: number;
  readonly duplicates: number;
}

export type NotificationPublishErrorReason =
  | 'invalid-request'
  | 'invalid-event'
  | 'match-not-found'
  | 'match-not-decided'
  | 'match-not-previewable';

export class NotificationPublishError extends Error {
  override readonly name = 'NotificationPublishError';
  readonly reason: NotificationPublishErrorReason;
  readonly eventIndex: number | null;

  // 通知イベントの内容はログに出さないため、文言には理由と位置だけを入れる
  constructor(
    reason: NotificationPublishErrorReason,
    eventIndex: number | null = null,
  ) {
    super(
      eventIndex === null
        ? `通知イベントの発行を拒否しました: ${reason}`
        : `通知イベントの発行を拒否しました: ${reason}(${String(eventIndex)}番目)`,
    );
    this.reason = reason;
    this.eventIndex = eventIndex;
  }
}

export interface NotificationEventPublisher {
  publish(
    request: NotificationPublishRequest,
  ): Promise<NotificationPublishResult>;
}

function assertRequestShape(request: NotificationPublishRequest): void {
  const { length } = request.events;
  if (
    !PUBLISHER_PATTERN.test(request.publisher) ||
    Number.isNaN(request.at.getTime()) ||
    length < 1 ||
    length > NOTIFICATION_PUBLISH_EVENT_LIMIT
  ) {
    throw new NotificationPublishError('invalid-request');
  }
}

export function parseNotificationPublishRequest(
  request: NotificationPublishRequest,
): NotificationPublishRequest {
  assertRequestShape(request);
  const events = request.events.map((event, index) => {
    const parsed = notificationEventSchema.safeParse(event);
    if (!parsed.success) {
      throw new NotificationPublishError('invalid-event', index);
    }
    return parsed.data;
  });
  return { publisher: request.publisher, events, at: request.at };
}
