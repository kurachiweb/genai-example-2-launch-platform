import { expect, type Locator, type Page } from '@playwright/test';

// トーストはポインタが重なっている間、自動で閉じるまでの時間を止める。操作の後のポインタは押したボタンの位置に残り、
// 画面の下の中央に出るトーストと重なり得るため、トーストにもリンクにも重ならない画面の左端の中ほどへ逃がしてから消えるのを待つ。
// リンクに重ねると先読みの取得が起きるため、左上の角(ロゴ)は使わない
export async function waitForToastDismissed(
  page: Page,
  toast: Locator,
  options: { readonly timeout?: number } = {},
): Promise<void> {
  const viewport = page.viewportSize();
  await page.mouse.move(0, Math.floor((viewport?.height ?? 0) / 2));
  await expect(toast).toHaveCount(0, options);
}
