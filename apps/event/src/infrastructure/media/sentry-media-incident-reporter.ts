import { captureEvent, type SeverityLevel } from '@sentry/cloudflare';
import { injectable } from 'inversify';

import type {
  MediaIncidentReporter,
  ModerationOutcome,
} from '../../application/media/ports.ts';

type ModerationFailureReason = Extract<
  ModerationOutcome,
  { kind: 'transient' | 'rejected' }
>['reason'];

interface IncidentEvent {
  readonly level: SeverityLevel;
  readonly message: string;
  readonly kind: string;
  readonly reason: string;
  readonly fileId?: string;
}

const UNSAFE_TAG_VALUE = 'unknown';

const KNOWN_REASONS: ReadonlySet<string> = new Set<ModerationFailureReason>([
  'throttled',
  'service-error',
  'timeout',
  'network',
  'misconfigured',
  'invalid-image',
  'too-large',
  'invalid-parameter',
]);

const FILE_ID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

// タグと指紋は除去処理の対象外のため、識別子の形のファイルの識別子と判定の結果の分類の値だけを送り、ファイル名などが紛れ込まないようにする
const toReasonTag = (reason: string): string =>
  KNOWN_REASONS.has(reason) ? reason : UNSAFE_TAG_VALUE;

const toFileIdTag = (fileId: string): string =>
  FILE_ID_PATTERN.test(fileId) ? fileId : UNSAFE_TAG_VALUE;

function send(incident: IncidentEvent): void {
  const reason = toReasonTag(incident.reason);
  // 同じ理由の失敗は判定サービスの障害や設定に共通するため、ファイルごとに分けず理由で1つの問題にまとめる
  // captureMessageの文言だけのイベントは、直前と同じ文言と指紋なら重複として捨てられるため、文言をlogentryに置く
  captureEvent({
    level: incident.level,
    logentry: { message: incident.message },
    fingerprint: [incident.kind, reason],
    tags: {
      ...(incident.fileId === undefined
        ? {}
        : { media_file_id: toFileIdTag(incident.fileId) }),
      moderation_reason: reason,
    },
  });
}

@injectable()
export class SentryMediaIncidentReporter implements MediaIncidentReporter {
  undetermined(fileId: string, reason: string): void {
    send({
      level: 'warning',
      message: '画像を判定できず、未判定として記録しました',
      kind: 'media-moderation-undetermined',
      reason,
      fileId,
    });
  }

  rejectedByService(fileId: string, reason: string): void {
    send({
      level: 'warning',
      message: '判定サービスが画像を受け付けず、隔離しました',
      kind: 'media-moderation-rejected',
      reason,
      fileId,
    });
  }

  misconfigured(reason: string): void {
    send({
      level: 'error',
      message: '判定サービスの設定に誤りがあります',
      kind: 'media-moderation-misconfigured',
      reason,
    });
  }
}
