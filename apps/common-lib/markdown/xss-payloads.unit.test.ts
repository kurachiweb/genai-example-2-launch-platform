import { describe, expect, test } from 'bun:test';

import { XSS_CATEGORIES, XSS_PAYLOADS } from './fixtures/xss-payloads.ts';
import type { HastElement, HastRoot } from './hast-types.ts';
import type { MarkdownRenderOptions } from './markdown-options.ts';
import { idPrefixFor } from './markdown-options.ts';
import { processMarkdown } from './markdown-processor.ts';
import { renderMarkdown } from './render-markdown.ts';
import { sanitizeSchemaFor } from './sanitize-schema.ts';

const ID_SCOPE = 'post1';

const ID_PREFIX = idPrefixFor(ID_SCOPE);

const OPTIONS: MarkdownRenderOptions = {
  siteOrigin: 'https://client.example',
  externalLinkRel: ['noopener', 'ugc'],
  sameOriginLinkRel: ['nofollow'],
  idScope: ID_SCOPE,
};

const FORBIDDEN_PROPERTY = /^(?:on|style$|src$|srcSet$)/iu;

const FORBIDDEN_ATTRIBUTE = /^(?:on|style$|src$|srcset$)/iu;

// 表示用のHTMLに現れてよい要素と属性。サニタイズの許可リストに、リンクの方針と表の枠とタスクリストの名前が加える属性と枠のdivを足したもの
const ALLOWED_HTML_ATTRIBUTES: Readonly<
  Record<string, readonly string[] | undefined>
> = {
  a: [
    'href',
    'id',
    'aria-describedby',
    'aria-label',
    'data-footnote-ref',
    'data-footnote-backref',
    'class',
    'target',
    'rel',
  ],
  blockquote: [],
  br: [],
  code: ['class'],
  del: [],
  div: ['class', 'tabindex', 'role', 'aria-label'],
  em: [],
  h2: ['id', 'class'],
  h3: ['id'],
  h4: ['id'],
  h5: ['id'],
  h6: ['id'],
  hr: [],
  input: ['type', 'checked', 'disabled', 'aria-label'],
  li: ['id', 'class'],
  ol: ['start', 'class'],
  p: [],
  pre: [],
  section: ['data-footnotes', 'class'],
  strong: [],
  sup: [],
  table: [],
  tbody: [],
  td: ['align'],
  th: ['align'],
  thead: [],
  tr: [],
  ul: ['class'],
};

// サニタイズの許可リストと表の枠が付けるclassの固定値
const ALLOWED_CLASS_NAMES: Readonly<Record<string, RegExp | undefined>> = {
  a: /^data-footnote-backref$/u,
  code: /^language-\S+$/u,
  div: /^markdown-table-scroll$/u,
  h2: /^sr-only$/u,
  li: /^task-list-item$/u,
  ol: /^contains-task-list$/u,
  section: /^footnotes$/u,
  ul: /^contains-task-list$/u,
};

const findClassViolations = (
  tagName: string,
  classNames: readonly string[],
): readonly string[] =>
  classNames
    .filter(
      (className) => ALLOWED_CLASS_NAMES[tagName]?.test(className) !== true,
    )
    .map((className) => `class${tagName}.${className}`);

const HTTP_URL = /^https?:\/\//iu;

const MAILTO_URL = /^mailto:/iu;

// rehype-stringifyは本文の<を文字参照にするため、出力の<は全てタグの始まりである
const TAG =
  /<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s"'>/=]+(?:="[^"]*")?)*)\s*>/uy;

