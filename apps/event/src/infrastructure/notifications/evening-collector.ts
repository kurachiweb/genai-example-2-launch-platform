import { inject, injectable } from 'inversify';

import { MATCH_PLATFORM_TYPES } from '../../../lib/core/match/identifiers.ts';
import { MATCH_SCHEDULE } from '../../../lib/core/match/match-model.ts';
import type { MatchDirectory } from '../../../lib/core/match/ports.ts';
import { NOTIFICATIONS_PLATFORM_TYPES } from '../../../lib/core/notifications/identifiers.ts';
import {
  type MatchNoticeTopic,
  matchNoticeDrafts,
  type NoticeDraft,
} from '../../../lib/core/notifications/notice-plan.ts';
import { parseSlotKey } from '../../../lib/core/notifications/notification-slots.ts';
import type {
  NotificationNoticeStore,
  NotificationPreferenceStore,
  StoredSlot,
} from '../../../lib/core/notifications/ports.ts';
import {
  type BusinessDate,
  fromBusinessDateTime,
  toBusinessDateTime,
} from '../../../lib/core/time/business-time.ts';
import { noticeSourceOf } from '../../../lib/workers/notifications/d1-notification-event-expander.ts';
import type {
  SlotCollector,
  SlotCollectStep,
} from '../../application/notifications/ports.ts';

const MILLISECONDS_PER_DAY = 86_400_000;

// 1回の記録の一括の書き込みの実行時間を抑えるため、通知の下書きを分けて記録する
const DRAFTS_PER_RECORD = 500;

const COLLECTED: SlotCollectStep = Object.freeze({
  kind: 'progress',
  cursor: null,
  done: true,
});

function chunk<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

// 業務時刻は固定のオフセットで夏時間が無いため、0:00の24時間後の業務日付が翌日になる
function nextBusinessDate(date: BusinessDate): BusinessDate {
  const startOfDay = fromBusinessDateTime(date, MATCH_SCHEDULE.kickoff);
  return toBusinessDateTime(
    new Date(startOfDay.getTime() + MILLISECONDS_PER_DAY),
  ).date;
}

function eveningDateOf(slot: StoredSlot): BusinessDate {
  const parsed = parseSlotKey(slot.key);
  if (parsed?.kind !== 'evening') {
    throw new RangeError(`夜の枠ではありません: ${slot.key}`);
  }
  return parsed.date;
}

// 予選の結果と予告は発行を待たずに照会から作るため、再実行しても重複のキーで同じ通知になる
@injectable()
export class EveningCollector implements SlotCollector {
  constructor(
    @inject(MATCH_PLATFORM_TYPES.MatchDirectory)
    private readonly matches: MatchDirectory,
    @inject(NOTIFICATIONS_PLATFORM_TYPES.NotificationPreferenceStore)
    private readonly preferences: NotificationPreferenceStore,
    @inject(NOTIFICATIONS_PLATFORM_TYPES.NotificationNoticeStore)
    private readonly notices: NotificationNoticeStore,
  ) {}

  async step(slot: StoredSlot, now: Date): Promise<SlotCollectStep> {
    const date = eveningDateOf(slot);
    const results = await this.draftsFor('match_result', date, now);
    const previews = await this.draftsFor(
      'match_preview',
      nextBusinessDate(date),
      now,
    );
    for (const part of chunk([...results, ...previews], DRAFTS_PER_RECORD)) {
      await this.notices.record(part, now);
    }
    return COLLECTED;
  }

  private async draftsFor(
    topic: MatchNoticeTopic,
    date: BusinessDate,
    now: Date,
  ): Promise<readonly NoticeDraft[]> {
    const records = await this.matches.listForDate({
      date,
      kinds: ['qualifier'],
      now,
    });
    const sources = records.map(noticeSourceOf);
    const owners = sources.flatMap((source) =>
      source.entries.flatMap(({ ownerUserId }) =>
        ownerUserId === null ? [] : [ownerUserId],
      ),
    );
    if (owners.length === 0) {
      return [];
    }
    const eligible = await this.preferences.eligibleRecipients(owners, topic);
    return matchNoticeDrafts({ topic, matches: sources, eligible });
  }
}
