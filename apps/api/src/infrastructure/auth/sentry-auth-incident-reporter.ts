import { captureEvent, type SeverityLevel } from '@sentry/cloudflare';
import { injectable } from 'inversify';

import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type {
  AuthIncident,
  AuthIncidentReporter,
  PwnedCheckResult,
} from '../../application/auth/ports.ts';

type IncidentKind = AuthIncident['kind'];

type PwnedUnavailableReason = Extract<
  PwnedCheckResult,
  { kind: 'unavailable' }
>['reason'];

interface IncidentDetails {
  readonly tags: Readonly<Record<string, string>>;
  readonly context?: Readonly<Record<string, unknown>>;
  readonly logProperties: Readonly<Record<string, unknown>>;
}

const LEVELS: Readonly<Record<IncidentKind, SeverityLevel>> = {
  'pwned-password-check-unavailable': 'warning',
  'disposable-email-check-unavailable': 'warning',
  'login-throttle-ip-missing': 'warning',
  'lifecycle-events-redispatched': 'error',
  'purge-overdue': 'error',
  'lifecycle-publish-failed': 'error',
};

const MESSAGES: Readonly<Record<IncidentKind, string>> = {
  'pwned-password-check-unavailable':
    '漏洩パスワードの照合サービスを使えず、照合を省きました',
  'disposable-email-check-unavailable':
    '使い捨てメールアドレスの判定サービスを使えず、判定を省きました',
  'login-throttle-ip-missing':
    '送信元IPアドレスが不明なため、IPアドレス単位のログイン試行の記録を省きました',
  'lifecycle-events-redispatched':
    '送り直しが3回目以降に達したユーザーライフサイクルイベントがあります',
  'purge-overdue': '物理削除の期限を過ぎた退会ユーザーが残っています',
  'lifecycle-publish-failed':
    'ユーザーライフサイクルイベントの送信に失敗しました',
};

const KNOWN_REASONS: ReadonlySet<string> = new Set<PwnedUnavailableReason>([
  'timeout',
  'network',
  'status',
  'invalid-response',
]);

const EVENT_ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/u;

const UNSAFE_VALUE = 'unknown';

const CONTEXT_NAME = 'auth_incident';

const logger = getAppLogger(['api', 'auth', 'incident']);

// タグ・コンテキスト・指紋は除去処理の対象外のため、分類の値と識別子の形の値だけを送り、メールアドレスやIPアドレスが紛れ込まないようにする
const toReason = (reason: string): string =>
  KNOWN_REASONS.has(reason) ? reason : UNSAFE_VALUE;

const toEventId = (eventId: string): string =>
  EVENT_ID_PATTERN.test(eventId) ? eventId : UNSAFE_VALUE;

function detailsOf(incident: AuthIncident): IncidentDetails {
  const kindTag = { auth_incident: incident.kind };
  switch (incident.kind) {
    case 'pwned-password-check-unavailable': {
      const reason = toReason(incident.reason);
      return {
        tags: { ...kindTag, auth_incident_reason: reason },
        logProperties: { reason },
      };
    }
    case 'disposable-email-check-unavailable':
    case 'login-throttle-ip-missing':
      return { tags: kindTag, logProperties: {} };
    case 'lifecycle-events-redispatched': {
      const stuckEventIds = incident.stuckEventIds.map(toEventId);
      return {
        tags: kindTag,
        context: { count: incident.count, stuck_event_ids: stuckEventIds },
        logProperties: { count: incident.count, stuckEventIds },
      };
    }
    case 'purge-overdue':
      return {
        tags: kindTag,
        context: { count: incident.count },
        logProperties: { count: incident.count },
      };
    case 'lifecycle-publish-failed': {
      const eventId = toEventId(incident.eventId);
      return {
        tags: { ...kindTag, lifecycle_event_id: eventId },
        logProperties: { eventId },
      };
    }
  }
}

@injectable()
export class SentryAuthIncidentReporter implements AuthIncidentReporter {
  report(incident: AuthIncident): void {
    const level = LEVELS[incident.kind];
    const message = MESSAGES[incident.kind];
    const { tags, context, logProperties } = detailsOf(incident);
    const properties = { incident: incident.kind, ...logProperties };
    if (level === 'error') {
      logger.error(message, properties);
    } else {
      logger.warn(message, properties);
    }
    // captureMessageの文言だけのイベントは、直前と同じ文言と指紋なら重複として捨てられ、続けて起きた同じ出来事を通知できない。文言をlogentryに置くと重複の判定から外れる
    captureEvent({
      level,
      logentry: { message },
      fingerprint: ['identity', incident.kind],
      tags: { ...tags },
      ...(context === undefined
        ? {}
        : { contexts: { [CONTEXT_NAME]: { ...context } } }),
    });
  }
}
