import { describe, expect, test } from 'bun:test';
import { dirname, join } from 'node:path';

import type { SuppressionReason } from '../email/suppression-policy.ts';
import type {
  EntryResult,
  MatchDecision,
  MatchKind,
  MatchStage,
} from '../match/match-model.ts';
import {
  awardPeriodLabel,
  awardSubject,
  COMBINED_UNSUBSCRIBE_LABELS,
  followedMatchesSubject,
  matchLabel,
  matchPreviewSubject,
  matchResultSubject,
  type ResultOutcome,
  resultOutcomeOf,
  roundName,
  suppressionReasonOf,
  UNAVAILABLE_PRODUCT_NAME,
} from './notice-copy.ts';

const COPY_RULES_PATH = 'docs/GUIDES/service/design/003-text-and-copy-rules.md';

// 共有ディレクトリは配置先ごとにリポジトリのルートからの深さが違うため、文言規則のファイルを上の階層へ順に探す
const findCopyRules = async (): Promise<string> => {
  let directory = import.meta.dir;
  for (;;) {
    const file = Bun.file(join(directory, COPY_RULES_PATH));
    if (await file.exists()) {
      return file.text();
    }
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(`文言規則のファイルが見つかりません: ${COPY_RULES_PATH}`);
    }
    directory = parent;
  }
};

const copyRules = await findCopyRules();
const copyRuleLines = copyRules.split('\n');

const sectionOf = (heading: string): readonly string[] => {
  const start = copyRuleLines.indexOf(heading);
  if (start === -1) {
    throw new Error(`文言規則に「${heading}」の節がありません。`);
  }
  const end = copyRuleLines.findIndex(
    (line, index) => index > start && /^#{1,3} /u.test(line),
  );
  return copyRuleLines.slice(start + 1, end === -1 ? undefined : end);
};

const tableOf = (heading: string): ReadonlyMap<string, readonly string[]> => {
  const rows = sectionOf(heading).filter((line) => line.startsWith('|'));
  // 表の先頭の2行は見出しと区切りのため、3行目からを値の行とする
  return new Map(
    rows.slice(2).map((row) => {
      const [key = '', ...values] = row
        .slice(1, -1)
        .split('|')
        .map((cell) => cell.trim());
      return [key, values] as const;
    }),
  );
};

const SUBJECT_TABLE = tableOf('### 件名');
const NOTATION_TABLE = tableOf('## 表記規則');
const EMAIL_BODY_SECTION = sectionOf('### 通知メールの本文').join('\n');

const subjectExampleOf = (kind: string): string | undefined =>
  SUBJECT_TABLE.get(kind)?.[0];

const OWN = 'Pitch Notes';
const OPPONENT = 'Tactics Board';

const RELATIVE_DATE_WORDS = ['明日', '本日', '今日', '今夜', '明後日'] as const;

