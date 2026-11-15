import { describe, expect, test } from 'vitest';

import { renderMarkdown } from '../../common-lib/markdown/render-markdown.ts';

describe('ブラウザテストでの共用部品の兄弟の相対パスでの参照', () => {
  test('開発サーバーが共用部品の配置元を配信し、ブラウザでマークダウンを描画できる', () => {
    const rendered = renderMarkdown('## Overview\n\n**本文**', {
      siteOrigin: 'https://client.example',
      externalLinkRel: ['noopener'],
    });

    expect(rendered.html).toContain('<strong>本文</strong>');
    expect(rendered.headings).toEqual([
      { depth: 2, id: 'user-content-overview', text: 'Overview' },
    ]);
  });
});
