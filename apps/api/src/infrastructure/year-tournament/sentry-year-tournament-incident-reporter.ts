import { captureEvent } from '@sentry/cloudflare';
import { injectable } from 'inversify';

import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type {
  YearTournamentIncident,
  YearTournamentIncidentReporter,
} from '../../application/year-tournament/ports.ts';
import {
  YEAR_ENTRY_FOLLOW_UP_JOB_DEFINITION,
  YEAR_EVENING_BRACKET_JOB_DEFINITION,
} from '../../application/year-tournament/year-tournament-jobs.ts';

const UNSAFE_VALUE = 'unknown';

type IncidentKind = YearTournamentIncident['kind'];

type SafeYear = number | typeof UNSAFE_VALUE;

interface IncidentDetails {
  readonly years: readonly SafeYear[];
  readonly context: Readonly<Record<string, unknown>>;
  readonly logProperties: Readonly<Record<string, unknown>>;
}

const MESSAGES: Readonly<Record<IncidentKind, string>> = {
  'evening-bracket-failed':
    'Yearトーナメントの23:45の夜の処理に失敗し、夜の送り出しの準備の完了を伝えませんでした',
  'entry-follow-up-failed':
    'Yearトーナメントの4:21の返金と知らせの再処理に失敗しました',
};

const JOBS: Readonly<Record<IncidentKind, string>> = {
  'evening-bracket-failed': YEAR_EVENING_BRACKET_JOB_DEFINITION.name,
  'entry-follow-up-failed': YEAR_ENTRY_FOLLOW_UP_JOB_DEFINITION.name,
};

const CONTEXT_NAME = 'tournament_year_incident';

const logger = getAppLogger(['api', 'infrastructure', 'year-tournament']);

// タグは除去処理の対象外のため、年の形の値だけを送る
function safeYearOf(year: number): SafeYear {
  return Number.isSafeInteger(year) ? year : UNSAFE_VALUE;
}

function detailsOf(incident: YearTournamentIncident): IncidentDetails {
  switch (incident.kind) {
    case 'evening-bracket-failed': {
      const failedYears = incident.failedYears.map(safeYearOf);
      return {
        years: failedYears,
        context: {
          date: incident.date,
          failed_steps: [...incident.failedSteps],
          failed_year_count: failedYears.length,
          failed_years: failedYears,
        },
        logProperties: {
          date: incident.date,
          failedSteps: [...incident.failedSteps],
          failedYears,
        },
      };
    }
    case 'entry-follow-up-failed': {
      const years = incident.years.map(safeYearOf);
      return {
        years,
        context: { years, entry_count: incident.entryCount },
        logProperties: { years, entryCount: incident.entryCount },
      };
    }
  }
}

@injectable()
export class SentryYearTournamentIncidentReporter implements YearTournamentIncidentReporter {
  report(incident: YearTournamentIncident): void {
    const message = MESSAGES[incident.kind];
    const job = JOBS[incident.kind];
    const { years, context, logProperties } = detailsOf(incident);
    logger.error(message, { incident: incident.kind, job, ...logProperties });
    const [onlyYear] = years;
    // タグは1つの値しか持てないため、年が1件のときだけ検索できるようタグに付け、複数のときはコンテキストに並べる
    const yearTag =
      years.length === 1 && onlyYear !== undefined
        ? { year: String(onlyYear) }
        : {};
    // captureMessageの文言だけのイベントは、直前と同じ文言と指紋なら重複として捨てられ、翌日も続く同じ失敗を通知できない。文言をlogentryに置くと重複の判定から外れる
    captureEvent({
      level: 'error',
      logentry: { message },
      fingerprint: ['tournament-year', incident.kind],
      tags: { tournament_year_incident: incident.kind, job, ...yearTag },
      contexts: { [CONTEXT_NAME]: { ...context } },
    });
  }
}
