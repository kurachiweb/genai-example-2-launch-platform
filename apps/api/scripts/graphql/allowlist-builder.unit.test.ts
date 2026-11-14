import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';

import type { GatewayErrorCode } from '../../src/presentation/graphql/error-codes.ts';
import {
  type AllowlistBuildError,
  buildAllowlist,
  describeBuildError,
  type PersistedDocuments,
  type PersistedDocumentsByCaller,
  serializeAllowlist,
} from './allowlist-builder.ts';
import type { DocumentValidator } from './document-validator.ts';

const INVALID_MARKER = 'brokenField';

function documentIdOf(document: string): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(document).digest('hex')}`;
}

function persisted(...documents: readonly string[]): PersistedDocuments {
  return Object.fromEntries(
    documents.map((document) => [documentIdOf(document), document]),
  );
}

function byCaller(
  documents: Partial<PersistedDocumentsByCaller>,
): PersistedDocumentsByCaller {
  return { client: {}, admin: {}, ...documents };
}

const validateByMarker: DocumentValidator = (document) =>
  document.includes(INVALID_MARKER)
    ? (['graphql_validation_failed'] satisfies GatewayErrorCode[])
    : [];

const CLIENT_CURRENT = 'query ClientCurrent { value }';
const CLIENT_PREVIOUS = 'query ClientPrevious { value }';
const ADMIN_CURRENT = 'query AdminCurrent { value }';
const ADMIN_PREVIOUS = 'query AdminPrevious { value }';
const PREVIOUS_BROKEN = `query PreviousBroken { ${INVALID_MARKER} }`;
const CURRENT_BROKEN = `query CurrentBroken { ${INVALID_MARKER} }`;

describe('buildAllowlist', () => {
  test('直前のリリースの指定が無ければ現行の操作だけで呼び出し元ごとの許可リストを作る', async () => {
    const result = await buildAllowlist({
      current: byCaller({
        client: persisted(CLIENT_CURRENT),
        admin: persisted(ADMIN_CURRENT),
      }),
      previous: undefined,
      validate: validateByMarker,
    });

    expect(result).toEqual({
      ok: true,
      allowlist: {
        version: 1,
        operations: {
          client: persisted(CLIENT_CURRENT),
          admin: persisted(ADMIN_CURRENT),
        },
      },
      excluded: [],
    });
  });

  test('現行と直前のリリースの操作の和集合を呼び出し元ごとに作る', async () => {
    const result = await buildAllowlist({
      current: byCaller({
        client: persisted(CLIENT_CURRENT),
        admin: persisted(ADMIN_CURRENT),
      }),
      previous: byCaller({
        client: persisted(CLIENT_CURRENT, CLIENT_PREVIOUS),
        admin: persisted(ADMIN_PREVIOUS),
      }),
      validate: validateByMarker,
    });

    expect(result).toEqual({
      ok: true,
      allowlist: {
        version: 1,
        operations: {
          client: persisted(CLIENT_CURRENT, CLIENT_PREVIOUS),
          admin: persisted(ADMIN_CURRENT, ADMIN_PREVIOUS),
        },
      },
      excluded: [],
    });
  });

  test('直前のリリースだけにある操作が検証に通らなければ除外して一覧に加える', async () => {
    const result = await buildAllowlist({
      current: byCaller({ client: persisted(CLIENT_CURRENT) }),
      previous: byCaller({
        client: persisted(CLIENT_PREVIOUS, PREVIOUS_BROKEN),
        admin: persisted(PREVIOUS_BROKEN),
      }),
      validate: validateByMarker,
    });

    expect(result).toEqual({
      ok: true,
      allowlist: {
        version: 1,
        operations: {
          client: persisted(CLIENT_CURRENT, CLIENT_PREVIOUS),
          admin: {},
        },
      },
      excluded: [
        {
          caller: 'client',
          documentId: documentIdOf(PREVIOUS_BROKEN),
          reasons: ['graphql_validation_failed'],
        },
        {
          caller: 'admin',
          documentId: documentIdOf(PREVIOUS_BROKEN),
          reasons: ['graphql_validation_failed'],
        },
      ],
    });
  });

  test('現行の操作が検証に通らなければ理由を付けて失敗する', async () => {
    const result = await buildAllowlist({
      current: byCaller({ admin: persisted(ADMIN_CURRENT, CURRENT_BROKEN) }),
      previous: undefined,
      validate: validateByMarker,
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        {
          kind: 'current_invalid',
          caller: 'admin',
          documentId: documentIdOf(CURRENT_BROKEN),
          reasons: ['graphql_validation_failed'],
        },
      ],
    });
  });

  test('現行と直前のリリースの両方にある操作は現行の操作として検証し、通らなければ1件の失敗にする', async () => {
    const result = await buildAllowlist({
      current: byCaller({ client: persisted(CURRENT_BROKEN) }),
      previous: byCaller({ client: persisted(CURRENT_BROKEN) }),
      validate: validateByMarker,
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        {
          kind: 'current_invalid',
          caller: 'client',
          documentId: documentIdOf(CURRENT_BROKEN),
          reasons: ['graphql_validation_failed'],
        },
      ],
    });
  });

  test.each([
    ['接頭辞が無い', documentIdOf(CLIENT_CURRENT).slice('sha256:'.length)],
    ['ハッシュの方式が異なる', `md5:${'0'.repeat(64)}`],
    [
      '16進が大文字',
      `sha256:${documentIdOf(CLIENT_CURRENT).slice('sha256:'.length).toUpperCase()}`,
    ],
    ['16進の桁が足りない', `sha256:${'0'.repeat(63)}`],
    ['16進でない文字を含む', `sha256:${'g'.repeat(64)}`],
  ])('識別子の形式が不正(%s)なら失敗する', async (_label, documentId) => {
    const result = await buildAllowlist({
      current: byCaller({ client: { [documentId]: CLIENT_CURRENT } }),
      previous: undefined,
      validate: validateByMarker,
    });

    expect(result).toEqual({
      ok: false,
      errors: [{ kind: 'invalid_id', caller: 'client', documentId }],
    });
  });

  test('識別子が本文のSHA-256と一致しなければ失敗する', async () => {
    const documentId = documentIdOf(CLIENT_PREVIOUS);

    const result = await buildAllowlist({
      current: byCaller({ admin: { [documentId]: CLIENT_CURRENT } }),
      previous: undefined,
      validate: validateByMarker,
    });

    expect(result).toEqual({
      ok: false,
      errors: [{ kind: 'hash_mismatch', caller: 'admin', documentId }],
    });
  });

  test('直前のリリースの一覧の識別子も形式とハッシュを照合する', async () => {
    const invalidId = `sha256:${'z'.repeat(64)}`;
    const mismatchedId = documentIdOf(ADMIN_CURRENT);

    const result = await buildAllowlist({
      current: byCaller({ client: persisted(CLIENT_CURRENT) }),
      previous: byCaller({
        client: { [invalidId]: CLIENT_PREVIOUS },
        admin: { [mismatchedId]: ADMIN_PREVIOUS },
      }),
      validate: validateByMarker,
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        { kind: 'invalid_id', caller: 'client', documentId: invalidId },
        { kind: 'hash_mismatch', caller: 'admin', documentId: mismatchedId },
      ],
    });
  });

  test('現行と直前のリリースで同じ識別子に異なる本文があれば失敗する', async () => {
    const documentId = documentIdOf(CLIENT_CURRENT);

    const result = await buildAllowlist({
      current: byCaller({ client: persisted(CLIENT_CURRENT) }),
      previous: byCaller({ client: { [documentId]: CLIENT_PREVIOUS } }),
      validate: validateByMarker,
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? [] : result.errors).toContainEqual({
      kind: 'conflicting_document',
      caller: 'client',
      documentId,
    });
  });

  test('呼び出し元をまたいだすべての失敗をまとめて返す', async () => {
    const mismatchedId = documentIdOf(ADMIN_PREVIOUS);

    const result = await buildAllowlist({
      current: byCaller({
        client: persisted(CURRENT_BROKEN),
        admin: { [mismatchedId]: ADMIN_CURRENT },
      }),
      previous: undefined,
      validate: validateByMarker,
    });

    expect(result).toEqual({
      ok: false,
      errors: [
        {
          kind: 'current_invalid',
          caller: 'client',
          documentId: documentIdOf(CURRENT_BROKEN),
          reasons: ['graphql_validation_failed'],
        },
        { kind: 'hash_mismatch', caller: 'admin', documentId: mismatchedId },
      ],
    });
  });

  test('組み立てた許可リストの識別子を辞書順に並べる', async () => {
    const documents = [CLIENT_CURRENT, CLIENT_PREVIOUS, ADMIN_CURRENT];
    const sortedIds = documents.map(documentIdOf).toSorted();

    const result = await buildAllowlist({
      current: byCaller({ client: persisted(...documents.toReversed()) }),
      previous: byCaller({ client: persisted(...documents) }),
      validate: validateByMarker,
    });

    expect(
      Object.keys(result.ok ? result.allowlist.operations.client : {}),
    ).toEqual(sortedIds);
  });
});

describe('serializeAllowlist', () => {
  const FIRST_ID = `sha256:${'0'.repeat(64)}`;
  const SECOND_ID = `sha256:${'f'.repeat(64)}`;

  test('版・呼び出し元・識別子の決まった順の2スペースのJSONに末尾の改行を付ける', () => {
    const serialized = serializeAllowlist({
      operations: {
        client: {
          [SECOND_ID]: 'query B { value }',
          [FIRST_ID]: 'query A { value }',
        },
        admin: {},
      },
      version: 1,
    });

    expect(serialized).toBe(
      [
        '{',
        '  "version": 1,',
        '  "operations": {',
        '    "admin": {},',
        '    "client": {',
        `      "${FIRST_ID}": "query A { value }",`,
        `      "${SECOND_ID}": "query B { value }"`,
        '    }',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
  });

  test('入力の項目の順が異なっても同じ文字列になる', () => {
    const operations = {
      [FIRST_ID]: 'query A { value }',
      [SECOND_ID]: 'query B { value }',
    } as const;
    const reversed = Object.fromEntries(
      Object.entries(operations).toReversed(),
    );

    expect(
      serializeAllowlist({
        version: 1,
        operations: { client: operations, admin: operations },
      }),
    ).toBe(
      serializeAllowlist({
        version: 1,
        operations: { admin: reversed, client: reversed },
      }),
    );
  });
});

describe('describeBuildError', () => {
  test.each<[AllowlistBuildError, string]>([
    [
      { kind: 'invalid_id', caller: 'client', documentId: 'abc' },
      '  識別子の形式が正しくありません: client abc',
    ],
    [
      { kind: 'hash_mismatch', caller: 'admin', documentId: 'sha256:abc' },
      '  識別子が本文のSHA-256と一致しません: admin sha256:abc',
    ],
    [
      {
        kind: 'conflicting_document',
        caller: 'client',
        documentId: 'sha256:abc',
      },
      '  現行と直前のリリースで同じ識別子の本文が異なります: client sha256:abc',
    ],
    [
      {
        kind: 'current_invalid',
        caller: 'admin',
        documentId: 'sha256:abc',
        reasons: ['query_aliases_exceeded', 'graphql_validation_failed'],
      },
      '  現行の操作がスキーマまたは上限の検証に通りません(query_aliases_exceeded・graphql_validation_failed): admin sha256:abc',
    ],
  ])('%oを字下げした1行の説明にする', (error, expected) => {
    expect(describeBuildError(error)).toBe(expected);
  });
});
