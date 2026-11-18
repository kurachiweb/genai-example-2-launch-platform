import { describe, expect, test } from 'bun:test';
import { dirname, join } from 'node:path';

import { CONTACT_LABEL } from '../../../lib/utilities/messages/state-messages.ts';
import { SPONSORSHIP_PURCHASE_CONDITIONS } from '../../../common-lib/sponsorship/sponsorship-purchase-conditions.ts';
import {
  SPONSORSHIP_STATUSES,
  SPONSORSHIP_STATUS_LABELS,
} from '../../../common-lib/sponsorship/sponsorship-status.ts';
import {
  SPONSOR_LABEL_TEXT,
  SPONSORSHIP_TIER_LABELS,
  SPONSORSHIP_TIERS,
} from '../../../common-lib/sponsorship/sponsorship-tiers.ts';
import {
  MY_PRODUCTS_LINK_HREF,
  MY_PRODUCTS_LINK_LABEL,
  MY_SPONSORSHIP_ITEM_LABELS,
  MY_SPONSORSHIPS_EMPTY_MESSAGE,
  MY_SPONSORSHIPS_HREF,
  MY_SPONSORSHIPS_LOAD_ERROR_MESSAGE,
  MY_SPONSORSHIPS_LOAD_MORE_LABEL,
  MY_SPONSORSHIPS_LOADING_MORE_LABEL,
  MY_SPONSORSHIPS_PAGE_TITLE,
  PRODUCT_SPONSORSHIP_DELETE_NOTICE,
  RESUME_SPONSORSHIP_CHECKOUT_LABEL,
  SPONSORED_PRODUCT_DELETED_NAME,
  sponsoredAdLinkLabel,
  SPONSORSHIP_ACCOUNT_SUSPENDED_REASON,
  SPONSORSHIP_APPLY_HREF,
  SPONSORSHIP_APPLY_LINK_LABEL,
  SPONSORSHIP_APPLY_SUBMIT_LABEL,
  SPONSORSHIP_DATE_REASON_MESSAGES,
  SPONSORSHIP_EMAIL_UNVERIFIED_REASON,
  SPONSORSHIP_ERROR_MESSAGES,
  SPONSORSHIP_FORM_LABELS,
  SPONSORSHIP_LOGIN_TO_APPLY_LABEL,
  SPONSORSHIP_NO_ELIGIBLE_PRODUCTS_MESSAGE,
  SPONSORSHIP_PAUSED_NOTICE,
  SPONSORSHIP_PERIOD_SEPARATOR,
  SPONSORSHIP_PRICE_PER_DAY_SUFFIX,
  SPONSORSHIP_PRICE_UNAVAILABLE_MESSAGE,
  SPONSORSHIP_PRICING_SECTION_ID,
  SPONSORSHIP_PRICING_SECTION_TITLE,
  SPONSORSHIP_REFUND_REJECTED_MESSAGE_PARTS,
  SPONSORSHIP_REFUND_REMAINING_AMOUNT_LABEL,
  SPONSORSHIP_SUBMIT_PENDING_LABEL,
  SPONSORSHIP_TERMINATED_ON_LABEL,
  SPONSORSHIP_TERMINATION_REASON_LABEL,
  SPONSORSHIP_TIER_CONTENTS,
  SPONSORSHIP_TIER_POSITIONS,
  SPONSORSHIP_UNPAID_AMOUNT_TEXT,
  sponsorshipDaysLabel,
  sponsorshipErrorMessageOf,
  sponsorshipPlacementLabel,
  sponsorshipRefundedMessage,
  sponsorshipRefundRequestedParts,
} from './sponsorship-messages.ts';

const COPY_RULES_PATH = 'docs/GUIDES/service/design/003-text-and-copy-rules.md';

// テストの置き場所によらず読めるよう、文言規則のファイルを上の階層へ順に探す
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

const copyRuleLines = (await findCopyRules()).split('\n');

