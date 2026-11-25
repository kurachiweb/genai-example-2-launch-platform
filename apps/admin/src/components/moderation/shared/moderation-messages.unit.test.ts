import { describe, expect, test } from 'bun:test';

import { MODERATION_ACTIONS } from '../../../../common-lib/moderation/moderation-actions.ts';
import {
  adminImageOwnerLabel,
  COMMENT_ACTION_LABELS,
  COMMENT_FILTER_LABELS,
  COMMENT_LIST_CAPTION,
  COMMENT_LIST_COLUMNS,
  COMMENT_LIST_EMPTY_MESSAGE,
  EMAIL_SEARCH_AUDIT_NOTICE,
  EMPTY_COMMENT_BODY_LABEL,
  HIDDEN_OPPONENT_LABEL,
  LAUNCH_ITEM_LABELS,
  LOAD_MORE_LABEL,
  LOGO_QUARANTINE_NAME,
  MATCH_KIND_LABELS,
  MATCH_RESULT_COLUMNS,
  MATCH_RESULT_LABELS,
  MODERATION_REASON_LABEL,
  NO_FINDINGS_LABEL,
  NO_LAUNCH_LABEL,
  NO_LAUNCHES_MESSAGE,
  NO_MATCHES_MESSAGE,
  NO_VALID_RATINGS_MESSAGE,
  NO_VALUE_LABEL,
  PRODUCT_ACTION_LABELS,
  PRODUCT_DETAIL_COPY,
  PRODUCT_FILTER_LABELS,
  PRODUCT_LIST_CAPTION,
  PRODUCT_LIST_COLUMNS,
  PRODUCT_LIST_EMPTY_MESSAGE,
  PRODUCT_RATING_LIST_CAPTION,
  PRODUCT_RATING_LIST_COLUMNS,
  PRODUCT_VISIBILITY_LABELS,
  QUARANTINE_IMAGE_LABEL,
  QUARANTINE_REASON_TABS_LABEL,
  QUARANTINE_REASONS_LABEL,
  QUARANTINED_IMAGE_ITEM_LABELS,
  QUARANTINED_IMAGE_LIST_CAPTION,
  QUARANTINED_IMAGE_LIST_EMPTY_MESSAGE,
  QUARANTINED_IMAGE_MARK,
  RATING_ACTION_LABELS,
  RATING_FILTER_LABELS,
  RATING_LIST_CAPTION,
  RATING_LIST_COLUMNS,
  RATING_LIST_EMPTY_MESSAGE,
  RATING_STATE_LABELS,
  SUSPENDED_AT_LABEL,
  SYSTEM_IMAGE_OWNER_LABEL,
  UNREADABLE_USER_LABEL,
  USER_ACTION_LABELS,
  USER_FILTER_LABELS,
  USER_LIST_CAPTION,
  USER_LIST_COLUMNS,
  USER_LIST_EMPTY_MESSAGE,
  USER_STATUS_LABELS,
  commentActionName,
  commentLaunchLabel,
  hideCommentDialogCopy,
  hideProductDialogCopy,
  IMAGE_ACTION_LABELS,
  IMAGE_DIALOG_COPY,
  imageActionName,
  invalidateRatingDialogCopy,
  launchHeading,
  latestLaunchLabel,
  matchResultsCaption,
  MODERATION_CHANGED_MESSAGES,
  MODERATION_PAGE_COPY,
  MODERATION_SEARCH_TERM_TOO_LONG_MESSAGE,
  MODERATION_UNCHANGED_MESSAGES,
  NO_MODERATION_RECORD_LABEL,
  productOwnerLabel,
  QUARANTINE_REASON_TAB_ORDER,
  quarantineReasonsText,
  ratingActionName,
  ratingScoreLabel,
  ratingSummaryText,
  revalidateRatingDialogCopy,
  screenshotQuarantineName,
  suspendUserDialogCopy,
  unhideCommentDialogCopy,
  unhideProductDialogCopy,
  unsuspendUserDialogCopy,
  userActionName,
  userHandleLabel,
  userImageOwnerLabel,
  withdrawUserDialogCopy,
} from './moderation-messages.ts';
import { MODERATION_OPERATIONS } from './moderation-operations.ts';

