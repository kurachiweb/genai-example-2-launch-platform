import { describe, expect, test } from 'bun:test';
import { dirname, join } from 'node:path';

import { RETRY_LABEL } from '../../../lib/utilities/messages/state-messages.ts';
import {
  alreadyUnsubscribedMessage,
  CHANGE_EMAIL_LINK_LABEL,
  DELIVERY_STATUS_UNAVAILABLE_MESSAGE,
  EMAIL_UNVERIFIED_NOTICE,
  INVALID_UNSUBSCRIBE_LINK_MESSAGE,
  NOTIFICATION_PREFERENCE_SAVED_MESSAGE,
  NOTIFICATION_SETTINGS_PAGE_TITLE,
  NOTIFICATION_SETTINGS_SECTION_DESCRIPTION,
  NOTIFICATION_SETTINGS_SECTION_TITLE,
  OPEN_NOTIFICATION_SETTINGS_LABEL,
  REJECTED_SUPPRESSION_MESSAGE_PARTS,
  SUSPENDED_NOTIFICATION_SETTINGS_NOTICE,
  SUPPRESSION_MESSAGES,
  UNSUBSCRIBE_FAILED_MESSAGE,
  UNSUBSCRIBE_PAGE_TITLE,
  UNSUBSCRIBE_SUBMIT_LABEL,
  unsubscribedMessage,
  unsubscribeQuestion,
} from './notification-messages.ts';

const COPY_RULES_PATH = 'docs/GUIDES/service/design/003-text-and-copy-rules.md';

const COPY_SECTION_HEADING = '### 通知の画面の文言';

const TOPIC_PLACEHOLDER = '<種別>';

const UNTIL_PLACEHOLDER = '<日時>';

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
  // 表の先頭の2行は見出しと区切りのため、3行目からを値の行とする
  return new Map(
    rows.slice(2).map((row) => {
      const [scene = '', copy = ''] = row
        .slice(1, -1)
        .split('|')
        .map((cell) => cell.trim());
      return [scene, copy] as const;
    }),
  );
};

const COPY_TABLE = copyTableOf(COPY_SECTION_HEADING);

const copyOf = (scene: string): string => {
  const copy = COPY_TABLE.get(scene);
  if (copy === undefined) {
    throw new Error(`文言規則の「${scene}」の行がありません。`);
  }
  return copy;
};

describe('通知設定ページの文言', () => {
  test('題名は設定のナビゲーションの項目と同じ文言にする', () => {
    expect(NOTIFICATION_SETTINGS_PAGE_TITLE).toBe(
      copyOf('通知設定ページの題名・設定のナビゲーションの項目'),
    );
  });

  test('区画の見出しと説明は文言規則と一致する', () => {
    expect(
      `見出し「${NOTIFICATION_SETTINGS_SECTION_TITLE}」、説明「${NOTIFICATION_SETTINGS_SECTION_DESCRIPTION}」`,
    ).toBe(copyOf('通知設定の区画'));
  });

  test('受信可否を保存した時のトーストは文言規則と一致する', () => {
    expect(NOTIFICATION_PREFERENCE_SAVED_MESSAGE).toBe(
      copyOf('受信可否を保存した時(トースト)'),
    );
  });

  test.each([
    ['BOUNCE', '配信の停止中(恒久的なバウンス、FR-NOTIF-023)'],
    ['COMPLAINT', '配信の停止中(苦情、FR-NOTIF-023)'],
  ] as const)('抑止の理由(%s)の文言は文言規則と一致する', (reason, scene) => {
    expect(SUPPRESSION_MESSAGES[reason]).toBe(copyOf(scene));
  });

  test('受信側の拒否の文言は、日時の前後の文を合わせると文言規則と一致する', () => {
    const { beforeUntil, afterUntil } = REJECTED_SUPPRESSION_MESSAGE_PARTS;

    expect(
      `${beforeUntil}${UNTIL_PLACEHOLDER}${afterUntil}(${UNTIL_PLACEHOLDER}は閲覧者のタイムゾーンで示す)`,
    ).toBe(copyOf('配信の停止中(受信側の拒否、FR-NOTIF-023)'));
  });

  test('抑止の理由に添えるメールアドレスの変更への導線は文言規則と一致する', () => {
    expect(copyOf('配信の停止中の導線')).toStartWith(
      `「${CHANGE_EMAIL_LINK_LABEL}」(アカウントの設定ページへのリンク)`,
    );
  });

  test('配信の状態を照会できない時の文言は文言規則と一致する', () => {
    expect(DELIVERY_STATUS_UNAVAILABLE_MESSAGE).toBe(
      copyOf('配信の状態を照会できない時'),
    );
  });

  test('メールアドレス未確認の案内は文言規則と一致する', () => {
    expect(EMAIL_UNVERIFIED_NOTICE).toBe(
      copyOf('メールアドレス未確認の利用者の通知設定'),
    );
  });

  test('停止中の利用者の案内は文言規則と一致する', () => {
    expect(SUSPENDED_NOTIFICATION_SETTINGS_NOTICE).toBe(
      copyOf('停止中の利用者の通知設定'),
    );
  });
});

describe('配信停止ページの文言', () => {
  test('題名は文言規則と一致する', () => {
    expect(UNSUBSCRIBE_PAGE_TITLE).toBe(copyOf('配信停止ページの題名'));
  });

  test('確認の文とボタンは文言規則と一致する', () => {
    expect(
      `「${unsubscribeQuestion(TOPIC_PLACEHOLDER)}」、ボタン「${UNSUBSCRIBE_SUBMIT_LABEL}」`,
    ).toBe(copyOf('配信停止の確認'));
  });

  test('確認の文は種別の名称を鉤括弧で囲む', () => {
    expect(unsubscribeQuestion('勝敗結果')).toBe(
      '「勝敗結果」の通知メールの配信を停止しますか?',
    );
  });

  test('完了の文と通知設定へのリンクは文言規則と一致する', () => {
    expect(
      `「${unsubscribedMessage(TOPIC_PLACEHOLDER)}」、リンク「${OPEN_NOTIFICATION_SETTINGS_LABEL}」`,
    ).toBe(copyOf('配信停止の完了'));
  });

  test('既に停止している時の文は文言規則と一致する', () => {
    expect(alreadyUnsubscribedMessage(TOPIC_PLACEHOLDER)).toBe(
      copyOf('配信停止のリンクの種別が既に停止している時'),
    );
    expect(alreadyUnsubscribedMessage('マッチ開始予告')).toBe(
      '「マッチ開始予告」の通知メールは既に配信を停止しています。',
    );
  });

  test('リンクが無い・無効・失効済みの時の文と通知設定へのリンクは文言規則と一致する', () => {
    expect(
      `「${INVALID_UNSUBSCRIBE_LINK_MESSAGE}」、リンク「${OPEN_NOTIFICATION_SETTINGS_LABEL}」`,
    ).toBe(copyOf('配信停止のリンクが無い・無効・失効済みの時'));
  });

  test('失敗の文と、共通の再試行のボタンの文言は文言規則と一致する', () => {
    expect(copyOf('配信停止の失敗')).toStartWith(
      `「${UNSUBSCRIBE_FAILED_MESSAGE}」、ボタン「${RETRY_LABEL}」`,
    );
  });
});
