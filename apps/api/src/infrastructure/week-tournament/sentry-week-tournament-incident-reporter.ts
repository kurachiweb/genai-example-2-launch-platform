import { captureEvent } from '@sentry/cloudflare';
import { injectable } from 'inversify';

import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import { safeTagOf } from '../../../lib/workers/week-tournament/incident-tags.ts';
import type {
  WeekTournamentIncident,
  WeekTournamentIncidentReporter,
} from '../../application/week-tournament/ports.ts';
import {
  ENTRY_FOLLOW_UP_JOB_DEFINITION,
  EVENING_BRACKET_JOB_DEFINITION,
} from '../../application/week-tournament/week-tournament-jobs.ts';

type IncidentKind = WeekTournamentIncident['kind'];

interface IncidentDetails {
  readonly tournamentIds: readonly string[];
  readonly context: Readonly<Record<string, unknown>>;
  readonly logProperties: Readonly<Record<string, unknown>>;
}

const MESSAGES: Readonly<Record<IncidentKind, string>> = {
  'evening-bracket-failed':
    'Weekトーナメントの23:45の夜の処理に失敗し、夜の送り出しの準備の完了を伝えませんでした',
  'entry-follow-up-failed':
    'Weekトーナメントの4:21の返金と知らせの再処理に失敗しました',
};

const JOBS: Readonly<Record<IncidentKind, string>> = {
  'evening-bracket-failed': EVENING_BRACKET_JOB_DEFINITION.name,
  'entry-follow-up-failed': ENTRY_FOLLOW_UP_JOB_DEFINITION.name,
};

const CONTEXT_NAME = 'tournament_incident';

const logger = getAppLogger(['api', 'infrastructure', 'week-tournament']);

function detailsOf(incident: WeekTournamentIncident): IncidentDetails {
  switch (incident.kind) {
    case 'evening-bracket-failed': {
      const failedTournamentIds = incident.failedTournamentIds.map(safeTagOf);
      return {
        tournamentIds: failedTournamentIds,
        context: {
          date: incident.date,
          failed_steps: [...incident.failedSteps],
          failed_tournament_count: failedTournamentIds.length,
          failed_tournament_ids: failedTournamentIds,
        },
        logProperties: {
          date: incident.date,
          failedSteps: [...incident.failedSteps],
          failedTournamentIds,
        },
      };
    }
    case 'entry-follow-up-failed': {
      const tournamentIds = incident.tournamentIds.map(safeTagOf);
      return {
        tournamentIds,
        context: {
          tournament_ids: tournamentIds,
          entry_count: incident.entryCount,
        },
        logProperties: { tournamentIds, entryCount: incident.entryCount },
      };
    }
  }
}

@injectable()
export class SentryWeekTournamentIncidentReporter implements WeekTournamentIncidentReporter {
  report(incident: WeekTournamentIncident): void {
    const message = MESSAGES[incident.kind];
    const job = JOBS[incident.kind];
    const { tournamentIds, context, logProperties } = detailsOf(incident);
    logger.error(message, { incident: incident.kind, job, ...logProperties });
    const [onlyTournamentId] = tournamentIds;
    // タグは1つの値しか持てないため、トーナメントが1件のときだけ検索できるようタグに付け、複数のときはコンテキストに並べる
    const tournamentTag =
      tournamentIds.length === 1 && onlyTournamentId !== undefined
        ? { tournament_id: onlyTournamentId }
        : {};
    // captureMessageの文言だけのイベントは、直前と同じ文言と指紋なら重複として捨てられ、翌日も続く同じ失敗を通知できない。文言をlogentryに置くと重複の判定から外れる
    captureEvent({
      level: 'error',
      logentry: { message },
      fingerprint: ['tournament', incident.kind],
      tags: { tournament_incident: incident.kind, job, ...tournamentTag },
      contexts: { [CONTEXT_NAME]: { ...context } },
    });
  }
}