describe('ページの題名と説明', () => {
  test('5つのページの題名と説明は文言規則のとおり', () => {
    expect(MODERATION_PAGE_COPY).toStrictEqual({
      users: {
        title: 'ユーザー',
        description: '退会していない利用者を、登録日時の新しい順に表示します。',
      },
      products: {
        title: 'プロダクト',
        description:
          '削除されていないプロダクトを、登録日時の新しい順に表示します。',
      },
      comments: {
        title: 'コメント',
        description: 'コメントを、投稿日時の新しい順に表示します。',
      },
      ratings: {
        title: '評価',
        description: '評価を、更新日時の新しい順に表示します。',
      },
      mediaModeration: {
        title: '画像モデレーション',
        description:
          '隔離された画像を、隔離理由ごとに隔離された日時の新しい順に表示します。',
      },
    });
  });
});

describe('一覧の表示', () => {
  test('利用者のハンドルと投稿者・画像の保有者は「@」を付けたハンドルで示す', () => {
    expect(userHandleLabel('maker_ai')).toBe('@maker_ai');
    expect(productOwnerLabel('サンプル太郎', 'maker_ai')).toBe(
      'サンプル太郎(@maker_ai)',
    );
    expect(userImageOwnerLabel('サンプル太郎', 'maker_ai')).toBe(
      'サンプル太郎(@maker_ai)',
    );
    expect(adminImageOwnerLabel('運営の担当')).toBe('運営の担当(管理者)');
  });

  test('最新のローンチは日付と状態を「・」でつなぎ、コメントのローンチは回の番号で示す', () => {
    expect(latestLaunchLabel('2026年11月16日(月)', '勝利')).toBe(
      '2026年11月16日(月)・勝利',
    );
    expect(commentLaunchLabel(3)).toBe('第3回');
    expect(launchHeading(3)).toBe('第3回ローンチ');
    expect(matchResultsCaption(3)).toBe('第3回ローンチのマッチ結果');
  });

  test('評価の平均は小数第1位、件数は3桁区切りで示し、点数は支援技術に5段階中の点数として伝える', () => {
    expect(ratingSummaryText(4.25, 1234)).toBe('平均4.3(有効な評価1,234件)');
    expect(ratingSummaryText(5, 1)).toBe('平均5.0(有効な評価1件)');
    expect(ratingScoreLabel(4)).toBe('5段階中4');
  });

  test('隔離理由は表示名を「、」でつなぎ、措置の記録が無い理由は「記録なし」と示す', () => {
    expect(quarantineReasonsText(['auto', 'user_suspended'])).toBe(
      '自動判定、ユーザー停止',
    );
    expect(NO_MODERATION_RECORD_LABEL).toBe('記録なし');
  });

  test('隔離理由のタブは自動判定・管理者操作・非公開化・ユーザー停止の順に並べる', () => {
    expect(QUARANTINE_REASON_TAB_ORDER).toStrictEqual([
      'auto',
      'admin_action',
      'product_hidden',
      'user_suspended',
    ]);
  });
});

