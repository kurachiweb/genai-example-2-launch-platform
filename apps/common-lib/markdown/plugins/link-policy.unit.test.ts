import { describe, expect, test } from 'bun:test';

import type {
  HastElement,
  HastElementContent,
  HastProperties,
  HastRoot,
} from '../hast-types.ts';
import type { MarkdownRenderOptions } from '../markdown-options.ts';
import { applyLinkPolicy } from './link-policy.ts';

const OPTIONS: MarkdownRenderOptions = {
  siteOrigin: 'https://client.example',
  externalLinkRel: ['noopener', 'ugc'],
  sameOriginLinkRel: ['nofollow'],
};

const root = (...children: readonly HastElementContent[]): HastRoot => ({
  type: 'root',
  children,
});

const element = (
  tagName: string,
  properties: HastProperties,
  ...children: readonly HastElementContent[]
): HastElement => ({ type: 'element', tagName, properties, children });

const text = (value: string): HastElementContent => ({ type: 'text', value });

const link = (href: string): HastElement => element('a', { href }, text('x'));

const linkPropertiesOf = (
  href: string,
  options: MarkdownRenderOptions = OPTIONS,
): HastProperties | undefined => {
  const [child] = applyLinkPolicy(root(link(href)), options).children;
  return child?.type === 'element' ? child.properties : undefined;
};

describe('applyLinkPolicy', () => {
  describe('別オリジンのリンク', () => {
    test.each([
      ['別のホスト', 'https://other.example/a'],
      ['同じホストの別のスキーム', 'http://client.example/a'],
      ['同じホストの別のポート', 'https://client.example:8443/a'],
      ['サブドメイン', 'https://www.client.example/a'],
    ])('%sのリンクを別のタブで開き、別オリジンのrelを付ける', (_, href) => {
      expect(linkPropertiesOf(href)).toEqual({
        href,
        target: '_blank',
        rel: ['noopener', 'ugc'],
      });
    });

    test('別オリジンのrelの指定が空ならrelを付けずに別のタブで開く', () => {
      expect(
        linkPropertiesOf('https://other.example', {
          ...OPTIONS,
          externalLinkRel: [],
        }),
      ).toEqual({ href: 'https://other.example', target: '_blank' });
    });
  });

  describe('同一オリジンのリンク', () => {
    test.each([
      ['パス付き', 'https://client.example/help'],
      ['大文字のホストと既定のポート', 'HTTPS://CLIENT.example:443/help'],
    ])('%sのリンクを同じタブで開き、同一オリジンのrelを付ける', (_, href) => {
      expect(linkPropertiesOf(href)).toEqual({ href, rel: ['nofollow'] });
    });

    test.each([
      ['指定が無い', undefined],
      ['指定が空', []],
    ])('同一オリジンのrelの%s場合はrelを付けない', (_, sameOriginLinkRel) => {
      expect(
        linkPropertiesOf('https://client.example/help', {
          siteOrigin: OPTIONS.siteOrigin,
          externalLinkRel: OPTIONS.externalLinkRel,
          ...(sameOriginLinkRel === undefined ? {} : { sameOriginLinkRel }),
        }),
      ).toEqual({ href: 'https://client.example/help' });
    });
  });

  test.each([
    ['ページ内のアンカー', '#user-content-a'],
    ['空のアンカー', '#'],
    ['メールアドレス', 'mailto:user@mail.example'],
  ])('%sのリンクを同じタブで開き、relを付けない', (_, href) => {
    expect(linkPropertiesOf(href)).toEqual({ href });
  });

  describe('許可していない参照先のリンクの解除', () => {
    test.each([
      ['相対URL', '/help'],
      ['パスだけの相対URL', 'help/a'],
      ['クエリだけの相対URL', '?a=1'],
      ['プロトコル相対URL', '//evil.example/a'],
      ['javascript:', 'javascript:alert(1)'],
      ['data:', 'data:text/html,a'],
      ['vbscript:', 'vbscript:msgbox(1)'],
      ['ftp:', 'ftp://files.example/a'],
      ['空の参照', ''],
    ])('%sのリンクを外してリンクの文字列を残す', (_, href) => {
      expect(applyLinkPolicy(root(link(href)), OPTIONS)).toEqual(
        root(text('x')),
      );
    });

    test('参照先の無いリンクを外して子の要素を元の位置に残す', () => {
      const tree = root(
        element(
          'p',
          {},
          text('前'),
          element('a', {}, text('リンク'), element('strong', {}, text('太字'))),
          text('後'),
        ),
      );

      expect(applyLinkPolicy(tree, OPTIONS)).toEqual(
        root(
          element(
            'p',
            {},
            text('前'),
            text('リンク'),
            element('strong', {}, text('太字')),
            text('後'),
          ),
        ),
      );
    });
  });

  test('入れ子の要素の中のリンクにも方針を適用する', () => {
    const tree = root(
      element(
        'blockquote',
        {},
        element('p', {}, element('strong', {}, link('https://other.example'))),
      ),
    );

    expect(applyLinkPolicy(tree, OPTIONS)).toEqual(
      root(
        element(
          'blockquote',
          {},
          element(
            'p',
            {},
            element(
              'strong',
              {},
              element(
                'a',
                {
                  href: 'https://other.example',
                  target: '_blank',
                  rel: ['noopener', 'ugc'],
                },
                text('x'),
              ),
            ),
          ),
        ),
      ),
    );
  });

  test('リンク以外の要素と元の木を変更しない', () => {
    const tree = root(
      element('p', { id: 'user-content-a' }, text('本文')),
      link('https://other.example'),
    );
    const snapshot = structuredClone(tree);

    const result = applyLinkPolicy(tree, OPTIONS);

    expect(tree).toEqual(snapshot);
    expect(result.children[0]).toEqual(tree.children[0]);
  });
});