// 節の中の表の行を、1列目の場面から2列目の文言を引く対応表にする。見出しと区切りの行も含まれるが、場面の名前と重ならない
const copyTableOf = (heading: string): ReadonlyMap<string, string> => {
  const start = copyRuleLines.indexOf(heading);
  if (start === -1) {
    throw new Error(`文言規則に「${heading}」の節がありません。`);
  }
  const end = copyRuleLines.findIndex(
    (line, index) => index > start && /^#{1,3} /u.test(line),
  );
  const rows = copyRuleLines
    .slice(start + 1, end === -1 ? undefined : end)
    .filter((line) => line.startsWith('|'));
  return new Map(
    rows.map((row) => {
      const [scene = '', copy = ''] = row
        .slice(1, -1)
        .split('|')
        .map((cell) => cell.trim());
      return [scene, copy] as const;
    }),
  );
};

const lookupIn =
  (table: ReadonlyMap<string, string>) =>
  (scene: string): string => {
    const copy = table.get(scene);
    if (copy === undefined) {
      throw new Error(`文言規則の「${scene}」の行がありません。`);
    }
    return copy;
  };

const screenCopyOf = lookupIn(copyTableOf('### スポンサー広告の画面の文言'));

const errorCopyOf = lookupIn(copyTableOf('## エラーメッセージ'));

const stateCopyOf = lookupIn(copyTableOf('## 状態・案内の文言'));

const checkoutCopyOf = lookupIn(copyTableOf('### 決済の画面の文言'));

describe('広告スペースの文言', () => {
  test('広告のラベルとティアの表示名は文言規則と一致する', () => {
    expect(screenCopyOf('広告のラベル(FR-SPONS-013)')).toStartWith(
      SPONSOR_LABEL_TEXT,
    );
    expect(
      SPONSORSHIP_TIERS.map((tier) => SPONSORSHIP_TIER_LABELS[tier]).join('、'),
    ).toBe(screenCopyOf('ティアの表示名'));
  });

  test('広告の区画の名前はティアの表示名に「スポンサー広告」を続ける', () => {
    expect(SPONSORSHIP_TIERS.map(sponsorshipPlacementLabel).join('、')).toBe(
      screenCopyOf('広告の区画の名前(画面に見えない文言)'),
    );
  });

  test('広告のリンクの読み上げの名前は名称を含む', () => {
    expect(sponsoredAdLinkLabel('<名称>')).toBe(
      screenCopyOf('広告のリンクの読み上げの名前'),
    );
    expect(sponsoredAdLinkLabel('Pitch Notes')).toBe(
      'Pitch Notesのサイトを別タブで開く(スポンサー広告)',
    );
  });

  test('申込の導線は料金ページのスポンサー広告の区画へのリンクである', () => {
    expect(SPONSORSHIP_APPLY_HREF).toBe('/pricing#sponsorship');
    expect(
      SPONSORSHIP_APPLY_HREF.endsWith(`#${SPONSORSHIP_PRICING_SECTION_ID}`),
    ).toBe(true);
    expect(
      screenCopyOf(
        '広告の申込の導線(Gold・Silverの並びの末尾、ログイン中だけ)',
      ),
    ).toStartWith(
      `${SPONSORSHIP_APPLY_LINK_LABEL}(料金ページのスポンサー広告の区画\`${SPONSORSHIP_APPLY_HREF}\`へのリンク)`,
    );
  });
});

