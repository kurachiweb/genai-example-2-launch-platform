import { expect, type Locator } from '@playwright/test';

const BOT_TOKEN_FIELD_SELECTOR = 'input[name="cf-turnstile-response"]';

// bot判定のトークンが無い送信は拒否されるため、非表示のウィジェットがフォームの中の入力欄へトークンを書き込むまで待つ。ウィジェットはハイドレーションの後に描かれるため、入力の前に待てばハイドレーションの前の操作の取りこぼしも防げる
export async function waitForBotToken(form: Locator): Promise<void> {
  await expect(form.locator(BOT_TOKEN_FIELD_SELECTOR)).not.toHaveValue('');
}
