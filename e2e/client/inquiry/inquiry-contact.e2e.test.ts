import type { Page } from '@playwright/test';

import {
  INQUIRY_MESSAGE_FORM_LABEL,
  INQUIRY_STATUS_LABEL,
  SUSPENDED_CHAT_NOTICE_LINK,
} from '../../../apps/client/src/components/inquiry/inquiry-chat-messages.ts';
import { SUSPENDED_CONTACT_NOTICE_LABEL } from '../../../apps/client/src/components/inquiry/inquiry-contact-messages.ts';
import { CONTACT_HREF } from '../../../apps/client/src/components/layout/site-links.ts';
import { INQUIRY_CATEGORY_OTHER_NAME } from '../../../apps/common-lib/inquiry/inquiry-category-constants.ts';
import { INQUIRY_STATUS_LABELS } from '../../../apps/common-lib/inquiry/inquiry-status.ts';
import { INQUIRY_ATTACHMENTS_LABEL } from '../../../apps/frontend-lib/utilities/messages/inquiry-display-messages.ts';
import { executeLocalD1, sqlStringLiteral } from '../../support/local-d1.ts';
import {
  createTestAccount,
  registerAccount,
  type TestAccount,
} from '../auth/account-steps.ts';
import { expect, test } from '../auth/auth-test.ts';
import {
  ATTACHMENT_FILE_NAME,
  chatHeading,
  chatLog,
  createGuestInquiryInput,
  expectGuestInquiryCompleted,
  type GuestInquiryInput,
  INQUIRY_FLOW_TIMEOUT_MS,
  openContactForm,
  submitGuestInquiry,
  submitMemberInquiry,
  uniqueText,
} from './inquiry-steps.ts';

// 未ログインの問い合わせを管理画面で見る流れは別のテストで確かめるため、ここでは未ログインの問い合わせとして「未対応」で保存されたことを保存先で確かめる
async function expectSavedGuestInquiry(
  input: GuestInquiryInput,
): Promise<void> {
  const rows = await executeLocalD1(
    `SELECT nickname, status FROM guest_inquiries WHERE email = ${sqlStringLiteral(input.email)} AND body = ${sqlStringLiteral(input.body)};`,
  );
  expect(rows).toEqual([{ nickname: input.nickname, status: 'open' }]);
}

async function expectFirstMessage(
  page: Page,
  account: TestAccount,
  body: string,
): Promise<void> {
  const main = page.getByRole('main');
  await expect(
    main.getByRole('term').filter({ hasText: INQUIRY_STATUS_LABEL }),
  ).toBeVisible();
  for (const value of [
    INQUIRY_CATEGORY_OTHER_NAME,
    INQUIRY_STATUS_LABELS.open,
  ]) {
    await expect(
      main.getByRole('definition').filter({ hasText: value }),
    ).toBeVisible();
  }
  const message = chatLog(page).getByRole('listitem').filter({ hasText: body });
  await expect(message).toHaveCount(1);
  await expect(message).toContainText(account.nickname);
}

// 画面で停止させる手段は管理者側の機能のため、ローカルのD1で利用者を停止中にする。状態は要求ごとに保存済みの値から読まれるため、次の要求から反映される
async function suspendUser(account: TestAccount): Promise<void> {
  const suspended = await executeLocalD1(
    `UPDATE users SET status = ${sqlStringLiteral('suspended')}, suspended_at = ${String(Date.now())} WHERE email = ${sqlStringLiteral(account.email)} AND deleted_at IS NULL RETURNING id;`,
  );
  if (suspended.length !== 1) {
    throw new Error(
      `ローカルのD1で利用者${account.email}を停止中にできませんでした`,
    );
  }
}

test.describe('問い合わせの送信(利用者側)', () => {
  test('ログインしていない利用者が送信すると、フォームが送信完了の表示に置き換わり、未対応の未ログインの問い合わせとして保存される', async ({
    page,
  }) => {
    test.setTimeout(INQUIRY_FLOW_TIMEOUT_MS);
    const input = createGuestInquiryInput();

    const form = await openContactForm(page);
    await submitGuestInquiry(form, input);

    await expectGuestInquiryCompleted(page);
    await expectSavedGuestInquiry(input);
  });

  test('ログイン中の利用者がファイルを添付して送信すると、その問い合わせのチャットへ移り、最初のメッセージと添付が表示される', async ({
    page,
  }) => {
    test.setTimeout(INQUIRY_FLOW_TIMEOUT_MS);
    const account = createTestAccount();
    await registerAccount(page, account);
    const body = uniqueText('添付付きの問い合わせ');

    await submitMemberInquiry(page, {
      body,
      attachment: uniqueText('添付ファイルの本文'),
    });

    await expectFirstMessage(page, account, body);
    await expect(
      chatLog(page)
        .getByRole('listitem')
        .filter({ hasText: body })
        .getByRole('list', { name: INQUIRY_ATTACHMENTS_LABEL, exact: true })
        .getByRole('link', { name: ATTACHMENT_FILE_NAME }),
    ).toBeVisible();
    await expect(
      page.getByRole('form', { name: INQUIRY_MESSAGE_FORM_LABEL, exact: true }),
    ).toBeVisible();
  });

  test('停止中の利用者は、既存のチャットで送信欄の代わりに案内が出て、お問い合わせのページでは連絡先を入力するフォームから未ログインの問い合わせとして送信できる', async ({
    page,
  }) => {
    test.setTimeout(INQUIRY_FLOW_TIMEOUT_MS);
    const account = createTestAccount();
    await registerAccount(page, account);
    const body = uniqueText('停止の前の問い合わせ');
    const chatPath = await submitMemberInquiry(page, { body });

    await suspendUser(account);

    await page.goto(chatPath);
    await expect(chatHeading(page)).toBeVisible();
    await expectFirstMessage(page, account, body);
    const chatNotice = page
      .getByRole('main')
      .getByRole('note', { name: SUSPENDED_CONTACT_NOTICE_LABEL, exact: true });
    await expect(
      chatNotice.getByRole('link', {
        name: SUSPENDED_CHAT_NOTICE_LINK,
        exact: true,
      }),
    ).toHaveAttribute('href', CONTACT_HREF);
    await expect(
      page.getByRole('form', { name: INQUIRY_MESSAGE_FORM_LABEL, exact: true }),
    ).toHaveCount(0);

    const form = await openContactForm(page);
    await expect(
      page.getByRole('main').getByRole('note', {
        name: SUSPENDED_CONTACT_NOTICE_LABEL,
        exact: true,
      }),
    ).toBeVisible();
    const input = {
      ...createGuestInquiryInput(),
      body: uniqueText('停止中の問い合わせ'),
    };
    await submitGuestInquiry(form, input);

    await expectGuestInquiryCompleted(page);
    await expectSavedGuestInquiry(input);
  });
});