describe('料金ページの区画の文言', () => {
  test('区画の見出しは文言規則と一致する', () => {
    expect(SPONSORSHIP_PRICING_SECTION_TITLE).toBe(
      screenCopyOf('料金ページのスポンサー広告の区画の見出し'),
    );
  });

  test('ティアごとの単価の単位・表示位置・表示内容・照会できない時の文言は文言規則に含まれる', () => {
    const copy = screenCopyOf('ティアごとの単価と説明');

    expect(copy).toContain(`「<金額>${SPONSORSHIP_PRICE_PER_DAY_SUFFIX}」`);
    expect(copy).toContain(
      `表示位置(Legend「${SPONSORSHIP_TIER_POSITIONS.legend}」、Gold「${SPONSORSHIP_TIER_POSITIONS.gold}」、Silver「${SPONSORSHIP_TIER_POSITIONS.silver}」)`,
    );
    expect(SPONSORSHIP_TIER_CONTENTS.legend).toBe(
      SPONSORSHIP_TIER_CONTENTS.gold,
    );
    expect(copy).toContain(
      `表示内容(Legend・Gold「${SPONSORSHIP_TIER_CONTENTS.gold}」、Silver「${SPONSORSHIP_TIER_CONTENTS.silver}」)`,
    );
    expect(copy).toContain(`「${SPONSORSHIP_PRICE_UNAVAILABLE_MESSAGE}」`);
  });
});

describe('申込のフォームの文言', () => {
  test('欄と項目の名前と日数の表示は文言規則と一致する', () => {
    const { product, productPlaceholder, tier, startsOn, endsOn, days, total } =
      SPONSORSHIP_FORM_LABELS;

    expect(
      `欄「${product}」(未選択の表示「${productPlaceholder}」)「${tier}」「${startsOn}」「${endsOn}」、項目「${days}」「${total}」、日数の表示「${sponsorshipDaysLabel(7)}」(開始日と終了日を含めて数える)`,
    ).toBe(screenCopyOf('申込のフォームの欄'));
  });

  test('申し込めるプロダクトが無い時の案内と導線は文言規則と一致する', () => {
    expect(MY_PRODUCTS_LINK_HREF).toBe('/my/products');
    expect(
      `${SPONSORSHIP_NO_ELIGIBLE_PRODUCTS_MESSAGE}(続けて導線「${MY_PRODUCTS_LINK_LABEL}」(\`${MY_PRODUCTS_LINK_HREF}\`へのリンク))`,
    ).toBe(screenCopyOf('申し込めるプロダクトが無い時'));
  });

  test('返金の扱いの注記は最終確認画面の購入の条件の3つの文と同じで、文言規則にある', () => {
    const conditions = checkoutCopyOf('スポンサー広告の最終確認画面の表示事項');

    expect(SPONSORSHIP_PURCHASE_CONDITIONS).toHaveLength(3);
    expect(conditions).toContain(
      `購入の条件「${SPONSORSHIP_PURCHASE_CONDITIONS.join('/')}」`,
    );
  });

  test('申込のボタン・送信中・未ログインのボタンは文言規則と一致する', () => {
    expect(screenCopyOf('申込のボタン')).toStartWith(
      `${SPONSORSHIP_APPLY_SUBMIT_LABEL}(送信中は「${SPONSORSHIP_SUBMIT_PENDING_LABEL}」)。`,
    );
    expect(screenCopyOf('未ログインの閲覧者の申込のボタン')).toStartWith(
      `${SPONSORSHIP_LOGIN_TO_APPLY_LABEL}(`,
    );
  });

  test('メールアドレス未確認と停止中の理由はエラーメッセージの文言と一致する', () => {
    expect(SPONSORSHIP_EMAIL_UNVERIFIED_REASON).toBe(
      errorCopyOf('メール未確認'),
    );
    expect(SPONSORSHIP_ACCOUNT_SUSPENDED_REASON).toBe(
      errorCopyOf('停止中アカウント(パスワード合致時)'),
    );
  });
});

describe('掲載期間のカレンダーの選べない日の理由', () => {
  test('開始日の範囲の外は開始日の文言、終了日の範囲の外は終了日の文言にし、エラーメッセージの文言と一致する', () => {
    const startMessage = errorCopyOf('スポンサー広告の開始日の範囲の外');
    const endMessage = errorCopyOf('スポンサー広告の終了日の範囲の外');

    expect(SPONSORSHIP_DATE_REASON_MESSAGES).toStrictEqual({
      past: startMessage,
      out_of_range: startMessage,
      before_start: endMessage,
      too_long: endMessage,
      overlap: '同じティアの広告の掲載期間と重なるため選べません。',
    });
  });

  test('3つの文は文言規則の選べない日の理由の行にある', () => {
    const copy = screenCopyOf('掲載期間のカレンダーの選べない日の理由');

    for (const message of new Set(
      Object.values(SPONSORSHIP_DATE_REASON_MESSAGES),
    )) {
      expect(copy).toContain(`「${message}」`);
    }
  });
});

