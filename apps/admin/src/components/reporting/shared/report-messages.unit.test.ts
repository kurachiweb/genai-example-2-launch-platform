import { describe, expect, test } from 'bun:test';

import type {
  ReportResponseTimeView,
  ReportTargetView,
} from '../../../graphql/admin-reporting-cases.ts';
import {
  categoryCountLabel,
  formatReportElapsed,
  REPORT_CASE_PAGE_TITLE,
  REPORTS_PAGE_COPY,
  reportCaseActionLabel,
  reportCaseActionName,
  reportCaseChangedMessage,
  reportCaseDialogCopyOf,
  reportCountLabel,
  reportTargetLabelOf,
  responseTimeLabelOf,
} from './report-messages.ts';

const EMPTY_TARGET: ReportTargetView = Object.freeze({
  kind: 'user',
  id: '01KA0VSER00000000000000001',
  detached: false,
  available: true,
  handle: null,
  label: null,
  excerpt: null,
  productId: null,
  productName: null,
  productHandle: null,
});

const USER_TARGET: ReportTargetView = Object.freeze({
  ...EMPTY_TARGET,
  handle: 'maker_ai',
  label: 'サンプル太郎',
});

const PRODUCT_TARGET: ReportTargetView = Object.freeze({
  ...EMPTY_TARGET,
  kind: 'product',
  handle: 'pitch-notes',
  label: 'Pitch Notes',
});

const COMMENT_TARGET: ReportTargetView = Object.freeze({
  ...EMPTY_TARGET,
  kind: 'comment',
  excerpt: '本文の抜粋',
  productId: '01KA0PR0DVCT00000000000001',
  productName: 'Pitch Notes',
  productHandle: 'pitch-notes',
});

const UNAVAILABLE_TARGET: ReportTargetView = Object.freeze({
  ...EMPTY_TARGET,
  kind: 'product',
  available: false,
});

const DETACHED_TARGET: ReportTargetView = Object.freeze({
  ...EMPTY_TARGET,
  kind: 'comment',
  id: null,
  detached: true,
  available: false,
});

const REASON_NOTICE =
  '理由は投稿者と申出者への通知に載ります。個人情報を含めないでください。';

const HOUR = 60 * 60;

const DAY = 24 * HOUR;

describe('ページの文言', () => {
  test('一覧と詳細の題名と一覧の説明', () => {
    expect(REPORTS_PAGE_COPY).toStrictEqual({
      title: '通報',
      description:
        '同じ対象への通報をまとめた案件を、最後の受付日時の新しい順に表示します。',
    });
    expect(REPORT_CASE_PAGE_TITLE).toBe('通報の案件の詳細');
  });
});

describe('件数', () => {
  test('件数は3桁区切りで「件」を付け、カテゴリごとの件数はカテゴリ名に続ける', () => {
    expect(reportCountLabel(3)).toBe('3件');
    expect(reportCountLabel(12_345)).toBe('12,345件');
    expect(categoryCountLabel('権利侵害', 1_200)).toBe('権利侵害 1,200件');
  });
});

describe('対応期間', () => {
  test('経過は日と時間で示し、1日未満は時間だけ、1時間未満は「1時間未満」とし、端数は切り捨てる', () => {
    expect(formatReportElapsed(3 * DAY + 4 * HOUR + 59 * 60)).toBe('3日4時間');
    expect(formatReportElapsed(DAY)).toBe('1日0時間');
    expect(formatReportElapsed(DAY - 1)).toBe('23時間');
    expect(formatReportElapsed(4 * HOUR)).toBe('4時間');
    expect(formatReportElapsed(HOUR)).toBe('1時間');
    expect(formatReportElapsed(HOUR - 1)).toBe('1時間未満');
    expect(formatReportElapsed(0)).toBe('1時間未満');
  });

  const responseTime = (
    patch: Partial<ReportResponseTimeView>,
  ): ReportResponseTimeView => ({
    startedAt: '2026-11-01T00:00:00.000Z',
    completedAt: null,
    elapsedSeconds: 4 * HOUR,
    alerts: [],
    ...patch,
  });

  test('完了した案件は「対応期間」、未完了の案件は「対応中」、完了の日時を得られない案件は「不明」と示す', () => {
    expect(
      responseTimeLabelOf(
        responseTime({ completedAt: '2026-11-01T04:00:00.000Z' }),
      ),
    ).toBe('対応期間 4時間');
    expect(responseTimeLabelOf(responseTime({}))).toBe('対応中 4時間');
    expect(
      responseTimeLabelOf(
        responseTime({ completedAt: null, elapsedSeconds: null }),
      ),
    ).toBe('不明');
  });
});

describe('対象の表示', () => {
  test('ユーザーはニックネームとハンドル、プロダクトは名称とハンドル、コメントはプロダクトの名称へのコメントと示す', () => {
    expect(reportTargetLabelOf(USER_TARGET)).toBe('サンプル太郎(@maker_ai)');
    expect(reportTargetLabelOf(PRODUCT_TARGET)).toBe(
      'Pitch Notes(pitch-notes)',
    );
    expect(reportTargetLabelOf(COMMENT_TARGET)).toBe('Pitch Notesへのコメント');
    expect(reportTargetLabelOf({ ...COMMENT_TARGET, productName: null })).toBe(
      'コメント',
    );
  });

  test('読めない対象は「表示できない対象」、対象への参照を消した案件は「削除された対象」と示す', () => {
    expect(reportTargetLabelOf(UNAVAILABLE_TARGET)).toBe('表示できない対象');
    expect(reportTargetLabelOf(DETACHED_TARGET)).toBe('削除された対象');
  });
});