const ATTRIBUTE = /\s+([^\s"'>/=]+)(?:="([^"]*)")?/gu;

interface HtmlTag {
  readonly closing: boolean;
  readonly name: string;
  readonly attributes: readonly (readonly [string, string])[];
}

const decodeCharacterReferences = (value: string): string =>
  value
    .replace(/&#x([0-9a-f]+);/giu, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#([0-9]+);/gu, (_, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)),
    );

const tagsOf = (html: string): readonly HtmlTag[] => {
  const tags: HtmlTag[] = [];
  for (
    let start = html.indexOf('<');
    start !== -1;
    start = html.indexOf('<', TAG.lastIndex)
  ) {
    TAG.lastIndex = start;
    const match = TAG.exec(html);
    if (match === null) {
      throw new Error(
        `タグとして解釈できない<があります: ${html.slice(start, start + 40)}`,
      );
    }
    const [, closing = '', name = '', attributes = ''] = match;
    tags.push({
      closing: closing === '/',
      name,
      attributes: Array.from(
        attributes.matchAll(ATTRIBUTE),
        ([, attribute = '', value = '']) =>
          [attribute, decodeCharacterReferences(value)] as const,
      ),
    });
  }
  return tags;
};

const isAllowedHref = (href: string): boolean => {
  if (href.startsWith('#')) {
    return href === '#' || href.startsWith(`#${ID_PREFIX}`);
  }
  if (MAILTO_URL.test(href)) {
    return true;
  }
  return HTTP_URL.test(href) && URL.canParse(href);
};

const findHtmlViolations = (html: string): readonly string[] =>
  tagsOf(html).flatMap(({ closing, name, attributes }) => {
    const allowedAttributes = ALLOWED_HTML_ATTRIBUTES[name];
    if (allowedAttributes === undefined) {
      return [`要素<${name}>`];
    }
    if (closing) {
      return [];
    }
    return attributes.flatMap(([attribute, value]) => {
      if (
        FORBIDDEN_ATTRIBUTE.test(attribute) ||
        !allowedAttributes.includes(attribute)
      ) {
        return [`属性${name}.${attribute}`];
      }
      if (attribute === 'href' && !isAllowedHref(value)) {
        return [`参照先${value}`];
      }
      if (attribute === 'id' && !value.startsWith(ID_PREFIX)) {
        return [`ID${value}`];
      }
      if (attribute === 'target' && value !== '_blank') {
        return [`target${value}`];
      }
      if (attribute === 'class') {
        return findClassViolations(name, value.split(/\s+/u));
      }
      return [];
    });
  });

const elementsOf = (tree: HastRoot): readonly HastElement[] => {
  const elements: HastElement[] = [];
  const pending = [...tree.children];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (node.type === 'element') {
      elements.push(node);
      pending.push(...node.children);
    }
  }
  return elements;
};

const schema = sanitizeSchemaFor(ID_PREFIX);

const allowedTagNames: ReadonlySet<string> = new Set(schema.tagNames);

const allowedPropertiesOf = (tagName: string): ReadonlySet<string> =>
  new Set(
    (schema.attributes?.[tagName] ?? []).map((definition) =>
      typeof definition === 'string' ? definition : definition[0],
    ),
  );

const findTreeViolations = (tree: HastRoot): readonly string[] =>
  elementsOf(tree).flatMap((element) => {
    if (!allowedTagNames.has(element.tagName)) {
      return [`要素${element.tagName}`];
    }
    const allowedProperties = allowedPropertiesOf(element.tagName);
    return Object.entries(element.properties).flatMap(([name, value]) => {
      if (FORBIDDEN_PROPERTY.test(name) || !allowedProperties.has(name)) {
        return [`属性${element.tagName}.${name}`];
      }
      if (
        name === 'id' &&
        (typeof value !== 'string' || !value.startsWith(ID_PREFIX))
      ) {
        return [`ID${String(value)}`];
      }
      if (name === 'className') {
        return findClassViolations(
          element.tagName,
          Array.isArray(value) ? value.map(String) : [String(value)],
        );
      }
      return [];
    });
  });

const PAYLOAD_CASES = XSS_PAYLOADS.map(({ category, markdown }) => [
  category,
  JSON.stringify(markdown),
  markdown,
]);

describe('攻撃パターン集', () => {
  test('全ての分類の攻撃パターンを含む', () => {
    expect(
      XSS_CATEGORIES.filter(
        (category) =>
          !XSS_PAYLOADS.some((payload) => payload.category === category),
      ),
    ).toEqual([]);
  });

  test.each(PAYLOAD_CASES)(
    '%s %s のサニタイズ済みの木に許可リスト外の要素・属性とon*・style・srcが無い',
    (_, __, markdown) => {
      expect(findTreeViolations(processMarkdown(markdown, ID_PREFIX))).toEqual(
        [],
      );
    },
  );

  test.each(PAYLOAD_CASES)(
    '%s %s の表示用のHTMLに許可外の要素・属性・参照先が無い',
    (_, __, markdown) => {
      expect(
        findHtmlViolations(renderMarkdown(markdown, OPTIONS).html),
      ).toEqual([]);
    },
  );

  describe('検査の仕組み', () => {
    test.each([
      ['許可外の要素', '<p><img alt="a"></p>', ['要素<img>']],
      ['イベント属性', '<p onclick="a">x</p>', ['属性p.onclick']],
      ['スタイル', '<a href="#" style="a">x</a>', ['属性a.style']],
      ['src', '<div src="a"></div>', ['属性div.src']],
      [
        '文字参照で書いたjavascript:',
        '<a href="&#x6A;avascript:alert(1)">x</a>',
        ['参照先javascript:alert(1)'],
      ],
      ['相対URL', '<a href="/help">x</a>', ['参照先/help']],
      [
        '接頭辞の無いID',
        '<h2 id="main">x</h2><a href="#main">y</a>',
        ['IDmain', '参照先#main'],
      ],
      [
        '許可外のclass',
        '<ul class="contains-task-list evil"><li class="x"></li></ul><code class="language-">a</code>',
        ['classul.evil', 'classli.x', 'classcode.language-'],
      ],
      [
        '別の窓の名前',
        '<a href="https://a.example" target="x">x</a>',
        ['targetx'],
      ],
    ])('%sを違反として検出する', (_, html, violations) => {
      expect(findHtmlViolations(html)).toEqual(violations);
    });

    test('タグとして解釈できない<を検出する', () => {
      expect(() => findHtmlViolations('<p>a <b</p>')).toThrow(
        'タグとして解釈できない<があります',
      );
    });

    test('許可した要素と属性と参照先を違反としない', () => {
      expect(
        findHtmlViolations(
          `<div class="markdown-table-scroll" tabindex="0" role="region" aria-label="表"><table></table></div><p><a href="https://a.example/?a=1&#x26;b=2" target="_blank" rel="noopener">x</a><a href="mailto:a@mail.example">y</a><a href="#${ID_PREFIX}a" id="${ID_PREFIX}b">z</a><a href="#">w</a><br></p>`,
        ),
      ).toEqual([]);
    });

    test('サニタイズ済みの木の許可リスト外の要素・属性・ID・classを検出する', () => {
      const tree: HastRoot = {
        type: 'root',
        children: [
          {
            type: 'element',
            tagName: 'h3',
            properties: { onClick: 'a', id: 'main' },
            children: [
              { type: 'element', tagName: 'img', properties: {}, children: [] },
            ],
          },
          {
            type: 'element',
            tagName: 'code',
            properties: { className: ['language-ts', 'evil'] },
            children: [],
          },
        ],
      };

      expect(findTreeViolations(tree)).toEqual([
        'classcode.evil',
        '属性h3.onClick',
        'IDmain',
        '要素img',
      ]);
    });
  });
});