describe('エラーコードごとの文言', () => {
  test.each([
    [
      'sponsorship_product_ineligible',
      'スポンサー広告を申し込めないプロダクト',
    ],
    ['sponsorship_overlap', 'スポンサー広告の掲載期間の重なり'],
    [
      'sponsorship_not_found',
      'スポンサー広告の申込が見つからない(本人以外・存在しない)',
    ],
    [
      'sponsorship_not_payable',
      'スポンサー広告の申込の決済の再開(開始日の経過・決済済み)',
    ],
    [
      'sponsorship_period_invalid',
      'スポンサー広告の申込の掲載期間の誤り(決済の開始)',
    ],
  ] as const)('%sの文言は文言規則と一致する', (code, scene) => {
    expect(SPONSORSHIP_ERROR_MESSAGES[code]).toBe(errorCopyOf(scene));
    expect(sponsorshipErrorMessageOf(code)).toBe(errorCopyOf(scene));
  });

  test('本specの業務のエラーコードでなければnullを返し、画面は共通の文言に任せる', () => {
    expect(sponsorshipErrorMessageOf('payments_unavailable')).toBeNull();
    expect(sponsorshipErrorMessageOf('toString')).toBeNull();
    expect(sponsorshipErrorMessageOf(undefined)).toBeNull();
  });
});

