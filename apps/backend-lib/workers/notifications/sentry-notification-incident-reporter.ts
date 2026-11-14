import type { Logger } from '@logtape/logtape';
import { captureEvent, type SeverityLevel } from '@sentry/cloudflare';

import { getAppLogger } from '../../core/logging/app-logger.ts';
import { parseSlotKey } from '../../core/notifications/notification-slots.ts';
import type {
  NotificationIncident,
  NotificationIncidentReporter,
} from '../../core/notifications/ports.ts';
import type { LoggingOptions } from '../logging/configure-logging.ts';

type IncidentKind = NotificationIncident['kind'];

interface IncidentDetails {
  readonly tags?: Readonly<Record<string, string>>;
  readonly context?: Readonly<Record<string, unknown>>;
  readonly logProperties: Readonly<Record<string, unknown>>;
}

const LEVELS: Readonly<Record<IncidentKind, SeverityLevel>> = {
  'slot-overdue': 'error',
  'evening-dispatch-incomplete': 'warning',
  'sender-info-missing': 'warning',
  'send-rejected': 'error',
  'event-stalled': 'error',
};

const MESSAGES: Readonly<Record<IncidentKind, string>> = {
  'slot-overdue': '送り出しが遅れている通知の送信枠があります',
  'evening-dispatch-incomplete':
    '夜の通知の送信枠の送り出しの前提が、期限までにそろいませんでした',
  'sender-info-missing':
    '送信者情報が未設定のため、通知メールを送りませんでした',
  'send-rejected': 'メールの送信の要求が拒否され、通知メールを送りませんでした',
  'event-stalled': '展開されないまま残っている通知イベントがあります',
};

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/u;

// メール種別と送り出しの前提の名前は、どちらも<spec名>.<名詞句>の形で登録される
const QUALIFIED_NAME_PATTERN =
  /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

const REASON_PATTERN = /^[a-z][a-z0-9]*(?:[-_][a-z0-9]+)*$/u;

const MAX_REASON_LENGTH = 64;

const UNSAFE_VALUE = 'unknown';

const TAG_NAME = 'notifications_incident';

// タグ・コンテキスト・指紋は除去処理の対象外のため、分類の値と識別子の形の値だけを送り、メールアドレス・名称・トークンが紛れ込まないようにする
const toSlotKey = (value: string): string =>
  parseSlotKey(value) === undefined ? UNSAFE_VALUE : value;

const toEventId = (value: string): string =>
  ULID_PATTERN.test(value) ? value : UNSAFE_VALUE;

const toQualifiedName = (value: string): string =>
  QUALIFIED_NAME_PATTERN.test(value) ? value : UNSAFE_VALUE;

const toReason = (value: string): string =>
  value.length <= MAX_REASON_LENGTH && REASON_PATTERN.test(value)
    ? value
    : UNSAFE_VALUE;

function detailsOf(incident: NotificationIncident): IncidentDetails {
  switch (incident.kind) {
    case 'slot-overdue': {
      const slot = toSlotKey(incident.slotKey);
      return { tags: { notification_slot: slot }, logProperties: { slot } };
    }
    case 'evening-dispatch-incomplete': {
      const slot = toSlotKey(incident.slotKey);
      const missingParticipants =
        incident.missing === null
          ? null
          : incident.missing.map(toQualifiedName);
      return {
        tags: { notification_slot: slot },
        context: { missing_participants: missingParticipants },
        logProperties: { slot, missingParticipants },
      };
    }
    case 'sender-info-missing':
      return {
        context: { skipped: incident.skipped },
        logProperties: { skipped: incident.skipped },
      };
    case 'send-rejected': {
      const mailKind = toQualifiedName(incident.emailKind);
      const reason = toReason(incident.reason);
      return {
        tags: { email_kind: mailKind, send_rejected_reason: reason },
        logProperties: { mailKind, reason },
      };
    }
    case 'event-stalled': {
      const eventId = toEventId(incident.eventId);
      return {
        tags: { notification_event_id: eventId },
        logProperties: { eventId },
      };
    }
  }
}

export class SentryNotificationIncidentReporter implements NotificationIncidentReporter {
  private readonly logger: Logger;

  constructor(appName: LoggingOptions['appName']) {
    this.logger = getAppLogger([appName, 'application', 'notifications']);
  }

  report(incident: NotificationIncident): void {
    const level = LEVELS[incident.kind];
    const message = MESSAGES[incident.kind];
    const { tags, context, logProperties } = detailsOf(incident);
    const properties = { incident: incident.kind, ...logProperties };
    if (level === 'error') {
      this.logger.error(message, properties);
    } else {
      this.logger.warn(message, properties);
    }
    // captureMessageの文言だけのイベントは、直前と同じ文言と指紋なら重複として捨てられ、続けて起きた同じ出来事を通知できない。文言をlogentryに置くと重複の判定から外れる
    captureEvent({
      level,
      logentry: { message },
      fingerprint: ['notifications', incident.kind],
      tags: { [TAG_NAME]: incident.kind, ...tags },
      ...(context === undefined ? {} : { contexts: { [TAG_NAME]: context } }),
    });
  }
}
