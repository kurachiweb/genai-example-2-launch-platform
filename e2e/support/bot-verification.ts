import { expect, type Locator } from '@playwright/test';

const BOT_TOKEN_FIELD_SELECTOR = 'input[name="cf-turnstile-response"]';

// ウィジェットのスクリプトは外部から読み込み、開発サーバーでは起動直後に画面のスクリプトの変換も重なるため、トークンが届くまで既定の検証の待ち時間より長く待つ
const BOT_TOKEN_TIMEOUT_MS = 20_000;

// bot判定のトークンが無い送信は拒否されるため、非表示のウィジェットがフォームの中の入力欄へトークンを書き込むまで待つ。ウィジェットはハイドレーションの後に描かれるため、入力の前に待てばハイドレーションの前の操作の取りこぼしも防げる
export async function waitForBotToken(form: Locator): Promise<void> {
  await expect(form.locator(BOT_TOKEN_FIELD_SELECTOR)).not.toHaveValue('', {
    timeout: BOT_TOKEN_TIMEOUT_MS,
  });
}