describe('件名', () => {
  const subjects = [
    {
      kind: 'マッチ開始予告(FR-NOTIF-001)',
      subject: matchPreviewSubject(OWN, OPPONENT),
    },
    {
      kind: '勝敗結果(FR-NOTIF-004)',
      subject: matchResultSubject({
        own: OWN,
        opponent: OPPONENT,
        outcome: 'won',
        ownVotes: 12,
        opponentVotes: 9,
        nextRoundName: null,
      }),
    },
    {
      kind: '同上(敗北)',
      subject: matchResultSubject({
        own: OWN,
        opponent: OPPONENT,
        outcome: 'lost',
        ownVotes: 9,
        opponentVotes: 12,
        nextRoundName: null,
      }),
    },
    {
      kind: '同上(両者敗北)',
      subject: matchResultSubject({
        own: OWN,
        opponent: OPPONENT,
        outcome: 'no_votes',
        ownVotes: 0,
        opponentVotes: 0,
        nextRoundName: null,
      }),
    },
    {
      kind: '同上(不戦勝)',
      subject: matchResultSubject({
        own: OWN,
        opponent: null,
        outcome: 'bye',
        ownVotes: 0,
        opponentVotes: 0,
        nextRoundName: null,
      }),
    },
    {
      kind: '勝敗結果+翌日予告の統合',
      subject: matchResultSubject({
        own: OWN,
        opponent: OPPONENT,
        outcome: 'won',
        ownVotes: 12,
        opponentVotes: 9,
        nextRoundName: '準決勝',
      }),
    },
    {
      kind: '同上(不戦勝の統合)',
      subject: matchResultSubject({
        own: OWN,
        opponent: null,
        outcome: 'bye',
        ownVotes: 0,
        opponentVotes: 0,
        nextRoundName: '準決勝',
      }),
    },
    {
      kind: 'フォロー中ユーザーのマッチ開催(FR-NOTIF-006)',
      subject: followedMatchesSubject([OWN], 1),
    },
    {
      kind: '同上(同日複数の集約)',
      subject: followedMatchesSubject([OWN, OPPONENT, 'Line Up'], 3),
    },
    {
      kind: '受賞結果(FR-NOTIF-007)',
      subject: awardSubject(OWN, 'product_of_the_week'),
    },
    {
      kind: '同上(Product of the Year)',
      subject: awardSubject(OWN, 'product_of_the_year'),
    },
  ] as const;

  test.each(subjects)(
    '$kindの件名は文言規則の件名の表の例と一致する',
    ({ kind, subject }) => {
      expect(subjectExampleOf(kind)).toBeDefined();
      expect(subject).toBe(subjectExampleOf(kind) ?? '');
    },
  );

  test.each(subjects)(
    '$kindの件名は日付を基準にした相対表現を含まない',
    ({ subject }) => {
      for (const word of RELATIVE_DATE_WORDS) {
        expect(subject).not.toContain(word);
      }
    },
  );

  test('勝敗結果のスコアは自分対相手の順で、3桁ごとに区切る', () => {
    expect(
      matchResultSubject({
        own: OWN,
        opponent: OPPONENT,
        outcome: 'won',
        ownVotes: 1234,
        opponentVotes: 999,
        nextRoundName: null,
      }),
    ).toBe('フルタイム: Pitch Notesが1,234対999でTactics Boardに勝利');
  });

  test('相手が表示できない場合は相手の名前の代わりに「非公開のプロダクト」を示す', () => {
    expect(UNAVAILABLE_PRODUCT_NAME).toBe('非公開のプロダクト');
    expect(sectionOf('### 件名').join('\n')).toContain(
      `「${UNAVAILABLE_PRODUCT_NAME}」`,
    );
    expect(
      matchResultSubject({
        own: OWN,
        opponent: null,
        outcome: 'lost',
        ownVotes: 9,
        opponentVotes: 12,
        nextRoundName: null,
      }),
    ).toBe('フルタイム: Pitch Notesは9対12で非公開のプロダクトに敗れました');
    expect(
      matchResultSubject({
        own: OWN,
        opponent: null,
        outcome: 'won',
        ownVotes: 3,
        opponentVotes: 1,
        nextRoundName: '決勝',
      }),
    ).toBe('フルタイム: Pitch Notesが非公開のプロダクトに勝利、次は決勝');
  });

  test.each(['lost', 'no_votes'] as const satisfies readonly ResultOutcome[])(
    '%sの結果は翌日のラウンドと統合できない',
    (outcome) => {
      expect(() =>
        matchResultSubject({
          own: OWN,
          opponent: OPPONENT,
          outcome,
          ownVotes: 0,
          opponentVotes: 0,
          nextRoundName: '準決勝',
        }),
      ).toThrow(RangeError);
    },
  );

  test('開催通知は件数が1件なら最初のプロダクト名、2件以上なら件数を3桁ごとに区切って示す', () => {
    expect(followedMatchesSubject([OWN, OPPONENT], 1)).toBe(
      'Pitch Notesがキックオフします⚽️応援しましょう！',
    );
    expect(followedMatchesSubject([OWN], 1234)).toBe(
      'フォローしているユーザーの1,234プロダクトがキックオフします⚽️応援しましょう！',
    );
  });

  test.each([
    ['件数が0件', [OWN], 0],
    ['件数が整数でない', [OWN], 1.5],
    ['1件でプロダクト名が無い', [], 1],
  ] as const)('開催通知の件名は%sと例外を投げる', (_, names, count) => {
    expect(() => followedMatchesSubject(names, count)).toThrow(RangeError);
  });
});

describe('resultOutcomeOf', () => {
  test.each([
    ['won', 'votes', 'won'],
    ['won', 'last_upvote', 'won'],
    ['bye', 'bye', 'bye'],
    ['walkover', 'walkover', 'bye'],
    ['lost', 'votes', 'lost'],
    ['lost', 'last_upvote', 'lost'],
    ['lost', 'walkover', 'lost'],
    ['lost', 'no_votes', 'no_votes'],
  ] as const satisfies readonly (readonly [
    EntryResult,
    MatchDecision,
    ResultOutcome,
  ])[])('%sの側は決着が%sなら%sと示す', (result, decision, outcome) => {
    expect(resultOutcomeOf(result, decision)).toBe(outcome);
  });

  test('両方の側が棄権した決着の敗北は送らない', () => {
    expect(resultOutcomeOf('lost', 'both_forfeited')).toBeNull();
  });
});