describe('自分の広告一覧の文言', () => {
  test('題名と経路は設定のナビゲーションの項目と同じにする', () => {
    expect(MY_SPONSORSHIPS_PAGE_TITLE).toBe(
      screenCopyOf('自分の広告一覧の題名・設定のナビゲーションの項目'),
    );
    expect(MY_SPONSORSHIPS_HREF).toBe('/settings/sponsorships');
  });

  test('掲載期間の区切りと未決済の金額は文言規則と一致する', () => {
    const copy = screenCopyOf('自分の広告一覧の項目');

    expect(copy).toContain(
      `掲載期間「<開始日>${SPONSORSHIP_PERIOD_SEPARATOR}<終了日>」と「<日数>日間」`,
    );
    expect(sponsorshipDaysLabel(30)).toBe('30日間');
    expect(copy).toContain(`(未決済は「${SPONSORSHIP_UNPAID_AMOUNT_TEXT}」)`);
  });

  test('項目名は文言規則と一致する', () => {
    expect(screenCopyOf('自分の広告一覧の項目')).toContain(
      `項目名は「${MY_SPONSORSHIP_ITEM_LABELS.period}」「${MY_SPONSORSHIP_ITEM_LABELS.amountPaid}」「${MY_SPONSORSHIP_ITEM_LABELS.status}」`,
    );
  });

  test('掲載状況の表示名は共用部品の表示名と一致する', () => {
    expect(
      screenCopyOf('掲載状況の表示名(状態の表示のため「。」を付けない)'),
    ).toStartWith(
      `${SPONSORSHIP_STATUSES.map((status) => SPONSORSHIP_STATUS_LABELS[status]).join('、')}。`,
    );
  });

  test('表示停止中の注記と強制終了の項目は文言規則と一致する', () => {
    expect(SPONSORSHIP_PAUSED_NOTICE).toBe(screenCopyOf('表示停止中の注記'));
    expect(
      `項目「${SPONSORSHIP_TERMINATED_ON_LABEL}」(業務日付)と「${SPONSORSHIP_TERMINATION_REASON_LABEL}」`,
    ).toBe(screenCopyOf('強制終了の表示'));
  });

  test('依頼済みの返金は金額の前後の文と残りの全額の表示を合わせると文言規則と一致する', () => {
    const termination = sponsorshipRefundRequestedParts('termination', 3);
    const displayStop = sponsorshipRefundRequestedParts('display_stop', 2);

    expect(termination).toStrictEqual({
      beforeAmount: '未掲載の3日分',
      afterAmount: 'を返金します',
    });
    expect(displayStop).toStrictEqual({
      beforeAmount: '表示を止めた2日分',
      afterAmount: 'を返金します',
    });
    const placeholder = (kind: 'termination' | 'display_stop') => {
      const { beforeAmount, afterAmount } = sponsorshipRefundRequestedParts(
        kind,
        0,
      );
      return `「${beforeAmount.replace('0', '{n}')}{金額}${afterAmount}」`;
    };
    expect(
      `${placeholder('termination')}${placeholder('display_stop')}。残りの全額で依頼した返金は\`{金額}\`を「${SPONSORSHIP_REFUND_REMAINING_AMOUNT_LABEL}」に置き換える`,
    ).toBe(screenCopyOf('返金の表示(依頼済み)'));
  });

  test('返金済みの返金は文言規則と一致する', () => {
    expect(sponsorshipRefundedMessage('termination', 3)).toBe(
      '未掲載の3日分は返金済みです',
    );
    expect(
      `「${sponsorshipRefundedMessage('termination', 0).replace('0', '{n}')}」「${sponsorshipRefundedMessage('display_stop', 0).replace('0', '{n}')}」`,
    ).toBe(screenCopyOf('返金の表示(返金済み)'));
  });

  test('拒否された返金は、問い合わせへのリンクの前後の文を合わせると文言規則と一致する', () => {
    const { beforeLink, linkLabel, afterLink } =
      SPONSORSHIP_REFUND_REJECTED_MESSAGE_PARTS;

    expect(linkLabel).toBe(CONTACT_LABEL);
    expect(
      `${beforeLink}${linkLabel}${afterLink}(「${linkLabel}」は問い合わせの画面へのリンク)`,
    ).toBe(screenCopyOf('返金の表示(拒否)'));
  });

  test('削除したプロダクトの名称・決済へ進むのボタンは文言規則と一致する', () => {
    expect(SPONSORED_PRODUCT_DELETED_NAME).toBe(
      screenCopyOf('論理削除したプロダクトの名称(自分の広告一覧)'),
    );
    expect(
      `${RESUME_SPONSORSHIP_CHECKOUT_LABEL}(送信中は「${SPONSORSHIP_SUBMIT_PENDING_LABEL}」)`,
    ).toBe(screenCopyOf('未決済の申込の決済の再開のボタン'));
  });

  test('0件・取得エラー・続きの読み込みは文言規則と一致する', () => {
    expect(
      `${MY_SPONSORSHIPS_EMPTY_MESSAGE}(続けて導線「${SPONSORSHIP_APPLY_LINK_LABEL}」(\`${SPONSORSHIP_APPLY_HREF}\`へのリンク))`,
    ).toBe(screenCopyOf('自分の広告一覧の0件'));
    expect(screenCopyOf('自分の広告一覧の取得エラー')).toStartWith(
      `${MY_SPONSORSHIPS_LOAD_ERROR_MESSAGE}(ボタン「再試行」)`,
    );
    expect(
      `「${MY_SPONSORSHIPS_LOAD_MORE_LABEL}」(読み込み中は「${MY_SPONSORSHIPS_LOADING_MORE_LABEL}」)`,
    ).toBe(screenCopyOf('自分の広告一覧の続きの読み込み'));
  });
});

describe('プロダクトの削除の確認の文言', () => {
  test('削除の注意書きは文言規則と一致する', () => {
    expect(PRODUCT_SPONSORSHIP_DELETE_NOTICE).toBe(
      stateCopyOf('スポンサー広告の削除の注意書き(削除の確認のダイアログ)'),
    );
  });
});