describe('操作の名前', () => {
  test('ユーザーの操作の名前はニックネームを含める', () => {
    expect(userActionName('suspend', 'サンプル太郎')).toBe(
      '「サンプル太郎」を停止',
    );
    expect(userActionName('unsuspend', 'サンプル太郎')).toBe(
      '「サンプル太郎」の停止解除',
    );
    expect(userActionName('quarantineAvatar', 'サンプル太郎')).toBe(
      '「サンプル太郎」のプロフィール画像を隔離',
    );
    expect(userActionName('withdraw', 'サンプル太郎')).toBe(
      '「サンプル太郎」の代理の退会',
    );
  });

  test('コメントと評価の操作の名前は投稿者・評価者のニックネームを含め、読めない利用者は「表示できない利用者」に置き換える', () => {
    expect(commentActionName('hide', 'サンプル太郎')).toBe(
      'サンプル太郎さんのコメントを非公開化',
    );
    expect(commentActionName('unhide', null)).toBe(
      '表示できない利用者さんのコメントを復元',
    );
    expect(ratingActionName('invalidate', 'サンプル花子')).toBe(
      'サンプル花子さんの評価を無効化',
    );
    expect(ratingActionName('revalidate', null)).toBe(
      '表示できない利用者さんの評価の無効化の取り消し',
    );
  });

  test('画像の隔離の名前は対象を含め、スクリーンショットは並び順の番号を付ける', () => {
    expect(screenshotQuarantineName(2)).toBe('スクリーンショット2を隔離');
  });

  test('画像モデレーションの操作は保有者と用途を含める', () => {
    expect(IMAGE_ACTION_LABELS).toStrictEqual({
      'image.approve': '公開承認',
      'image.reject': '公開拒否',
      'image.release': '隔離の解除',
      'image.delete': '削除',
    });
    expect(
      imageActionName('image.approve', 'サンプル太郎(@maker_ai)', 'ロゴ'),
    ).toBe('サンプル太郎(@maker_ai)のロゴの公開承認');
    expect(imageActionName('image.reject', 'システム', 'ロゴ')).toBe(
      'システムのロゴの公開拒否',
    );
    expect(
      imageActionName(
        'image.release',
        '運営の担当(管理者)',
        '管理者のプロフィール画像',
      ),
    ).toBe('運営の担当(管理者)の管理者のプロフィール画像の隔離の解除');
    expect(
      imageActionName('image.delete', 'システム', 'スクリーンショット'),
    ).toBe('システムのスクリーンショットの削除');
  });

  test('全ての種類の操作の名前は、見えている文言を部分文字列として含む(WCAG 2.5.3)', () => {
    const pairs: readonly (readonly [name: string, label: string])[] = [
      ...Object.entries(USER_ACTION_LABELS).map(
        ([kind, label]) =>
          [
            userActionName(kind as keyof typeof USER_ACTION_LABELS, 'n'),
            label,
          ] as const,
      ),
      [LOGO_QUARANTINE_NAME, QUARANTINE_IMAGE_LABEL],
      [screenshotQuarantineName(1), QUARANTINE_IMAGE_LABEL],
      ...Object.entries(COMMENT_ACTION_LABELS).flatMap(([kind, label]) =>
        ['n', null].map(
          (nickname) =>
            [
              commentActionName(
                kind as keyof typeof COMMENT_ACTION_LABELS,
                nickname,
              ),
              label,
            ] as const,
        ),
      ),
      ...Object.entries(RATING_ACTION_LABELS).flatMap(([kind, label]) =>
        ['n', null].map(
          (nickname) =>
            [
              ratingActionName(
                kind as keyof typeof RATING_ACTION_LABELS,
                nickname,
              ),
              label,
            ] as const,
        ),
      ),
      ...Object.entries(IMAGE_ACTION_LABELS).map(
        ([operation, label]) =>
          [
            imageActionName(
              operation as keyof typeof IMAGE_ACTION_LABELS,
              'システム',
              'ロゴ',
            ),
            label,
          ] as const,
      ),
    ];

    expect(pairs).toHaveLength(18);
    for (const [name, label] of pairs) {
      expect(name).toContain(label);
    }
  });
});

