import { toast } from 'sonner';
import { expect } from 'vitest';

// トーストはポインターが重なっている間、自動で閉じるまでの時間を止める。押したボタンの位置に残ったポインターが画面の下の中央のトーストに重なると、
// トーストが後で押す要素を覆い続けるため、表示を確かめた後に閉じて、文書から消えるまで待つ
export async function dismissToasts(): Promise<void> {
  toast.dismiss();
  await expect
    .poll(() => document.querySelectorAll('[data-sonner-toast]').length)
    .toBe(0);
}
