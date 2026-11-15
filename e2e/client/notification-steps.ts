import {
  type APIRequestContext,
  expect,
  type Locator,
  type Page,
} from '@playwright/test';

import {
  NOTIFICATION_PREFERENCE_SAVED_MESSAGE,
  NOTIFICATION_SETTINGS_PAGE_TITLE,
  OPEN_NOTIFICATION_SETTINGS_LABEL,
  UNSUBSCRIBE_PAGE_TITLE,
  UNSUBSCRIBE_SUBMIT_LABEL,
  unsubscribedMessage,
  unsubscribeQuestion,
} from '../../apps/client/src/components/notifications/notification-messages.ts';
import { SETTINGS_NAVIGATION_LABEL } from '../../apps/client/src/components/settings/settings-messages.ts';
import { SETTINGS_NAV_ITEMS } from '../../apps/client/src/composition/settings-navigation.ts';
import {
  NOTIFICATION_TOPIC_COPY,
  NOTIFICATION_TOPICS,
  type NotificationTopic,
} from '../../apps/common-lib/notifications/notification-topics.ts';
import { resolveLocalWorkerOrigin } from '../support/local-worker-origins.ts';
import { waitForToastDismissed } from '../support/toast.ts';
import { oneClickUnsubscribeUrl } from '../support/unsubscribe-link.ts';
import { openProfileSettings, type TestAccount } from './auth/account-steps.ts';

const NOTIFICATION_SETTINGS_PATH = '/settings/notifications';

const UNSUBSCRIBE_PATH = '/unsubscribe';

const topicLabelOf = (topic: NotificationTopic): string =>
  NOTIFICATION_TOPIC_COPY[topic].label;

const notificationsNavLabel = (): string => {
  const item = SETTINGS_NAV_ITEMS.find(
    ({ to }) => to === NOTIFICATION_SETTINGS_PATH,
  );
  if (item === undefined) {
    throw new Error(
      `設定のナビゲーションに${NOTIFICATION_SETTINGS_PATH}の項目がありません`,
    );
  }
  return item.label;
};

export const topicSwitch = (page: Page, topic: NotificationTopic): Locator =>
  page.getByRole('switch', { name: topicLabelOf(topic), exact: true });

// スイッチはハイドレーションの前に押しても保存されないため、ハイドレーション済みの画面からルーターの遷移で開く
export async function openNotificationSettings(
  page: Page,
  account: TestAccount,
): Promise<void> {
  await openProfileSettings(page, account);
  await page
    .getByRole('navigation', { name: SETTINGS_NAVIGATION_LABEL })
    .getByRole('link', { name: notificationsNavLabel(), exact: true })
    .click();
  await expect(page).toHaveURL(NOTIFICATION_SETTINGS_PATH);
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: NOTIFICATION_SETTINGS_PAGE_TITLE,
    }),
  ).toBeVisible();
}

export async function expectEnabledTopics(
  page: Page,
  enabled: readonly NotificationTopic[],
): Promise<void> {
  for (const topic of NOTIFICATION_TOPICS) {
    await expect(topicSwitch(page, topic)).toBeChecked({
      checked: enabled.includes(topic),
    });
  }
}

// 続けての保存の成功を前の保存のトーストと取り違えないよう、前のトーストが消えてから切り替える
export async function switchTopic(
  page: Page,
  topic: NotificationTopic,
  enabled: boolean,
): Promise<void> {
  const savedToast = page.getByText(NOTIFICATION_PREFERENCE_SAVED_MESSAGE, {
    exact: true,
  });
  await waitForToastDismissed(page, savedToast);
  const target = topicSwitch(page, topic);
  await expect(target).toBeChecked({ checked: !enabled });
  await target.click();
  await expect(savedToast).toBeVisible();
  await expect(target).toBeChecked({ checked: enabled });
}

// トークンは最初の描画で1回だけフラグメントから読まれ、同じ文書のハッシュだけの変更では読み直されないため、新しい文書の読み込みで開く
export async function openUnsubscribeLink(
  page: Page,
  token: string,
): Promise<void> {
  await page.goto(`${UNSUBSCRIBE_PATH}#token=${token}`);
  await expect(
    page.getByRole('heading', { level: 1, name: UNSUBSCRIBE_PAGE_TITLE }),
  ).toBeVisible();
}

const unsubscribedResult = (page: Page, topic: NotificationTopic): Locator =>
  page
    .getByRole('status')
    .filter({ hasText: unsubscribedMessage(topicLabelOf(topic)) });

// 確定のボタンはハイドレーションの後にフラグメントを読んでから現れるため、押下はそのまま効く
export async function confirmUnsubscribe(
  page: Page,
  topic: NotificationTopic,
): Promise<void> {
  await expect(
    page.getByText(unsubscribeQuestion(topicLabelOf(topic))),
  ).toBeVisible();
  await page
    .getByRole('button', { name: UNSUBSCRIBE_SUBMIT_LABEL, exact: true })
    .click();
  await expect(unsubscribedResult(page, topic)).toBeVisible();
}

export async function openSettingsFromUnsubscribeResult(
  page: Page,
  topic: NotificationTopic,
): Promise<void> {
  await unsubscribedResult(page, topic)
    .getByRole('link', { name: OPEN_NOTIFICATION_SETTINGS_LABEL, exact: true })
    .click();
  await expect(page).toHaveURL(NOTIFICATION_SETTINGS_PATH);
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: NOTIFICATION_SETTINGS_PAGE_TITLE,
    }),
  ).toBeVisible();
}

// ローカルのイベントサーバーのオリジンはhttps:でなく通知メールにList-Unsubscribeが付かないため、メールソフトの代わりにワンクリックの経路へ直接送る
export async function postOneClickUnsubscribe(
  request: APIRequestContext,
  token: string,
): Promise<number> {
  const response = await request.post(
    oneClickUnsubscribeUrl(
      resolveLocalWorkerOrigin('event', process.env),
      token,
    ),
    { form: { 'List-Unsubscribe': 'One-Click' }, maxRedirects: 0 },
  );
  return response.status();
}
