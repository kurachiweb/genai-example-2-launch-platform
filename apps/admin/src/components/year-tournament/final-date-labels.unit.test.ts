import { describe, expect, test } from 'bun:test';

import {
  FINAL_DATE_CONFIRM_LABEL,
  FINAL_DATE_LOCKED_MESSAGE,
  FINAL_DATE_LOCKED_NOTICE,
  FINAL_DATE_NO_CHOICES_MESSAGE,
  FINAL_DATE_SAVED_MESSAGE,
  FINAL_DATE_SECTION_DESCRIPTION,
  FINAL_DATE_SECTION_TITLE,
  FINAL_DATE_SOURCE_LABELS,
  FINAL_DATE_SUBMIT_LABEL,
  FINAL_DATE_SUPER_ADMIN_ONLY_NOTICE,
  FINAL_DATE_VERSION_CONFLICT_MESSAGE,
  FINAL_DATE_VIOLATION_REASONS,
  type FinalDateViolationReason,
  finalDateConfirmDescriptionOf,
  finalDateConfirmTitleOf,
  finalDateViolationMessageOf,
  formatFinalDateLabel,
  isFinalDateViolationReason,
  nextYearGapWarningOf,
  yearLabelOf,
} from './final-date-labels.ts';

const NEIGHBORS = Object.freeze({
  previousYearFinalDate: '2026-05-31',
  nextYearFinalDate: '2028-05-28',
});

describe('決勝実施日の表記', () => {
  test.each([
    ['2027-05-30', '2027年5月30日(日)'],
    ['2027-12-31', '2027年12月31日(金)'],
    ['2028-01-01', '2028年1月1日(土)'],
    ['2028-01-02', '2028年1月2日(日)'],
    ['2028-02-29', '2028年2月29日(火)'],
  ])('業務日付%sは閲覧の年によらず年と曜日を付けて%sと示す', (date, label) => {
    expect(formatFinalDateLabel(date)).toBe(label);
  });

  test('業務日付の形でない値は例外にする', () => {
    expect(() => formatFinalDateLabel('2027-5-30')).toThrow(RangeError);
  });

  test('カードの見出しは対象年の表記にする', () => {
    expect(yearLabelOf(2027)).toBe('2027年');
  });
});

describe('区画とカードの文言', () => {
  test('区画の題名と説明', () => {
    expect(FINAL_DATE_SECTION_TITLE).toBe('Yearトーナメントの決勝実施日');
    expect(FINAL_DATE_SECTION_DESCRIPTION).toBe(
      '欧州サッカーのリーグ最終節に合わせて、各年の決勝実施日(日曜日)を設定します。未設定の年は5月の最終日曜日に行います。',
    );
  });

  test('決まり方の印は状態の表示のため「。」を付けない', () => {
    expect(FINAL_DATE_SOURCE_LABELS).toStrictEqual({
      EXPLICIT: '設定済み',
      DEFAULT: '既定(5月の最終日曜日)',
    });
  });

  test('参照だけにする時の案内', () => {
    expect(FINAL_DATE_SUPER_ADMIN_ONLY_NOTICE).toBe(
      '最上位管理者だけが変更できます。',
    );
    expect(FINAL_DATE_LOCKED_NOTICE).toBe(
      '変更期限(決勝の7日前)を過ぎたため変更できません。',
    );
  });

  test('翌年の注意は翌年の既定の日を曜日つきで示す', () => {
    expect(nextYearGapWarningOf('2028-05-28')).toBe(
      '翌年の決勝実施日が未設定のため、既定の2028年5月28日(日)では64週以上空きます。参加数を64以下に保つため、翌年の決勝実施日を設定してください。',
    );
  });
});

describe('保存の拒否の理由の文言', () => {
  test.each<[FinalDateViolationReason, string]>([
    ['year_not_editable', '現在の年か翌年を選んでください。'],
    ['not_sunday', '日曜日を選んでください。'],
    ['out_of_year', '対象年の日付を選んでください。'],
    ['too_soon', '現在から8日後以降の日付を選んでください。'],
    [
      'too_far_from_previous',
      '前年の決勝実施日(2026年5月31日(日))から64週以上空く日付は選べません。',
    ],
    [
      'too_far_from_next',
      '翌年の決勝実施日(2028年5月28日(日))まで64週以上空く日付は選べません。',
    ],
  ])('%sは「%s」', (reason, message) => {
    expect(finalDateViolationMessageOf(reason, NEIGHBORS)).toBe(message);
  });

  test('理由のコードの一覧はAPIサーバーが返す6つ', () => {
    expect(FINAL_DATE_VIOLATION_REASONS).toStrictEqual([
      'year_not_editable',
      'not_sunday',
      'out_of_year',
      'too_soon',
      'too_far_from_previous',
      'too_far_from_next',
    ]);
  });

  test('理由のコードの判定は一覧に無いコードを偽にする', () => {
    expect(isFinalDateViolationReason('too_soon')).toBe(true);
    expect(isFinalDateViolationReason('too_long')).toBe(false);
    expect(isFinalDateViolationReason(undefined)).toBe(false);
  });

  test('変更期限の後と変更の競合の文言', () => {
    expect(FINAL_DATE_LOCKED_MESSAGE).toBe(
      '決勝実施日の7日前を過ぎたため変更できません。',
    );
    expect(FINAL_DATE_VERSION_CONFLICT_MESSAGE).toBe(
      '他の管理者が設定を変更しました。最新の内容を読み込んでから操作してください。',
    );
  });
});

describe('選択と保存の文言', () => {
  test('選べる日付が無い時の案内', () => {
    expect(FINAL_DATE_NO_CHOICES_MESSAGE).toBe('選べる日付がありません。');
  });

  test('送信と確認のダイアログの確定はどちらも「保存する」', () => {
    expect(FINAL_DATE_SUBMIT_LABEL).toBe('保存する');
    expect(FINAL_DATE_CONFIRM_LABEL).toBe('保存する');
  });

  test('確認のダイアログの題名は対象年と変更後の日付を曜日つきで示す', () => {
    expect(finalDateConfirmTitleOf(2027, '2027-06-06')).toBe(
      '2027年の決勝実施日を2027年6月6日(日)に変更しますか?',
    );
  });

  test('確認のダイアログの説明は変更後の受付期限と組み合わせ決定の日時を示し、Week優勝の期間も変わる旨を添える', () => {
    expect(
      finalDateConfirmDescriptionOf({
        acceptUntil: '2027年6月1日(火) 16:00',
        drawAt: '2027年6月1日(火) 16:45',
      }),
    ).toBe(
      '受付期限は2027年6月1日(火) 16:00、組み合わせ決定は2027年6月1日(火) 16:45になり、対象となるWeek優勝の期間も変わります。',
    );
  });

  test('保存の成功の通知', () => {
    expect(FINAL_DATE_SAVED_MESSAGE).toBe('決勝実施日を保存しました。');
  });
});
