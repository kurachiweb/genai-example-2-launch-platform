import type { PreparedAuditEntry } from '../../../lib/core/admin/audit-log.ts';
import type { BusinessDate } from '../../../lib/core/time/business-time.ts';
import type { YearSchedule } from '../../../lib/core/year-tournament/year-schedule.ts';

export type YearEveningBracketStep =
  'calendar' | 'entry-sync' | 'draw' | 'progression' | 'evening-notification';

export type YearTournamentIncident =
  // 23:45の夜の処理が失敗し、夜の送り出しの準備の完了を伝えなかった
  | {
      readonly kind: 'evening-bracket-failed';
      readonly date: BusinessDate;
      // 例外を投げた段
      readonly failedSteps: readonly YearEveningBracketStep[];
      // 組み合わせ決定・進行に失敗した年
      readonly failedYears: readonly number[];
    }
  // 4:21の返金と知らせの再処理が失敗した。対象を読めなかったときは年が空で件数が0
  | {
      readonly kind: 'entry-follow-up-failed';
      // 対象の枠の終えた年。組み合わせ決定の前に喪失した枠は年を持たないため含めない
      readonly years: readonly number[];
      readonly entryCount: number;
    };

export interface YearTournamentIncidentReporter {
  // 運用者が検知できるようログとエラートラッキングへ送る。識別と件数だけを含め、個人情報を含めない
  report(incident: YearTournamentIncident): void;
}

export interface YearFinalDateSave {
  // 行が無い年に新しい行を作るときに使うID
  readonly yearTournamentId: string;
  readonly schedule: YearSchedule;
  // 行が無いときの用意に使う既定の日程
  readonly defaultSchedule: YearSchedule;
  // 行が無い年は0
  readonly expectedVersion: number;
  // 64週の間隔の検証に使った前年と翌年の版。行が無い年は0。
  // 隣の年が同時に保存されると検証に使った日が古くなるため、自分の年の版と合わせて照合する
  readonly previousYearVersion: number;
  readonly nextYearVersion: number;
  readonly adminId: string;
  readonly audit: PreparedAuditEntry;
  readonly now: Date;
}

export interface YearFinalDateWriter {
  // 行の用意・決勝日と期限の列の書き直し・監査ログを1つの一括の書き込みで確定する。
  // 凍結済みか変更期限以降ならlocked、自分の年か前年・翌年の版が読み取った版と違えばversion_conflictで、何も書かない
  save(
    input: YearFinalDateSave,
  ): Promise<'saved' | 'version_conflict' | 'locked'>;
}
