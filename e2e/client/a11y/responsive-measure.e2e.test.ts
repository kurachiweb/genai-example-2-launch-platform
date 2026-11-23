import { expect, type Page, test } from '@playwright/test';

import {
  type LayoutIssue,
  measureLayout,
  type StressCondition,
} from './responsive-measure.ts';
import { TEXT_STRETCH_RATIO, VIEWPORT_HEIGHT } from './responsive-report.ts';

const NARROW_WIDTH = 320;

async function measure(
  page: Page,
  body: string,
  condition: StressCondition = 'plain',
): Promise<readonly LayoutIssue[]> {
  await page.setViewportSize({ width: NARROW_WIDTH, height: VIEWPORT_HEIGHT });
  await page.setContent(
    `<!doctype html><html lang="ja"><body style="margin:0">${body}</body></html>`,
  );
  return page.evaluate(measureLayout, {
    condition,
    ratio: TEXT_STRETCH_RATIO,
  });
}

const kindsOf = (issues: readonly LayoutIssue[]): readonly string[] =>
  issues.map(({ kind }) => kind);

test.describe('画面の幅と文字列の伸びの検出器', () => {
  test('はみ出しも重なりも無い画面では問題を返さない', async ({ page }) => {
    const issues = await measure(
      page,
      '<main><h1>見出し</h1><p>本文の段落です。</p><a href="/x">リンク</a> <button>保存</button></main>',
    );

    expect(issues).toEqual([]);
  });

  test('画面の幅を超える要素を、文書の横のはみ出しと要素のはみ出しとして返す', async ({
    page,
  }) => {
    const issues = await measure(
      page,
      '<main><div id="wide" style="width:600px;height:20px">広い</div></main>',
    );

    expect(kindsOf(issues)).toEqual(['horizontal-scroll', 'element-overflow']);
    expect(issues[1]?.targets[0]).toContain('#wide');
  });

  test('横にスクロールできる容器の中の幅は、はみ出しに数えない', async ({
    page,
  }) => {
    const issues = await measure(
      page,
      '<main><div style="overflow-x:auto"><table style="width:600px"><tr><td>表</td></tr></table></div></main>',
    );

    expect(issues).toEqual([]);
  });

  test('高さが固定の枠から溢れた本文が次の段落に重なれば、重なりとして返す', async ({
    page,
  }) => {
    const issues = await measure(
      page,
      '<main><div style="height:20px;width:100px"><p id="spill" style="margin:0">長い本文が枠の高さを超えて何行にも折り返されます長い本文が枠の高さを超えて何行にも折り返されます</p></div><p id="next" style="margin:0">次の段落</p></main>',
    );

    expect(kindsOf(issues)).toEqual(['overlap']);
    expect(issues[0]?.targets.join(' ')).toContain('#spill');
    expect(issues[0]?.targets.join(' ')).toContain('#next');
  });

  test('視覚的に隠した読み上げ用の文字列は、隣の要素との重なりに数えない', async ({
    page,
  }) => {
    const issues = await measure(
      page,
      '<main><button style="position:relative"><span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap">読み上げだけの長い文字列です</span>実</button><a href="/x">隣のリンク</a></main>',
    );

    expect(issues).toEqual([]);
  });

  test('文中で折り返した2つのリンクは、外接の矩形が重なっても行が重ならなければ数えない', async ({
    page,
  }) => {
    const issues = await measure(
      page,
      '<main><p style="margin:0;width:200px">同意するには<a href="/a">利用規約の長い題名のリンク</a>と<a href="/b">個人情報の取り扱いの長い題名</a>の確認が要ります</p></main>',
    );

    expect(issues).toEqual([]);
  });

  test('閉じた開閉部品の中身は、他の要素との重なりに数えない', async ({
    page,
  }) => {
    const issues = await measure(
      page,
      '<main><details><summary>目次</summary><a href="/a">目次の項目</a></details><h2 style="margin:0">本文の見出し</h2></main>',
    );

    expect(issues).toEqual([]);
  });

  test('文字を1.5倍にした時だけ画面の幅を超える要素は、その条件でだけ横のはみ出しとして返す', async ({
    page,
  }) => {
    const body =
      '<main><div style="width:18rem;height:20px">幅の広い要素</div></main>';

    const plain = await measure(page, body);
    const scaled = await measure(page, body, 'font-scale');

    expect(plain).toEqual([]);
    expect(kindsOf(scaled)).toContain('horizontal-scroll');
  });

  test('文字の間隔を広げた時だけ画面の幅を超える折り返さない文字列は、その条件でだけ返す', async ({
    page,
  }) => {
    const body =
      '<main><p style="margin:0;white-space:nowrap">折り返さない文字列がここに入りますよね</p></main>';

    const plain = await measure(page, body);
    const spaced = await measure(page, body, 'text-spacing');

    expect(plain).toEqual([]);
    expect(kindsOf(spaced)).toContain('horizontal-scroll');
  });

  test('固定幅の枠から溢れた本文が、枠の中の操作の部品に重なれば返す', async ({
    page,
  }) => {
    const issues = await measure(
      page,
      '<main><div style="position:relative;width:200px;height:30px;overflow:visible"><p style="margin:0;white-space:nowrap">枠より長い本文の文字列</p><button style="position:absolute;top:0;left:120px">操作</button></div></main>',
    );

    expect(kindsOf(issues)).toEqual(['overlap']);
    expect(issues[0]?.targets.join(' ')).toContain('button');
  });

  test('位置が固定の要素は、重なりに数えない', async ({ page }) => {
    const issues = await measure(
      page,
      '<main><p style="margin:0">本文</p><div style="position:fixed;top:0;left:0">通知</div></main>',
    );

    expect(issues).toEqual([]);
  });

  test('文字列を伸ばすと隣のボタンへ溢れる時だけ、伸ばした条件で重なりを返す', async ({
    page,
  }) => {
    const body =
      '<main><div style="display:flex"><button id="a" style="width:120px;flex:none;white-space:nowrap;overflow:visible">保存して戻る</button><button id="b" style="width:120px;flex:none">取消</button></div></main>';

    const plain = await measure(page, body);
    const stretched = await measure(page, body, 'text-expansion');

    expect(plain).toEqual([]);
    expect(kindsOf(stretched)).toEqual(['overlap']);
  });

  test('伸ばした文字列は、測り終わると元に戻る', async ({ page }) => {
    await measure(
      page,
      '<main><p id="text">元の本文</p></main>',
      'text-expansion',
    );

    await expect(page.locator('#text')).toHaveText('元の本文');
  });

  test('文字の間隔と文字の大きさの条件も、測り終わると元の見た目に戻る', async ({
    page,
  }) => {
    await measure(page, '<main><p id="text">本文</p></main>', 'text-spacing');
    const spacing = await page
      .locator('#text')
      .evaluate((element) => getComputedStyle(element).letterSpacing);
    await measure(page, '<main><p id="text">本文</p></main>', 'font-scale');
    const size = await page
      .locator('#text')
      .evaluate((element) => getComputedStyle(element).fontSize);

    expect(spacing).toBe('normal');
    expect(size).toBe('16px');
  });
});
