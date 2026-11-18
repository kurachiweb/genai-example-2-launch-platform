import { expect, type Page } from '@playwright/test';

import {
  sponsoredAdLinkLabel,
  sponsorshipPlacementLabel,
} from '../../apps/client/src/components/sponsorship/sponsorship-messages.ts';
import { QUALIFIER_SECTION_TITLE } from '../../apps/client/src/components/top/qualifier-section-messages.ts';
import { TOP_PAGE_HEADING_ID } from '../../apps/client/src/components/top/top-page-heading-id.ts';
import { ClientSponsoredPlacementsDocument } from '../../apps/client/src/graphql/generated/graphql.ts';
import { documentIdOf } from '../../apps/frontend-lib/utilities/graphql/persisted-document.ts';
import {
  CONNECTING_IP_HEADER,
  randomDocumentationIpv6,
} from '../support/client-ip.ts';
import {
  REACTION_TIMEOUT_MS,
  RETRY_TIMEOUT_MS,
} from '../support/hydration-retry.ts';
import { recordRelayGraphQLRequests } from '../support/system-status-page.ts';
import type { TestAccount } from './auth/account-steps.ts';
import type { ProductInput } from './product-steps.ts';
import { waitForHydration } from './sponsorship-steps.ts';

// サーバーはbotの名乗り(Playwrightの既定のHeadlessChromeを含む)には全ての区画の描画を待ってから送り始めるため、描画を待たずに送り始める一般のブラウザとして名乗る
export const STREAMING_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const TOP_PAGE_PATH = '/';

const SPONSORED_PLACEMENTS_DOCUMENT_ID = documentIdOf(
  ClientSponsoredPlacementsDocument,
);

export interface StreamedLegendLayout {
  // ページの見出しと予選の区画が、本文(main)の中にこの順で届く
  readonly mainContentInOrder: boolean;
  // 広告の区画の内容が、予選の区画の後に本文の外の隠れた要素で届く
  readonly adAfterMainContentInHiddenElement: boolean;
  // 隠れた要素の後に、その要素と本文の中の空の差し込み先を結ぶスクリプトが届く
  readonly revealScriptAfterAd: boolean;
  // 差し込み先は本文の中の予選の区画より前(上部の行のLegendの位置)にある
  readonly placeholderBeforeQualifiers: boolean;
}

const STREAMED_LEGEND_LAYOUT: StreamedLegendLayout = {
  mainContentInOrder: true,
  adAfterMainContentInHiddenElement: true,
  revealScriptAfterAd: true,
  placeholderBeforeQualifiers: true,
};

const adLinkAttributeOf = (productName: string): string =>
  `aria-label="${sponsoredAdLinkLabel(productName)}"`;

// 応答の本文を届いた順に読み切る。広告の取得の失敗(ローカルのD1のロックの競合)では広告が本文に無いため、呼び出し側が読み直す
async function readTopPageStream(baseURL: string): Promise<string> {
  const response = await fetch(new URL(TOP_PAGE_PATH, baseURL), {
    headers: {
      accept: 'text/html',
      'user-agent': STREAMING_USER_AGENT,
      [CONNECTING_IP_HEADER]: randomDocumentationIpv6(),
    },
  });
  expect(response.status, 'トップページの応答の状態コード').toBe(200);
  const reader = response.body?.getReader();
  if (reader === undefined) {
    throw new Error('トップページの応答に本文がありません');
  }
  const decoder = new TextDecoder();
  let html = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      return html + decoder.decode();
    }
    html += decoder.decode(value, { stream: true });
  }
}

