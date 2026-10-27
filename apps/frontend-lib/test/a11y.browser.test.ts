import { afterEach, describe, expect, test } from 'vitest';

import { runAxe } from './a11y.ts';

function mount(...children: readonly HTMLElement[]): HTMLElement {
  const container = document.createElement('div');
  container.append(...children);
  document.body.append(container);
  return container;
}

function sizedIconButton(label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.style.cssText =
    'display:inline-block;width:10px;height:10px;padding:0;margin:0;border:0';
  return button;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('runAxe', () => {
  test('代替テキストの無い画像を含む要素では、規則のIDと該当する要素を含む違反を返す', async () => {
    const image = document.createElement('img');
    image.src =
      'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    const container = mount(image);

    const violations = await runAxe(container);

    expect(violations).toHaveLength(1);
    const [violation] = violations;
    expect(violation?.id).toBe('image-alt');
    expect(violation?.impact).toBe('critical');
    expect(violation?.help).not.toBe('');
    expect(violation?.helpUrl).toContain('image-alt');
    expect(violation?.nodes).toStrictEqual([image.outerHTML]);
  });

  test('WCAG 2.2で加わった達成基準(ターゲットのサイズ)の違反も返す', async () => {
    const container = mount(sizedIconButton('前へ'), sizedIconButton('次へ'));

    const violations = await runAxe(container);

    expect(violations.map(({ id }) => id)).toStrictEqual(['target-size']);
  });

  test('違反の無い要素では0件を返す', async () => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '投票する';
    const container = mount(button);

    const violations = await runAxe(container);

    expect(violations).toStrictEqual([]);
  });

  test('WCAG 2.2 AAの対象外(推奨事項・AAA)にだけ違反する要素では0件を返す', async () => {
    const emptyHeading = document.createElement('h2');
    const lowContrastForAaa = document.createElement('p');
    lowContrastForAaa.textContent = 'AAの基準は満たすがAAAの基準は満たさない';
    lowContrastForAaa.style.cssText = 'color:#767676;background:#ffffff';
    const container = mount(emptyHeading, lowContrastForAaa);

    const violations = await runAxe(container);

    expect(violations).toStrictEqual([]);
  });
});
