import { captureEvent, type SeverityLevel } from '@sentry/cloudflare';
import { injectable } from 'inversify';

import type {
  EmailIncident,
  EmailIncidentReporter,
} from '../../application/email/ports.ts';

interface IncidentEvent {
  readonly level: SeverityLevel;
  readonly fingerprint: readonly string[];
  readonly tags: Readonly<Record<string, string>>;
}

const REPORT_MESSAGES: Readonly<Record<EmailIncident['kind'], string>> = {
  undeliverable: 'メールを送信できませんでした',
  'daily-limit': 'メールの日次の送信上限に達しました',
  'sender-side-rejection': '送信側の理由でメールが拒否されました',
  'delivery-failed': '受け付け後のメールの配送に失敗しました',
  'invalid-delivery-event': '不正な配信不能イベントを受け取りました',
};

// タグと指紋は除去処理の対象外のため、識別子に使う文字だけからなる値に限って送り、宛先・URL・文章が紛れ込まないようにする
const TAG_VALUE_PATTERN = /^[A-Za-z0-9_.:-]+$/u;

// Sentryのタグの値の上限(200文字)より短くし、外部から届く長い値で指紋の種類が際限なく増えないようにする
const MAX_TAG_VALUE_LENGTH = 64;

const UNSAFE_TAG_VALUE = 'unknown';

const MISSING_TAG_VALUE = 'missing';

function toTagValue(value: string): string {
  return TAG_VALUE_PATTERN.test(value)
    ? value.slice(0, MAX_TAG_VALUE_LENGTH)
    : UNSAFE_TAG_VALUE;
}

function toIncidentEvent(incident: EmailIncident): IncidentEvent {
  switch (incident.kind) {
    case 'undeliverable': {
      const code = toTagValue(incident.code);
      return {
        level: 'error',
        fingerprint: ['email', incident.kind, code],
        tags: {
          email_incident: incident.kind,
          email_kind: toTagValue(incident.emailKind),
          ...(incident.category === undefined
            ? {}
            : { email_category: incident.category }),
          email_code: code,
          correlation_id: toTagValue(incident.requestId),
        },
      };
    }
    case 'daily-limit':
      return {
        level: 'warning',
        fingerprint: ['email', incident.kind],
        tags: { email_incident: incident.kind },
      };
    case 'sender-side-rejection':
    case 'delivery-failed': {
      const code = toTagValue(incident.reason);
      return {
        level: 'error',
        fingerprint: ['email', incident.kind, code],
        tags: { email_incident: incident.kind, email_code: code },
      };
    }
    case 'invalid-delivery-event': {
      const code =
        incident.type === undefined
          ? MISSING_TAG_VALUE
          : toTagValue(incident.type);
      return {
        level: 'error',
        fingerprint: ['email', incident.kind, code],
        tags: { email_incident: incident.kind, email_code: code },
      };
    }
  }
}

@injectable()
export class SentryEmailIncidentReporter implements EmailIncidentReporter {
  report(incident: EmailIncident): void {
    const { level, fingerprint, tags } = toIncidentEvent(incident);
    // captureMessageの文言だけのイベントは、直前と同じ文言と指紋なら重複として捨てられ、続けて起きた同じ異常を通知できない。文言をlogentryに置くと重複の判定から外れる
    captureEvent({
      level,
      logentry: { message: REPORT_MESSAGES[incident.kind] },
      fingerprint: [...fingerprint],
      tags: { ...tags },
    });
  }
}
