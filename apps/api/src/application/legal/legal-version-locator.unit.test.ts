import { describe, expect, expectTypeOf, test } from 'bun:test';

import { Container } from 'inversify';

import type { LegalDocumentKind } from '../../../common-lib/legal/legal-documents.ts';
import {
  type LegalVersionLocator,
  StoreLegalVersionLocator,
} from './legal-version-locator.ts';
import { LEGAL_TYPES } from './legal-types.ts';
import type {
  LegalDocumentStore,
  LegalPublishedVersionLocation,
} from './ports.ts';

const PUBLISHER_ADMIN_ID = '01JBX8Y4Z5ABCDEFGHJKMNPQRS';

interface FakeVersion {
  readonly kind: LegalDocumentKind;
  readonly versionNumber: number;
  readonly publishedAt: Date;
}

const VERSIONS: readonly FakeVersion[] = [
  {
    kind: 'terms',
    versionNumber: 1,
    publishedAt: new Date('2026-11-05T01:00:00.000Z'),
  },
  {
    kind: 'terms',
    versionNumber: 2,
    publishedAt: new Date('2026-12-01T03:00:00.000Z'),
  },
  {
    kind: 'privacy',
    versionNumber: 1,
    publishedAt: new Date('2026-11-20T00:00:00.000Z'),
  },
];

function setup() {
  const queries: { kind: LegalDocumentKind; at: Date }[] = [];
  const rejectUnexpected = () =>
    Promise.reject(new Error('日時による版の特定以外は呼ばれない想定です'));
  const store: LegalDocumentStore = {
    findState: rejectUnexpected,
    listSummaries: rejectUnexpected,
    listRevisions: rejectUnexpected,
    findVersion: rejectUnexpected,
    findPublishedAt: (kind, at) => {
      queries.push({ kind, at });
      const found = VERSIONS.filter(
        (version) =>
          version.kind === kind &&
          version.publishedAt.getTime() <= at.getTime(),
      ).at(-1);
      return Promise.resolve(
        found === undefined
          ? undefined
          : {
              versionNumber: found.versionNumber,
              publishedAt: found.publishedAt,
              publishedByAdminId: PUBLISHER_ADMIN_ID,
            },
      );
    },
    saveDraft: rejectUnexpected,
    discardDraft: rejectUnexpected,
    publish: rejectUnexpected,
  };
  const locator = new StoreLegalVersionLocator(store);
  return { locator, store, queries };
}

describe('StoreLegalVersionLocator.findPublishedAt', () => {
  test('日時以前で公開日時が最も新しい版の版番号と公開日時を返す', async () => {
    const { locator, queries } = setup();
    const at = new Date('2026-11-30T23:59:59.999Z');

    const location = await locator.findPublishedAt('terms', at);

    expect(location).toStrictEqual({
      versionNumber: 1,
      publishedAt: new Date('2026-11-05T01:00:00.000Z'),
    });
    expect(queries).toEqual([{ kind: 'terms', at }]);
  });

  test('公開日時と同じミリ秒の日時ではその版を返す', async () => {
    const { locator } = setup();

    const location = await locator.findPublishedAt(
      'terms',
      new Date('2026-12-01T03:00:00.000Z'),
    );

    expect(location?.versionNumber).toBe(2);
  });

  test('種類ごとに版を特定する', async () => {
    const { locator } = setup();

    const location = await locator.findPublishedAt(
      'privacy',
      new Date('2027-01-01T00:00:00.000Z'),
    );

    expect(location).toStrictEqual({
      versionNumber: 1,
      publishedAt: new Date('2026-11-20T00:00:00.000Z'),
    });
  });

  test('日時以前に公開された版が無ければundefinedを返す', async () => {
    const { locator } = setup();

    expect(
      await locator.findPublishedAt(
        'terms',
        new Date('2026-11-05T00:59:59.999Z'),
      ),
    ).toBeUndefined();
    expect(
      await locator.findPublishedAt(
        'legal-notice',
        new Date('2027-01-01T00:00:00.000Z'),
      ),
    ).toBeUndefined();
  });

  test('返す値は版番号と公開日時だけで、管理者のIDを含めない', async () => {
    const { locator } = setup();

    const location = await locator.findPublishedAt(
      'terms',
      new Date('2027-01-01T00:00:00.000Z'),
    );

    expect(JSON.stringify(location)).not.toContain(PUBLISHER_ADMIN_ID);
    expectTypeOf<
      Awaited<ReturnType<LegalVersionLocator['findPublishedAt']>>
    >().toEqualTypeOf<LegalPublishedVersionLocation | undefined>();
    expectTypeOf<keyof LegalPublishedVersionLocation>().toEqualTypeOf<
      'versionNumber' | 'publishedAt'
    >();
  });
});

describe('LegalVersionLocatorの束縛', () => {
  test('ストアを識別子で注入して解決できる', async () => {
    const { store } = setup();
    const container = new Container();
    container
      .bind<LegalDocumentStore>(LEGAL_TYPES.LegalDocumentStore)
      .toConstantValue(store);
    container
      .bind<LegalVersionLocator>(LEGAL_TYPES.LegalVersionLocator)
      .to(StoreLegalVersionLocator);

    const locator = container.get<LegalVersionLocator>(
      LEGAL_TYPES.LegalVersionLocator,
    );

    expect(
      (
        await locator.findPublishedAt(
          'terms',
          new Date('2027-01-01T00:00:00.000Z'),
        )
      )?.versionNumber,
    ).toBe(2);
  });
});