// スクリプトを実行せずに解析した本文で、届いた位置(文書の中の順)と差し込みの形を調べる
const inspectStreamedLegend = (
  page: Page,
  html: string,
  adLabel: string,
): Promise<StreamedLegendLayout> =>
  page.evaluate(
    ({ source, headingId, qualifierTitle, legendLabel, adLinkLabel }) => {
      const doc = new DOMParser().parseFromString(source, 'text/html');
      const precedes = (before: Node | null, after: Node | null): boolean =>
        before !== null &&
        after !== null &&
        (before.compareDocumentPosition(after) &
          Node.DOCUMENT_POSITION_FOLLOWING) !==
          0;
      const main = doc.querySelector('main');
      const heading = doc.getElementById(headingId);
      const qualifiers =
        [...doc.querySelectorAll('section[aria-labelledby]')].find(
          (section) =>
            doc
              .getElementById(section.getAttribute('aria-labelledby') ?? '')
              ?.textContent.trim() === qualifierTitle,
        ) ?? null;
      const legend =
        [...doc.querySelectorAll('a[aria-label]')]
          .find((link) => link.getAttribute('aria-label') === adLinkLabel)
          ?.closest('section[aria-label]') ?? null;
      const container = legend?.parentElement ?? null;
      const containerId = container?.id ?? '';
      const revealScript =
        [...doc.scripts].find(
          (script) =>
            containerId !== '' &&
            precedes(container, script) &&
            script.textContent.includes(`"${containerId}"`),
        ) ?? null;
      const placeholder =
        [...(revealScript?.textContent.matchAll(/"([^"]+)"/gu) ?? [])]
          .map(([, id]) =>
            id === containerId ? null : doc.getElementById(id ?? ''),
          )
          .find((element) => element instanceof HTMLTemplateElement) ?? null;
      const inMain = (node: Node | null): boolean =>
        node !== null && main !== null && main.contains(node);
      return {
        mainContentInOrder:
          inMain(heading) &&
          inMain(qualifiers) &&
          precedes(heading, qualifiers),
        adAfterMainContentInHiddenElement:
          legend !== null &&
          legend.getAttribute('aria-label') === legendLabel &&
          !inMain(legend) &&
          container instanceof HTMLElement &&
          container.hidden &&
          precedes(qualifiers, container),
        revealScriptAfterAd: revealScript !== null,
        placeholderBeforeQualifiers:
          placeholder !== null &&
          inMain(placeholder) &&
          placeholder.content.childNodes.length === 0 &&
          precedes(placeholder, qualifiers),
      };
    },
    {
      source: html,
      headingId: TOP_PAGE_HEADING_ID,
      qualifierTitle: QUALIFIER_SECTION_TITLE,
      legendLabel: sponsorshipPlacementLabel('legend'),
      adLinkLabel: adLabel,
    },
  );

// トップページの応答を流れのまま読み、ページの見出しと予選の区画が広告より前の位置に届き、Legendの広告の内容は区画の取得を待たずに送った部分の後から、
// 隠れた要素とそれを本文の中の差し込み先へ移すスクリプトの形で同じ応答の中に届くことを確かめる。届く時間の差は、区画の取得を決定的に遅らせる手段が無いため確かめない
export async function expectLegendAdStreamedAfterMainContent(
  page: Page,
  baseURL: string,
  product: Pick<ProductInput, 'name'>,
): Promise<void> {
  const adLabel = sponsoredAdLinkLabel(product.name);
  let html = '';
  await expect(async () => {
    html = await readTopPageStream(baseURL);
    expect(
      html,
      `トップページの応答に「${product.name}」の広告がありません`,
    ).toContain(adLinkAttributeOf(product.name));
  }).toPass({ timeout: RETRY_TIMEOUT_MS });
  expect(await inspectStreamedLegend(page, html, adLabel)).toStrictEqual(
    STREAMED_LEGEND_LAYOUT,
  );
}

// サーバー側の描画に広告が含まれたトップページを開き、ハイドレーションの後にLegendの位置に広告が出て、広告の照会を中継の経路へ送らないことを確かめる。
// サーバー側の描画で広告の取得が失敗するとブラウザで取得し直すため、描画に広告が含まれるまで開き直し、最後に開いた後の要求だけを調べる
export async function expectLegendAdHydratedWithoutRefetch(
  page: Page,
  account: TestAccount,
  product: Pick<ProductInput, 'name'>,
): Promise<void> {
  const relayRequests = recordRelayGraphQLRequests(page);
  let openedAt = 0;
  await expect(async () => {
    openedAt = relayRequests().length;
    const response = await page.goto(TOP_PAGE_PATH);
    expect(
      (await response?.text()) ?? '',
      `サーバー側で描画したトップページに「${product.name}」の広告がありません`,
    ).toContain(adLinkAttributeOf(product.name));
  }).toPass({ timeout: RETRY_TIMEOUT_MS });
  await waitForHydration(page, account);
  await expect(
    page
      .getByRole('main')
      .getByRole('region', {
        name: sponsorshipPlacementLabel('legend'),
        exact: true,
      })
      .getByRole('link', {
        name: sponsoredAdLinkLabel(product.name),
        exact: true,
      }),
  ).toBeVisible({ timeout: REACTION_TIMEOUT_MS });
  const placementRequests = relayRequests()
    .slice(openedAt)
    .filter((request) => {
      const body: unknown = request.postDataJSON();
      return (
        typeof body === 'object' &&
        body !== null &&
        Reflect.get(body, 'documentId') === SPONSORED_PLACEMENTS_DOCUMENT_ID
      );
    })
    .map((request) => `${request.method()} ${request.url()}`);
  expect(placementRequests, '広告の照会を中継の経路へ送りました').toStrictEqual(
    [],
  );
}