describe('確認のダイアログ', () => {
  test('停止と停止解除は題名にニックネームを含め、説明の文で影響を示す', () => {
    expect(suspendUserDialogCopy('サンプル太郎')).toStrictEqual({
      title: 'ユーザー「サンプル太郎」を停止しますか?',
      description:
        'この利用者のプロフィール・プロダクト・コメント・評価は他の利用者に表示されなくなり、未開始のマッチ予定は取り消されます(停止を解除しても戻りません)。利用者へ停止の通知を送ります。',
      confirmLabel: '停止する',
    });
    expect(unsuspendUserDialogCopy('サンプル太郎')).toStrictEqual({
      title: 'ユーザー「サンプル太郎」の停止を解除しますか?',
      description:
        'この利用者のプロフィール・プロダクト・コメント・評価の表示を再開します。停止の時に取り消したマッチ予定は戻らず、他の理由で隔離された画像は公開に戻りません。利用者へ通知は送りません。',
      confirmLabel: '停止を解除する',
    });
  });

  test('代理の退会は対象のハンドルと停止状態を説明の文に含める', () => {
    expect(
      withdrawUserDialogCopy({
        nickname: 'サンプル太郎',
        handle: 'maker_ai',
        suspended: true,
      }),
    ).toStrictEqual({
      title: 'ユーザー「サンプル太郎」を退会させますか?',
      description:
        '対象は@maker_ai(停止中)の利用者です。退会は取り消せず、利用者のデータは退会の規則どおりに削除されます。本人の意思の確かめと退会の完了の知らせは、システムの外のメールで行ってください。',
      confirmLabel: '退会させる',
    });
    expect(
      withdrawUserDialogCopy({
        nickname: 'サンプル花子',
        handle: 'fan_1',
        suspended: false,
      }).description,
    ).toContain('対象は@fan_1(利用中)の利用者です。');
  });

  test('プロダクトの非公開化と復元は題名に名称を『』で含める', () => {
    expect(hideProductDialogCopy('Pitch Notes')).toStrictEqual({
      title: 'プロダクト『Pitch Notes』を非公開にしますか?',
      description:
        '未開始のマッチ予定は取り消され、復元しても戻りません。投稿者へ通知を送ります。',
      confirmLabel: '非公開にする',
    });
    expect(unhideProductDialogCopy('Pitch Notes')).toStrictEqual({
      title: 'プロダクト『Pitch Notes』を復元しますか?',
      description:
        'プロダクトの表示を再開します。非公開化の時に取り消したマッチ予定は戻らず、他の理由で隔離された画像は公開に戻りません。投稿者へ通知は送りません。',
      confirmLabel: '復元する',
    });
  });

  test('コメントの非公開化と復元は、投稿者を読めない時は題名の「<ニックネーム>さんの」を省く', () => {
    expect(hideCommentDialogCopy('サンプル太郎')).toStrictEqual({
      title: 'サンプル太郎さんのコメントを非公開にしますか?',
      description:
        'コメントは「このコメントは削除されました。」の表示に置き換わり、付いている返信はそのまま残ります。投稿者へ通知を送ります。',
      confirmLabel: '非公開にする',
    });
    expect(hideCommentDialogCopy(null).title).toBe(
      'コメントを非公開にしますか?',
    );
    expect(unhideCommentDialogCopy('サンプル太郎')).toStrictEqual({
      title: 'サンプル太郎さんのコメントを復元しますか?',
      description:
        'コメントの表示を再開します。投稿者が削除・退会・停止したコメントと匿名化済みのコメントは、削除された旨の表示のままです。投稿者へ通知は送りません。',
      confirmLabel: '復元する',
    });
    expect(unhideCommentDialogCopy(null).title).toBe('コメントを復元しますか?');
  });

  test('評価の無効化と取り消しは、評価者を読めない時は題名の「<ニックネーム>さんの」を省く', () => {
    expect(invalidateRatingDialogCopy('サンプル花子')).toStrictEqual({
      title: 'サンプル花子さんの評価を無効化しますか?',
      description:
        '無効化した評価は平均値と件数の算出から除かれます。評価者には自分の評価として表示されたままです。評価者へ通知は送りません。',
      confirmLabel: '無効化する',
    });
    expect(invalidateRatingDialogCopy(null).title).toBe(
      '評価を無効化しますか?',
    );
    expect(revalidateRatingDialogCopy('サンプル花子')).toStrictEqual({
      title: 'サンプル花子さんの評価の無効化を取り消しますか?',
      description:
        '評価を平均値と件数の算出に戻します。評価者へ通知は送りません。',
      confirmLabel: '無効化を取り消す',
    });
    expect(revalidateRatingDialogCopy(null).title).toBe(
      '評価の無効化を取り消しますか?',
    );
  });

  test('画像の操作は対象を題名に含めず、影響を説明の文で示す', () => {
    expect(IMAGE_DIALOG_COPY).toStrictEqual({
      'image.approve': {
        title: 'この画像の公開を承認しますか?',
        description:
          '自動判定の隔離理由を外します。他の隔離理由が残っている間は公開に戻りません。',
        confirmLabel: '公開を承認する',
      },
      'image.reject': {
        title: 'この画像の公開を拒否しますか?',
        description: '画像を削除します。削除した画像は元に戻せません。',
        confirmLabel: '公開を拒否する',
      },
      'image.quarantine': {
        title: 'この画像を隔離しますか?',
        description:
          '画像を利用者側に表示しないようにします。隔離を解除するまで公開に戻りません。',
        confirmLabel: '隔離する',
      },
      'image.release': {
        title: 'この画像の隔離を解除しますか?',
        description:
          '管理者操作の隔離理由を外します。他の隔離理由が残っている間は公開に戻りません。',
        confirmLabel: '隔離を解除する',
      },
      'image.delete': {
        title: 'この画像を削除しますか?',
        description: '削除した画像は元に戻せません。',
        confirmLabel: '削除する',
      },
    });
  });
});