describe('マッチの表記とラウンド名', () => {
  test.each([
    [{ round: 1, stage: null }, '1回戦'],
    [{ round: 2, stage: null }, '2回戦'],
    [{ round: 3, stage: 'quarterfinal' }, '準々決勝'],
    [{ round: 4, stage: 'semifinal' }, '準決勝'],
    [{ round: null, stage: 'final' }, '決勝'],
  ] as const satisfies readonly (readonly [
    { readonly round: number | null; readonly stage: MatchStage | null },
    string,
  ])[])('%oのラウンド名は%sである', (input, expected) => {
    expect(roundName(input)).toBe(expected);
  });

  test('ラウンド名は表記規則の表のラウンド名の規則に載っている', () => {
    const rule = NOTATION_TABLE.get('ラウンド名')?.[0] ?? '';
    for (const stage of ['quarterfinal', 'semifinal', 'final'] as const) {
      expect(rule).toContain(roundName({ round: null, stage }));
    }
    expect(rule).toContain(roundName({ round: 1, stage: null }));
    expect(rule).toContain(roundName({ round: 2, stage: null }));
  });

  test.each([
    { round: null, stage: null },
    { round: 0, stage: null },
    { round: 1.5, stage: null },
  ])('ラウンドも段も無い・正の整数でないラウンド%oは例外を投げる', (input) => {
    expect(() => roundName(input)).toThrow(RangeError);
  });

  test.each([
    [{ kind: 'qualifier', round: null, stage: null }, '予選'],
    [{ kind: 'week', round: 3, stage: 'semifinal' }, 'Week 準決勝'],
    [{ kind: 'year', round: 2, stage: null }, 'Year 2回戦'],
    [{ kind: 'week', round: 4, stage: 'final' }, 'Week 決勝'],
  ] as const satisfies readonly (readonly [
    {
      readonly kind: MatchKind;
      readonly round: number | null;
      readonly stage: MatchStage | null;
    },
    string,
  ])[])('%oのマッチの表記は%sである', (input, expected) => {
    expect(matchLabel(input)).toBe(expected);
  });

  test.each(['予選', 'Week 準決勝', 'Year 2回戦'])(
    'マッチの表記の%sは文言規則の通知メールの本文の例にある',
    (label) => {
      expect(EMAIL_BODY_SECTION).toContain(`「${label}」`);
    },
  );

  test('トーナメントのマッチにラウンドが無ければ例外を投げる', () => {
    expect(() =>
      matchLabel({ kind: 'week', round: null, stage: null }),
    ).toThrow(RangeError);
  });
});

describe('awardPeriodLabel', () => {
  test.each([
    ['product_of_the_week', '2026-W37', '2026年第37週(9/7〜9/13)'],
    ['product_of_the_year', '2026', '2026年'],
  ] as const)(
    '%sの期間%sは文言規則の例の%sと示す',
    (award, period, expected) => {
      const label = awardPeriodLabel(award, period);

      expect(label).toBe(expected);
      expect(EMAIL_BODY_SECTION).toContain(`「${expected}」`);
    },
  );

  test('Weekの期間の表記は表記規則の週の規則と一致する', () => {
    expect(NOTATION_TABLE.get('週')?.[0]).toBe(
      `「${awardPeriodLabel('product_of_the_week', '2026-W37')}」`,
    );
  });

  test.each([
    ['2026-W01', '2026年第1週(12/29〜1/4)'],
    ['2026-W53', '2026年第53週(12/28〜1/3)'],
    ['2027-W01', '2027年第1週(1/4〜1/10)'],
    ['2020-W53', '2020年第53週(12/28〜1/3)'],
    ['2021-W01', '2021年第1週(1/4〜1/10)'],
  ] as const)(
    '年末年始の境界のISO週%sはISO週の年と月日で%sと示す',
    (period, expected) => {
      expect(awardPeriodLabel('product_of_the_week', period)).toBe(expected);
    },
  );

  test.each([
    ['product_of_the_week', '2026'],
    ['product_of_the_week', '2027-W53'],
    ['product_of_the_week', '2021-W53'],
    ['product_of_the_week', '2026-W00'],
    ['product_of_the_week', '2026-W7'],
    ['product_of_the_year', '2026-W37'],
    ['product_of_the_year', '26'],
  ] as const)('%sの期間%sは形式違反として例外を投げる', (award, period) => {
    expect(() => awardPeriodLabel(award, period)).toThrow(RangeError);
  });
});

describe('統合したメールの配信停止のリンク', () => {
  test('文言は通知種別の名称を使った文言規則の2つの文と一致する', () => {
    expect(COMBINED_UNSUBSCRIBE_LABELS).toEqual({
      match_result: '勝敗結果の通知を配信停止',
      match_preview: 'マッチ開始予告の通知を配信停止',
    });
    expect(EMAIL_BODY_SECTION).toContain(
      `「${COMBINED_UNSUBSCRIBE_LABELS.match_result}」「${COMBINED_UNSUBSCRIBE_LABELS.match_preview}」`,
    );
    expect(Object.isFrozen(COMBINED_UNSUBSCRIBE_LABELS)).toBe(true);
  });
});

describe('suppressionReasonOf', () => {
  test.each([
    ['hard_bounce', 'bounce'],
    ['complaint', 'complaint'],
    ['rejected', 'rejected'],
  ] as const satisfies readonly (readonly [SuppressionReason, string])[])(
    '抑止の理由%sは%sと示す',
    (reason, expected) => {
      expect(suppressionReasonOf(reason)).toBe(expected);
    },
  );
});
