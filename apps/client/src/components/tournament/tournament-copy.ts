export const FINAL_DATE_LABEL = '決勝日';

export const BRACKET_LINK_LABEL = 'ブラケットを見る';

export const ENTRY_DEADLINE_LABEL = '決済期限';

export const ENTRY_COUNTDOWN_LABEL = '締め切りまであと';

export const ENTRY_COUNTDOWN_NAME = '決済期限までの残り時間';

export const ENTRY_PENDING_LABEL = '送信中';

export const ENTRY_FEE_PREFIX = '参加費';

// 「Ultras」は翻訳しないため、続く文と分けて持つ
export const ENTRY_ULTRAS_GUIDE_SUFFIX =
  'なら参加費が免除され、敗北後は2日で再ローンチできます。';

export const ENTRY_EXEMPT_TITLE = '参加費免除';

export type TournamentEntryExcludedReason =
  'hidden_or_suspended' | 'over_capacity';

// トップページの本文の区画の文言
export interface TournamentBoardCopy {
  // 区画の見出しの名前(「Product of the Weekトーナメント」など)
  readonly sectionTitle: string;
}

// トップページの全幅の決勝の区画の文言
export interface TournamentFinalCopy {
  readonly badge: string;
  readonly title: string;
  readonly subtitle: string;
  readonly awarded: (productName: string) => string;
  readonly noAward: string;
}

// ブラケットのページの文言
export interface TournamentBracketCopy {
  // ページと失敗の表示の見出し
  readonly title: string;
  // 優勝の表示の賞の名前
  readonly awardName: string;
  readonly counts: (participantCount: number, seedCount: number) => string;
  readonly error: string;
}

// プロダクトの画面の参加費の導線の文言
export interface TournamentEntryCopy {
  // 導線の見出し
  readonly title: string;
  readonly entryButton: string;
  readonly exemptMessage: string;
  // 受付の終了と、受付期限の後の決済の開始の拒否(checkout_closed)の文言
  readonly closedMessage: string;
  // 「<lead><before><組み合わせ決定の日時><after>」と組み合わせ決定の日時の前後に分けた文言
  readonly entitledMessage: {
    readonly lead: string;
    readonly before: string;
    readonly after: string;
  };
  readonly drawnMessage: string;
  readonly championMessage: string;
  readonly eliminatedMessage: (roundName: string) => string;
  // lateは組み合わせ決定の後に確定したための期限切れ
  readonly expiredMessage: (late: boolean) => string;
  readonly forfeitedMessage: string;
  // 返金の対象のとき、資格の喪失の文に続ける文
  readonly forfeitedRefundSuffix: string;
  readonly excludedMessage: (reason: TournamentEntryExcludedReason) => string;
  // 返金の対象のとき、除外の文に続ける文
  readonly excludedRefundSuffix: string;
}