describe('措置の結果のトースト', () => {
  test('措置の操作は13の措置と公開拒否で、全ての操作が確定した時と変わらなかった時の文言を持つ', () => {
    expect(MODERATION_OPERATIONS).toStrictEqual([
      ...MODERATION_ACTIONS,
      'image.reject',
    ]);
    expect(Object.keys(MODERATION_CHANGED_MESSAGES).toSorted()).toStrictEqual(
      [...MODERATION_OPERATIONS].toSorted(),
    );
    expect(Object.keys(MODERATION_UNCHANGED_MESSAGES).toSorted()).toStrictEqual(
      [...MODERATION_OPERATIONS].toSorted(),
    );
  });

  test('確定した時の文言は文言規則のとおり', () => {
    expect(MODERATION_CHANGED_MESSAGES).toStrictEqual({
      'user.suspend': 'ユーザーを停止しました。',
      'user.unsuspend': 'ユーザーの停止を解除しました。',
      'user.administrative-withdraw': 'ユーザーを退会させました。',
      'product.hide': 'プロダクトを非公開にしました。',
      'product.unhide': 'プロダクトを復元しました。',
      'comment.hide': 'コメントを非公開にしました。',
      'comment.unhide': 'コメントを復元しました。',
      'rating.invalidate': '評価を無効化しました。',
      'rating.revalidate': '評価の無効化を取り消しました。',
      'image.approve': '画像の公開を承認しました。',
      'image.reject': '画像の公開を拒否しました。',
      'image.quarantine': '画像を隔離しました。',
      'image.release': '画像の隔離を解除しました。',
      'image.delete': '画像を削除しました。',
    });
  });

  test('状態が変わらなかった時の文言は文言規則のとおり', () => {
    expect(MODERATION_UNCHANGED_MESSAGES).toStrictEqual({
      'user.suspend': '既に停止中です。',
      'user.unsuspend': '既に利用中です。',
      'user.administrative-withdraw': '既に退会済みです。',
      'product.hide': '既に非公開です。',
      'product.unhide': '既に公開中です。',
      'comment.hide': '既に非公開です。',
      'comment.unhide': '既に公開中です。',
      'rating.invalidate': '既に無効化済みです。',
      'rating.revalidate': '既に有効です。',
      'image.approve': 'この隔離理由は既に外れています。',
      'image.reject': '既に削除済みです。',
      'image.quarantine': '既に隔離中です。',
      'image.release': 'この隔離理由は既に外れています。',
      'image.delete': '既に削除済みです。',
    });
  });
});