describe('案件の操作', () => {
  test('措置の名前は対象の種類に応じ、操作の名前は見えている名前を含めて対象を示す', () => {
    expect(reportCaseActionLabel('resolve-with-measure', 'product')).toBe(
      '非公開にする',
    );
    expect(reportCaseActionLabel('resolve-with-measure', 'comment')).toBe(
      '非公開にする',
    );
    expect(reportCaseActionLabel('resolve-with-measure', 'user')).toBe(
      '停止する',
    );
    expect(reportCaseActionLabel('resolve-without-measure', 'user')).toBe(
      '措置なしで対応済にする',
    );
    expect(reportCaseActionLabel('reject', 'user')).toBe('却下する');

    expect(reportCaseActionName('resolve-with-measure', PRODUCT_TARGET)).toBe(
      'Pitch Notes(pitch-notes)を非公開にする',
    );
    expect(reportCaseActionName('resolve-with-measure', USER_TARGET)).toBe(
      'サンプル太郎(@maker_ai)を停止する',
    );
    expect(
      reportCaseActionName('resolve-without-measure', COMMENT_TARGET),
    ).toBe('Pitch Notesへのコメントの案件を措置なしで対応済にする');
    expect(reportCaseActionName('reject', DETACHED_TARGET)).toBe(
      '削除された対象の通報を却下する',
    );
  });

  test('措置の確認はUGC管理の同じ措置の影響に、申出者への通知と取り消せない旨と理由の注記を文で続ける', () => {
    expect(
      reportCaseDialogCopyOf('resolve-with-measure', PRODUCT_TARGET),
    ).toStrictEqual({
      title: 'プロダクト『Pitch Notes』を非公開にしますか?',
      description: `未開始のマッチ予定は取り消され、復元しても戻りません。投稿者へ通知を送ります。案件を対応済にし、申出者へ対応結果を通知します。送った通知は取り消せません。${REASON_NOTICE}`,
      confirmLabel: '非公開にする',
    });
    expect(
      reportCaseDialogCopyOf('resolve-with-measure', COMMENT_TARGET),
    ).toStrictEqual({
      title: 'コメントを非公開にしますか?',
      description: `コメントは「このコメントは削除されました。」の表示に置き換わり、付いている返信はそのまま残ります。投稿者へ通知を送ります。案件を対応済にし、申出者へ対応結果を通知します。送った通知は取り消せません。${REASON_NOTICE}`,
      confirmLabel: '非公開にする',
    });
    expect(
      reportCaseDialogCopyOf('resolve-with-measure', USER_TARGET),
    ).toStrictEqual({
      title: 'サンプル太郎を停止しますか?',
      description: `この利用者のプロフィール・プロダクト・コメント・評価は他の利用者に表示されなくなり、未開始のマッチ予定は取り消されます(停止を解除しても戻りません)。利用者へ停止の通知を送ります。案件を対応済にし、申出者へ対応結果を通知します。送った通知は取り消せません。${REASON_NOTICE}`,
      confirmLabel: '停止する',
    });
    expect(
      reportCaseDialogCopyOf('resolve-with-measure', {
        ...USER_TARGET,
        label: null,
      }).title,
    ).toBe('表示できない利用者を停止しますか?');
  });

  test('措置なしの対応済と却下の確認は、通知と取り消せない旨と理由の注記を文で示す', () => {
    expect(
      reportCaseDialogCopyOf('resolve-without-measure', USER_TARGET),
    ).toStrictEqual({
      title: '措置をせずに対応済にしますか?',
      description: `申出者へ対応結果を通知します。送った通知は取り消せません。${REASON_NOTICE}`,
      confirmLabel: '対応済にする',
    });
    expect(reportCaseDialogCopyOf('reject', USER_TARGET)).toStrictEqual({
      title: 'この通報を却下しますか?',
      description: `投稿者と申出者へ却下を通知します。送った通知は取り消せません。${REASON_NOTICE}`,
      confirmLabel: '却下する',
    });
  });

  test('確定の通知は変更後の対応ステータスと照会で選ぶ', () => {
    expect(reportCaseChangedMessage({ status: 'in_progress' })).toBe(
      '対応中にしました。',
    );
    expect(reportCaseChangedMessage({ status: 'open' })).toBe(
      '未対応に戻しました。',
    );
    expect(reportCaseChangedMessage({ status: 'resolved' })).toBe(
      '対応済にしました。',
    );
    expect(reportCaseChangedMessage({ status: 'rejected' })).toBe(
      '却下しました。',
    );
    expect(
      reportCaseChangedMessage({
        sentAt: '2026-11-01T00:00:00.000Z',
        deadline: '2026-11-08T00:00:00.000Z',
      }),
    ).toBe('照会を送りました。');
  });
});
