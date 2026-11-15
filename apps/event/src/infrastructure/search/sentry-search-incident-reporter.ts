import { captureEvent } from '@sentry/cloudflare';
import { injectable } from 'inversify';

import { isValidSearchTargetName } from '../../../lib/core/search/search-target.ts';
import type {
  SearchIncident,
  SearchIncidentReporter,
} from '../../application/search/ports.ts';

interface IncidentEvent {
  readonly message: string;
  readonly fingerprint: readonly string[];
  readonly tags: Readonly<Record<string, string>>;
}

const UNSAFE_TAG_VALUE = 'unknown';

// タグと指紋は除去処理の対象外のため、検索対象の名前の形の値だけを送り、本文などが紛れ込まないようにする
function toTargetTag(target: string): string {
  return isValidSearchTargetName(target) ? target : UNSAFE_TAG_VALUE;
}

function toIncidentEvent(incident: SearchIncident): IncidentEvent {
  const target = toTargetTag(incident.target);
  switch (incident.kind) {
    case 'unregistered-target':
      return {
        message: '検索対象が登録されていません',
        fingerprint: ['search-unregistered-target', target],
        tags: { search_target: target },
      };
    case 'extractor-misconfigured': {
      const status = String(incident.status);
      // 設定の誤りは全ての検索対象に共通するため、検索対象ごとに分けず状態コードで1つの問題にまとめる
      return {
        message: 'キーワード抽出の外部APIの設定に誤りがあります',
        fingerprint: ['search-extractor-misconfigured', status],
        tags: { search_target: target, status },
      };
    }
  }
}

@injectable()
export class SentrySearchIncidentReporter implements SearchIncidentReporter {
  report(incident: SearchIncident): void {
    const { message, fingerprint, tags } = toIncidentEvent(incident);
    // captureMessageの文言だけのイベントは、直前と同じ文言と指紋なら重複として捨てられ、続けて起きた同じ異常を通知できない。文言をlogentryに置くと重複の判定から外れる
    captureEvent({
      level: 'error',
      logentry: { message },
      fingerprint: [...fingerprint],
      tags: { ...tags },
    });
  }
}