describe('一覧と詳細の項目', () => {
  test('ユーザーの一覧の名前・列・絞り込み・状態・0件は文言規則のとおり', () => {
    expect(USER_LIST_CAPTION).toBe('ユーザーの一覧');
    expect(Object.values(USER_LIST_COLUMNS)).toStrictEqual([
      '画像',
      'ニックネーム',
      'ハンドル',
      '登録日時',
      '使い捨て判定',
      '状態',
      '操作',
    ]);
    expect(Object.values(USER_FILTER_LABELS)).toStrictEqual([
      'ハンドル',
      'ニックネーム',
      'メールアドレス',
      '停止状態',
      'すべて',
    ]);
    expect(EMAIL_SEARCH_AUDIT_NOTICE).toBe(
      'メールアドレスの検索は監査ログに記録されます。',
    );
    expect(USER_STATUS_LABELS).toStrictEqual({
      active: '利用中',
      suspended: '停止中',
    });
    expect(SUSPENDED_AT_LABEL).toBe('停止日時');
    expect(MODERATION_REASON_LABEL).toBe('理由');
    expect(USER_LIST_EMPTY_MESSAGE).toBe('条件に一致するユーザーはいません。');
    expect(Object.values(USER_ACTION_LABELS)).toStrictEqual([
      '停止',
      '停止解除',
      'プロフィール画像を隔離',
      '代理の退会',
    ]);
  });

  test('プロダクトの一覧と詳細の項目は文言規則のとおり', () => {
    expect(PRODUCT_LIST_CAPTION).toBe('プロダクトの一覧');
    expect(Object.values(PRODUCT_LIST_COLUMNS)).toStrictEqual([
      'ロゴ',
      '名称',
      'ハンドル',
      '投稿者',
      'カテゴリ',
      '最新のローンチ',
      '公開状態',
    ]);
    expect(Object.values(PRODUCT_FILTER_LABELS)).toStrictEqual([
      '名称',
      'ハンドル',
      '投稿者のハンドル',
      'カテゴリ',
      'すべてのカテゴリ',
      'ローンチ状態',
      'すべてのローンチ状態',
      '公開状態',
      'すべての公開状態',
    ]);
    expect(PRODUCT_VISIBILITY_LABELS).toStrictEqual({
      visible: '公開中',
      hidden: '非公開化中',
      owner_suspended: '投稿者が停止中',
    });
    expect(NO_LAUNCH_LABEL).toBe('なし');
    expect(PRODUCT_LIST_EMPTY_MESSAGE).toBe(
      '条件に一致するプロダクトはありません。',
    );
    expect(PRODUCT_DETAIL_COPY).toStrictEqual({
      pageTitle: 'プロダクトの詳細',
      backToList: 'プロダクトの一覧へ',
      sections: {
        visibility: '公開状態',
        information: 'プロダクトの情報',
        images: '画像',
        ratings: '評価',
        launches: 'ローンチ履歴',
      },
      items: {
        tagline: 'タグライン',
        category: 'カテゴリ',
        handle: 'ハンドル',
        websiteUrl: '外部Webサイト',
        owner: '投稿者',
        description: '説明文',
        logo: 'ロゴ',
        screenshots: 'スクリーンショット',
        hiddenAt: '非公開化した日時',
      },
    });
    expect(PRODUCT_ACTION_LABELS).toStrictEqual({
      hide: '非公開化',
      unhide: '復元',
    });
    expect(QUARANTINED_IMAGE_MARK).toBe('隔離中');
    expect(QUARANTINE_REASONS_LABEL).toBe('隔離理由');
    expect(QUARANTINE_IMAGE_LABEL).toBe('隔離');
    expect(LOGO_QUARANTINE_NAME).toBe('ロゴを隔離');
    expect(NO_VALID_RATINGS_MESSAGE).toBe('有効な評価はありません。');
    expect(PRODUCT_RATING_LIST_CAPTION).toBe('評価の一覧');
    expect(Object.values(PRODUCT_RATING_LIST_COLUMNS)).toStrictEqual([
      '評価者',
      '点数',
      '日時',
      '状態',
      '操作',
    ]);
    expect(LOAD_MORE_LABEL).toBe('さらに読み込む');
  });

  test('ローンチ履歴の項目は文言規則のとおり', () => {
    expect(Object.values(LAUNCH_ITEM_LABELS)).toStrictEqual([
      'ローンチ日',
      '状態',
    ]);
    expect(Object.values(MATCH_RESULT_COLUMNS)).toStrictEqual([
      '種別',
      'ラウンド',
      '実施日',
      '対戦相手',
      'Upvote数',
      '勝敗',
    ]);
    expect(Object.values(MATCH_KIND_LABELS)).toStrictEqual([
      '予選',
      'Weekトーナメント',
      'Yearトーナメント',
    ]);
    expect(Object.values(MATCH_RESULT_LABELS)).toStrictEqual([
      '勝利',
      '敗北',
      '不戦勝',
      '両者敗北',
      '予定',
      'マッチ中',
    ]);
    expect(HIDDEN_OPPONENT_LABEL).toBe('非公開のプロダクト');
    expect(NO_VALUE_LABEL).toBe('—');
    expect(NO_LAUNCHES_MESSAGE).toBe('ローンチはまだありません。');
    expect(NO_MATCHES_MESSAGE).toBe('マッチはありません。');
  });

  test('コメントと評価の一覧の項目は文言規則のとおり', () => {
    expect(COMMENT_LIST_CAPTION).toBe('コメントの一覧');
    expect(Object.values(COMMENT_LIST_COLUMNS)).toStrictEqual([
      '本文',
      '投稿者',
      'プロダクト',
      'ローンチ',
      '投稿日時',
      '状態',
      '操作',
    ]);
    expect(EMPTY_COMMENT_BODY_LABEL).toBe('本文なし');
    expect(Object.values(COMMENT_FILTER_LABELS)).toStrictEqual([
      '投稿者のハンドル',
      'プロダクトのハンドル',
      '投稿日の開始日',
      '投稿日の終了日',
      '状態',
      'すべての状態',
    ]);
    expect(COMMENT_LIST_EMPTY_MESSAGE).toBe(
      '条件に一致するコメントはありません。',
    );
    expect(RATING_LIST_CAPTION).toBe('評価の一覧');
    expect(Object.values(RATING_LIST_COLUMNS)).toStrictEqual([
      '評価者',
      'プロダクト',
      '点数',
      '更新日時',
      '状態',
      '操作',
    ]);
    expect(Object.values(RATING_FILTER_LABELS)).toStrictEqual([
      'プロダクトのハンドル',
      '評価者のハンドル',
      '状態',
      'すべての状態',
    ]);
    expect(RATING_STATE_LABELS).toStrictEqual({
      valid: '有効',
      invalidated: '無効化済み',
    });
    expect(RATING_LIST_EMPTY_MESSAGE).toBe('条件に一致する評価はありません。');
    expect(Object.values(RATING_ACTION_LABELS)).toStrictEqual([
      '無効化',
      '無効化の取り消し',
    ]);
    expect(Object.values(COMMENT_ACTION_LABELS)).toStrictEqual([
      '非公開化',
      '復元',
    ]);
    expect(UNREADABLE_USER_LABEL).toBe('表示できない利用者');
  });

  test('画像モデレーションの項目は文言規則のとおり', () => {
    expect(QUARANTINE_REASON_TABS_LABEL).toBe('隔離理由');
    expect(QUARANTINED_IMAGE_LIST_CAPTION).toBe('隔離画像の一覧');
    expect(Object.values(QUARANTINED_IMAGE_ITEM_LABELS)).toStrictEqual([
      '用途',
      '保有者',
      '隔離された日時',
      '隔離理由',
      '検出内容',
    ]);
    expect(NO_FINDINGS_LABEL).toBe('なし');
    expect(SYSTEM_IMAGE_OWNER_LABEL).toBe('システム');
    expect(QUARANTINED_IMAGE_LIST_EMPTY_MESSAGE).toBe(
      'この隔離理由の画像はありません。',
    );
  });
});

describe('検索語の入力', () => {
  test('上限を超えた検索語の文言は文言規則のとおり', () => {
    expect(MODERATION_SEARCH_TERM_TOO_LONG_MESSAGE).toBe(
      '検索語は100文字以内で入力してください。',
    );
  });
});
