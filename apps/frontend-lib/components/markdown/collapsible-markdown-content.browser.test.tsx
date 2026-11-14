import { act, type ReactElement } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-react';

import {
  type RenderedMarkdown,
  renderMarkdown,
} from '../../../common-lib/markdown/render-markdown.ts';
import '../../styles/base.css';
import { runAxe } from '../../test/a11y.ts';
import { applyColorScheme, COLOR_SCHEMES } from '../../test/computed-style.ts';
import { emulateReducedMotion } from '../../test/reduced-motion.ts';
import { CollapsibleMarkdownContent } from './collapsible-markdown-content.tsx';

const SITE_ORIGIN = 'https://client.example';

const COLLAPSED_HEIGHT = 240;

const READ_MORE = '続きを読む';

const COLLAPSE = '折りたたむ';

const PARAGRAPH =
  '作った製品を投稿して、投票で競い合います。長い説明文は指定の高さで折りたたみ、続きを読む操作で全文を表示します。';

const LONG_MARKDOWN = [
  '## 製品の説明',
  '',
  ...Array.from({ length: 12 }, () => [PARAGRAPH, '']).flat(),
  '[末尾のリンク](https://other.example/docs)',
].join('\n');

const FOOTNOTE_MARKDOWN = [
  '冒頭の文に脚注の参照があります[^1]。',
  '',
  ...Array.from({ length: 12 }, () => [PARAGRAPH, '']).flat(),
  '[^1]: 末尾の脚注の本文。',
].join('\n');

const FOOTNOTE_BACK_LABEL = '本文の参照位置へ戻る';

const SHORT_MARKDOWN = '短い自己紹介です。';

const renderSample = (markdown: string): RenderedMarkdown =>
  renderMarkdown(markdown, {
    siteOrigin: SITE_ORIGIN,
    externalLinkRel: ['noopener', 'ugc'],
  });

const DEFAULT_VIEWPORT = { width: 414, height: 896 } as const;

const toggleButton = (name: string) => page.getByRole('button', { name });

const elementOf = (root: ParentNode, selector: string): HTMLElement => {
  const element = root.querySelector<HTMLElement>(selector);
  if (element === null) {
    throw new Error(`${selector}が描画されていません。`);
  }
  return element;
};

const bodyOf = (root: ParentNode): HTMLElement =>
  elementOf(root, '[data-slot="collapsible-markdown-body"]');

const fadeOf = (root: ParentNode): HTMLElement | null =>
  root.querySelector<HTMLElement>('[data-slot="collapsible-markdown-fade"]');

const heightOf = (element: Element): number =>
  element.getBoundingClientRect().height;

// スクロールのイベントは次の描画の時に配られるため、初期化の前に配り終えたことを待ち、初期化の後のイベントで展開する経路と区別する
const scrollEventDispatched = (element: Element): Promise<void> =>
  new Promise((resolve) => {
    element.addEventListener(
      'scroll',
      () => {
        resolve();
      },
      { once: true },
    );
  });

interface ActEnvironment {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
}

const actEnvironment = globalThis as ActEnvironment;

const hydratedRoots: Root[] = [];

// vitest-browser-reactのrenderは自分のactの後にactの環境の指定を戻すため、Reactのactを直接呼ぶたびに指定し直す
async function actInTestEnvironment(
  callback: () => Promise<void>,
): Promise<void> {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(callback);
  } finally {
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
  }
}

interface HydratedMarkup {
  readonly container: HTMLElement;
  readonly serverHtml: string;
  readonly bodyHeightBeforeHydration: number;
  readonly recoverableErrors: readonly unknown[];
}

async function hydrateServerMarkup(ui: ReactElement): Promise<HydratedMarkup> {
  const recoverableErrors: unknown[] = [];
  const serverHtml = renderToString(ui);
  const container = document.body.appendChild(document.createElement('div'));
  container.replaceChildren(
    ...new DOMParser().parseFromString(serverHtml, 'text/html').body.childNodes,
  );
  const bodyHeightBeforeHydration = heightOf(bodyOf(container));
  await actInTestEnvironment(async () => {
    hydratedRoots.push(
      hydrateRoot(container, ui, {
        onRecoverableError: (error) => {
          recoverableErrors.push(error);
        },
      }),
    );
    await Promise.resolve();
  });
  return {
    container,
    serverHtml,
    bodyHeightBeforeHydration,
    recoverableErrors,
  };
}

afterEach(async () => {
  await actInTestEnvironment(async () => {
    for (const root of hydratedRoots.splice(0)) {
      root.unmount();
    }
    await Promise.resolve();
  });
  document.body.replaceChildren();
  history.replaceState(null, '', `${location.pathname}${location.search}`);
  window.scrollTo(0, 0);
  applyColorScheme('light');
  await emulateReducedMotion('no-preference');
  await page.viewport(DEFAULT_VIEWPORT.width, DEFAULT_VIEWPORT.height);
});

