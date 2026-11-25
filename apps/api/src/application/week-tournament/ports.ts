import type { BusinessDate } from '../../../lib/core/time/business-time.ts';

export type WeekEveningBracketStep =
  'draw' | 'entry-catch-up' | 'progression' | 'night-notification';

export type WeekTournamentIncident =
  // 23:45の夜の処理が失敗し、夜の送り出しの準備の完了を伝えなかった
  | {
      readonly kind: 'evening-bracket-failed';
      readonly date: BusinessDate;
      // 例外を投げた手順
      readonly failedSteps: readonly WeekEveningBracketStep[];
      // 組み合わせ決定・進行に失敗したトーナメント
      readonly failedTournamentIds: readonly string[];
    }
  // 4:21の返金と知らせの再処理が失敗した。対象を読めなかったときはトーナメントが空で件数が0
  | {
      readonly kind: 'entry-follow-up-failed';
      readonly tournamentIds: readonly string[];
      readonly entryCount: number;
    };

export interface WeekTournamentIncidentReporter {
  // 運用者が検知できるようログとエラートラッキングへ送る。識別と件数だけを含め、個人情報を含めない
  report(incident: WeekTournamentIncident): void;
}