describe('CollapsibleMarkdownContent', () => {
  describe('指定の高さを超える本文', () => {
    test('指定の高さで折りたたみ、下端のぼかしと「続きを読む」を表示する', async () => {
      const { container } = await render(
        <CollapsibleMarkdownContent
          rendered={renderSample(LONG_MARKDOWN)}
          collapsedHeight={COLLAPSED_HEIGHT}
        />,
      );

      const button = toggleButton(READ_MORE);
      await expect.element(button).toBeVisible();
      await expect.element(button).toHaveAttribute('aria-expanded', 'false');
      const body = bodyOf(container);
      expect(button.element().getAttribute('aria-controls')).toBe(body.id);
      expect(heightOf(body)).toBe(COLLAPSED_HEIGHT);
      expect(body.scrollHeight).toBeGreaterThan(COLLAPSED_HEIGHT);
      const fade = fadeOf(container);
      expect(fade).not.toBeNull();
      expect(fade?.getAttribute('aria-hidden')).toBe('true');
      expect(getComputedStyle(fade ?? body).pointerEvents).toBe('none');
    });

    test('「続きを読む」を押すと全文を表示し、「折りたたむ」に変わって展開の状態を伝える', async () => {
      const { container } = await render(
        <CollapsibleMarkdownContent
          rendered={renderSample(LONG_MARKDOWN)}
          collapsedHeight={COLLAPSED_HEIGHT}
        />,
      );

      await toggleButton(READ_MORE).click();

      const button = toggleButton(COLLAPSE);
      await expect.element(button).toHaveAttribute('aria-expanded', 'true');
      const body = bodyOf(container);
      expect(heightOf(body)).toBeGreaterThan(COLLAPSED_HEIGHT);
      expect(body.scrollHeight).toBe(body.clientHeight);
      expect(fadeOf(container)).toBeNull();
      await expect
        .element(page.getByRole('link', { name: '末尾のリンク' }))
        .toBeInViewport();
    });

    test('「折りたたむ」を押すと再び指定の高さに折りたたむ', async () => {
      const { container } = await render(
        <CollapsibleMarkdownContent
          rendered={renderSample(LONG_MARKDOWN)}
          collapsedHeight={COLLAPSED_HEIGHT}
        />,
      );

      await toggleButton(READ_MORE).click();
      await toggleButton(COLLAPSE).click();

      await expect
        .element(toggleButton(READ_MORE))
        .toHaveAttribute('aria-expanded', 'false');
      expect(heightOf(bodyOf(container))).toBe(COLLAPSED_HEIGHT);
      expect(fadeOf(container)).not.toBeNull();
    });

    test('Tabキーでボタンへ移動し、Enterキーで展開できる', async () => {
      await render(
        <CollapsibleMarkdownContent
          rendered={renderSample('## 見出し\n\n' + PARAGRAPH.repeat(12))}
          collapsedHeight={COLLAPSED_HEIGHT}
        />,
      );
      const button = toggleButton(READ_MORE);
      await expect.element(button).toBeVisible();

      await userEvent.tab();
      await expect.element(button).toHaveFocus();
      await userEvent.keyboard('{Enter}');

      await expect
        .element(toggleButton(COLLAPSE))
        .toHaveAttribute('aria-expanded', 'true');
    });

    test('折りたたんだ部分のリンクへフォーカスが移ると展開し、リンクを隠さない', async () => {
      const { container } = await render(
        <CollapsibleMarkdownContent
          rendered={renderSample(LONG_MARKDOWN)}
          collapsedHeight={COLLAPSED_HEIGHT}
        />,
      );
      await expect.element(toggleButton(READ_MORE)).toBeVisible();

      await userEvent.tab();

      const link = page.getByRole('link', { name: '末尾のリンク' });
      await expect.element(link).toHaveFocus();
      await expect
        .element(toggleButton(COLLAPSE))
        .toHaveAttribute('aria-expanded', 'true');
      const body = bodyOf(container);
      expect(body.scrollTop).toBe(0);
      expect(body.scrollHeight).toBe(body.clientHeight);
      expect(fadeOf(container)).toBeNull();
    });

    test('折りたたんだ高さの内側にあるリンクへフォーカスが移っても展開しない', async () => {
      await render(
        <CollapsibleMarkdownContent
          rendered={renderSample(
            `[先頭のリンク](https://other.example/top)\n\n${LONG_MARKDOWN}`,
          )}
          collapsedHeight={COLLAPSED_HEIGHT}
        />,
      );
      await expect.element(toggleButton(READ_MORE)).toBeVisible();

      await userEvent.tab();

      await expect
        .element(page.getByRole('link', { name: '先頭のリンク' }))
        .toHaveFocus();
      await expect
        .element(toggleButton(READ_MORE))
        .toHaveAttribute('aria-expanded', 'false');
    });
  });

  describe('ページ内のリンクでの移動', () => {
    test('見える範囲の脚注の参照を押すと展開し、脚注を切り取らずに表示する', async () => {
      const { container } = await render(
        <CollapsibleMarkdownContent
          rendered={renderSample(FOOTNOTE_MARKDOWN)}
          collapsedHeight={COLLAPSED_HEIGHT}
        />,
      );
      await expect.element(toggleButton(READ_MORE)).toBeVisible();

      await page
        .elementLocator(elementOf(container, 'a[data-footnote-ref]'))
        .click();

      await expect
        .element(toggleButton(COLLAPSE))
        .toHaveAttribute('aria-expanded', 'true');
      const body = bodyOf(container);
      expect(body.scrollTop).toBe(0);
      expect(body.scrollHeight).toBe(body.clientHeight);
      await expect
        .element(page.elementLocator(elementOf(container, '.footnotes li')))
        .toBeInViewport();
    });

    test('脚注の戻りリンクで本文の参照の位置へ戻る', async () => {
      const { container } = await render(
        <CollapsibleMarkdownContent
          rendered={renderSample(FOOTNOTE_MARKDOWN)}
          collapsedHeight={COLLAPSED_HEIGHT}
        />,
      );
      await expect.element(toggleButton(READ_MORE)).toBeVisible();
      const reference = page.elementLocator(
        elementOf(container, 'a[data-footnote-ref]'),
      );
      await reference.click();
      await expect.element(toggleButton(COLLAPSE)).toBeVisible();
      await expect.element(reference).not.toBeInViewport();

      await page.getByRole('link', { name: FOOTNOTE_BACK_LABEL }).click();

      await expect.element(reference).toBeInViewport();
      expect(bodyOf(container).scrollTop).toBe(0);
    });

    test('初期化の前にページ内の移動で本文の中がスクロールしていても、初期化の後に展開して移動先を表示する', async () => {
      const ui = (
        <CollapsibleMarkdownContent
          rendered={renderSample(FOOTNOTE_MARKDOWN)}
          collapsedHeight={COLLAPSED_HEIGHT}
        />
      );
      const serverHtml = renderToString(ui);
      const container = document.body.appendChild(
        document.createElement('div'),
      );
      container.replaceChildren(
        ...new DOMParser().parseFromString(serverHtml, 'text/html').body
          .childNodes,
      );
      const footnote = elementOf(container, '.footnotes li');
      const scrolled = scrollEventDispatched(bodyOf(container));
      location.hash = footnote.id;
      await scrolled;
      expect(bodyOf(container).scrollTop).toBeGreaterThan(0);

      await actInTestEnvironment(async () => {
        hydratedRoots.push(hydrateRoot(container, ui));
        await Promise.resolve();
      });

      await expect
        .element(toggleButton(COLLAPSE))
        .toHaveAttribute('aria-expanded', 'true');
      expect(bodyOf(container).scrollTop).toBe(0);
      await expect.element(page.elementLocator(footnote)).toBeInViewport();
    });
  });

  describe('指定の高さに収まる本文', () => {
    test('ボタンとぼかしを表示せず、高さを制限しない', async () => {
      const { container } = await render(
        <CollapsibleMarkdownContent
          rendered={renderSample(SHORT_MARKDOWN)}
          collapsedHeight={COLLAPSED_HEIGHT}
        />,
      );

      const body = bodyOf(container);
      await expect.poll(() => body.style.maxHeight).toBe('');
      expect(page.getByRole('button').elements()).toHaveLength(0);
      expect(fadeOf(container)).toBeNull();
      expect(getComputedStyle(body).overflow).toBe('visible');
      expect(heightOf(body)).toBeLessThan(COLLAPSED_HEIGHT);
    });

    test('本文が長くなって指定の高さを超えると折りたたむ', async () => {
      const { container, rerender } = await render(
        <CollapsibleMarkdownContent
          rendered={renderSample(SHORT_MARKDOWN)}
          collapsedHeight={COLLAPSED_HEIGHT}
        />,
      );
      await expect.poll(() => bodyOf(container).style.maxHeight).toBe('');

      await rerender(
        <CollapsibleMarkdownContent
          rendered={renderSample(LONG_MARKDOWN)}
          collapsedHeight={COLLAPSED_HEIGHT}
        />,
      );

      await expect.element(toggleButton(READ_MORE)).toBeVisible();
      expect(heightOf(bodyOf(container))).toBe(COLLAPSED_HEIGHT);
    });

    test('指定の高さが本文より高くなるとボタンを消す', async () => {
      const { container, rerender } = await render(
        <CollapsibleMarkdownContent
          rendered={renderSample(LONG_MARKDOWN)}
          collapsedHeight={COLLAPSED_HEIGHT}
        />,
      );
      await expect.element(toggleButton(READ_MORE)).toBeVisible();

      await rerender(
        <CollapsibleMarkdownContent
          rendered={renderSample(LONG_MARKDOWN)}
          collapsedHeight={100_000}
        />,
      );

      await expect.poll(() => bodyOf(container).style.maxHeight).toBe('');
      expect(page.getByRole('button').elements()).toHaveLength(0);
    });
  });

  test('ページのサーバー側の描画は初めから折りたたんでボタンを含まず、ブラウザの初期化で食い違わずに測定後にボタンを出す', async () => {
    const ui = (
      <CollapsibleMarkdownContent
        rendered={renderSample(LONG_MARKDOWN)}
        collapsedHeight={COLLAPSED_HEIGHT}
      />
    );

    const {
      container,
      serverHtml,
      bodyHeightBeforeHydration,
      recoverableErrors,
    } = await hydrateServerMarkup(ui);

    expect(serverHtml).not.toContain('<button');
    expect(serverHtml).not.toContain('collapsible-markdown-fade');
    expect(bodyHeightBeforeHydration).toBe(COLLAPSED_HEIGHT);
    expect(recoverableErrors).toStrictEqual([]);
    await expect.element(toggleButton(READ_MORE)).toBeVisible();
    expect(heightOf(bodyOf(container))).toBe(COLLAPSED_HEIGHT);
  });

  test('表示の大きさと呼び出し側のクラスを表示部品へ渡し、ぼかしの色を指定で変える', async () => {
    const { container } = await render(
      <CollapsibleMarkdownContent
        rendered={renderSample(LONG_MARKDOWN)}
        collapsedHeight={COLLAPSED_HEIGHT}
        size="sm"
        className="mt-4"
        fadeClassName="from-card"
      />,
    );
    await expect.element(toggleButton(READ_MORE)).toBeVisible();

    const content = elementOf(container, '[data-slot="markdown-content"]');
    expect(content.classList).toContain('mt-4');
    expect(content.classList).toContain('prose-sm');
    expect(content.classList).not.toContain('sm:prose-base');
    expect(fadeOf(container)?.classList).toContain('from-card');
    expect(fadeOf(container)?.classList).not.toContain('from-background');
  });

  test('ぼかしの色は既定で背景色にする', async () => {
    const { container } = await render(
      <CollapsibleMarkdownContent
        rendered={renderSample(LONG_MARKDOWN)}
        collapsedHeight={COLLAPSED_HEIGHT}
      />,
    );
    await expect.element(toggleButton(READ_MORE)).toBeVisible();

    expect(fadeOf(container)?.classList).toContain('from-background');
  });

  test('視差効果を減らす設定では、ボタンのアイコンの回転を動かさない', async () => {
    await emulateReducedMotion('reduce');
    await render(
      <CollapsibleMarkdownContent
        rendered={renderSample(LONG_MARKDOWN)}
        collapsedHeight={COLLAPSED_HEIGHT}
      />,
    );
    const button = toggleButton(READ_MORE);
    await expect.element(button).toBeVisible();

    const icon = elementOf(button.element(), 'svg');
    expect(getComputedStyle(icon).transitionDuration).toBe('1e-05s');
  });

  describe.each(COLOR_SCHEMES)('配色が%sのとき', (scheme) => {
    test('折りたたんだ状態でアクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await render(
        <CollapsibleMarkdownContent
          rendered={renderSample(LONG_MARKDOWN)}
          collapsedHeight={COLLAPSED_HEIGHT}
        />,
      );
      await expect.element(toggleButton(READ_MORE)).toBeVisible();

      expect(await runAxe(container)).toStrictEqual([]);
    });

    test('展開した状態でアクセシビリティの検査の違反が0件', async () => {
      applyColorScheme(scheme);
      const { container } = await render(
        <CollapsibleMarkdownContent
          rendered={renderSample(LONG_MARKDOWN)}
          collapsedHeight={COLLAPSED_HEIGHT}
        />,
      );
      await toggleButton(READ_MORE).click();
      await expect.element(toggleButton(COLLAPSE)).toBeVisible();

      expect(await runAxe(container)).toStrictEqual([]);
    });
  });
});
