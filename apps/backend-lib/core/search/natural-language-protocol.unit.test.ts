import { describe, expect, test } from 'bun:test';

import {
  ANALYZE_ENTITIES_ENDPOINT,
  buildAnalyzeEntitiesRequest,
  interpretAnalyzeEntitiesResponse,
} from './natural-language-protocol.ts';

const errorBody = (code: number, status: string, message: string) => ({
  error: { code, message, status },
});

const UNSUPPORTED_LANGUAGE_BODY = errorBody(
  400,
  'INVALID_ARGUMENT',
  'The language sq is not supported for entity analysis.',
);

describe('ANALYZE_ENTITIES_ENDPOINT', () => {
  test('グローバルのエンドポイントのv2のanalyzeEntitiesを指す', () => {
    expect(ANALYZE_ENTITIES_ENDPOINT).toBe(
      'https://language.googleapis.com/v2/documents:analyzeEntities',
    );
  });
});

describe('buildAnalyzeEntitiesRequest', () => {
  test('言語を指定せず、プレーンテキストの文書とUTF-8の位置の指定だけを本文にする', () => {
    expect(buildAnalyzeEntitiesRequest('ローンチの説明')).toEqual({
      document: { type: 'PLAIN_TEXT', content: 'ローンチの説明' },
      encodingType: 'UTF8',
    });
  });
});

describe('interpretAnalyzeEntitiesResponse', () => {
  test('200で対応言語の応答なら、選別したキーワードで抽出済みにする', () => {
    const outcome = interpretAnalyzeEntitiesResponse(200, {
      entities: [
        {
          name: 'Launch Stadium',
          type: 'ORGANIZATION',
          metadata: { mid: '/m/0example' },
          mentions: [{ text: { content: 'Launch Stadium' }, probability: 1 }],
        },
        { name: '090-0000-0000', type: 'PHONE_NUMBER' },
        { name: 'ｶﾞｲﾄﾞ', type: 'WORK_OF_ART' },
        { name: 'launch stadium', type: 'OTHER' },
      ],
      languageCode: 'ja',
      languageSupported: true,
    });

    expect(outcome).toEqual({
      kind: 'extracted',
      keywords: 'Launch Stadium ガイド',
    });
  });

  test('200で言語の対応を示す項目が無ければ、既定値のfalseが省かれたものとして判定された言語で非対応言語にする', () => {
    const outcome = interpretAnalyzeEntitiesResponse(200, {
      entities: [{ name: 'Tungjatjeta', type: 'OTHER' }],
      languageCode: 'sq',
    });

    expect(outcome).toEqual({
      kind: 'unsupported-language',
      languageCode: 'sq',
    });
  });

  test('200でエンティティだけがあり言語の対応を示す項目が無ければ、言語を不明として非対応言語にする', () => {
    const outcome = interpretAnalyzeEntitiesResponse(200, {
      entities: [{ name: '製品', type: 'CONSUMER_GOOD' }],
    });

    expect(outcome).toEqual({
      kind: 'unsupported-language',
      languageCode: undefined,
    });
  });

  test('200で全ての項目が省かれた応答なら、言語を不明として非対応言語にする', () => {
    expect(interpretAnalyzeEntitiesResponse(200, {})).toEqual({
      kind: 'unsupported-language',
      languageCode: undefined,
    });
  });

  test('200でエンティティの項目が無ければ空のキーワードで抽出済みにする', () => {
    expect(
      interpretAnalyzeEntitiesResponse(200, {
        languageCode: 'en',
        languageSupported: true,
      }),
    ).toEqual({ kind: 'extracted', keywords: '' });
  });

  test('200で既定値のため省かれた種類と名前を、不明の種類と空の名前として扱う', () => {
    const outcome = interpretAnalyzeEntitiesResponse(200, {
      entities: [{ name: '名前だけ' }, { type: 'OTHER' }],
      languageCode: 'ja',
      languageSupported: true,
    });

    expect(outcome).toEqual({ kind: 'extracted', keywords: '名前だけ' });
  });

  test('200でlanguageSupportedがfalseなら、判定された言語で非対応言語にする', () => {
    const outcome = interpretAnalyzeEntitiesResponse(200, {
      entities: [{ name: 'Tungjatjeta', type: 'OTHER' }],
      languageCode: 'sq',
      languageSupported: false,
    });

    expect(outcome).toEqual({
      kind: 'unsupported-language',
      languageCode: 'sq',
    });
  });

  test('200でlanguageSupportedがfalseかつ言語が無ければ、言語を不明として非対応言語にする', () => {
    expect(
      interpretAnalyzeEntitiesResponse(200, { languageSupported: false }),
    ).toEqual({ kind: 'unsupported-language', languageCode: undefined });
  });

  test.each([
    ['本文が無い', undefined],
    ['本文がnull', null],
    ['本文が文字列', 'OK'],
    ['本文が配列', []],
    ['エンティティが配列でない', { entities: {} }],
    ['エンティティがオブジェクトでない', { entities: ['製品'] }],
    ['名前が文字列でない', { entities: [{ name: 1, type: 'OTHER' }] }],
    ['種類が文字列でない', { entities: [{ name: '製品', type: 7 }] }],
    ['言語が文字列でない', { languageCode: 1, languageSupported: true }],
    ['言語の対応が真偽値でない', { languageSupported: 'false' }],
  ])(
    '200で応答の形が合わない(%s)なら、状態200の設定の誤りにする',
    (_, body) => {
      expect(interpretAnalyzeEntitiesResponse(200, body)).toEqual({
        kind: 'configuration-error',
        status: 200,
      });
    },
  );

  test.each([
    ['The language sq is not supported for entity analysis.'],
    ['Unsupported LANGUAGE: xx'],
    ['Languages other than the supported ones are rejected.'],
  ])(
    '言語に触れたINVALID_ARGUMENTの400(%s)なら、言語を不明として非対応言語にする',
    (message) => {
      expect(
        interpretAnalyzeEntitiesResponse(
          400,
          errorBody(400, 'INVALID_ARGUMENT', message),
        ),
      ).toEqual({ kind: 'unsupported-language', languageCode: undefined });
    },
  );

  test.each([
    [
      '言語に触れないINVALID_ARGUMENT',
      errorBody(
        400,
        'INVALID_ARGUMENT',
        'Request contains an invalid argument.',
      ),
    ],
    [
      '言語に触れたINVALID_ARGUMENT以外',
      errorBody(
        400,
        'FAILED_PRECONDITION',
        'The language model is unavailable.',
      ),
    ],
    [
      '語の一部に言語の綴りを含むだけ',
      errorBody(400, 'INVALID_ARGUMENT', 'Unlanguaged input.'),
    ],
    ['エラーの形が無い', { message: 'The language is not supported.' }],
    ['本文が無い', undefined],
    ['本文が文字列', 'Bad Request'],
  ])('それ以外の400(%s)なら、状態400の設定の誤りにする', (_, body) => {
    expect(interpretAnalyzeEntitiesResponse(400, body)).toEqual({
      kind: 'configuration-error',
      status: 400,
    });
  });

  test.each([
    [401, 'UNAUTHENTICATED'],
    [403, 'PERMISSION_DENIED'],
    [404, 'NOT_FOUND'],
  ])('%iなら、その状態コードの設定の誤りにする', (status, errorStatus) => {
    expect(
      interpretAnalyzeEntitiesResponse(
        status,
        errorBody(status, errorStatus, 'The language sq is not supported.'),
      ),
    ).toEqual({ kind: 'configuration-error', status });
  });

  test('429なら、上限超過の一時的な失敗にする', () => {
    expect(
      interpretAnalyzeEntitiesResponse(
        429,
        errorBody(429, 'RESOURCE_EXHAUSTED', 'Quota exceeded.'),
      ),
    ).toEqual({ kind: 'temporary-failure', reason: 'rate-limited' });
  });

  test.each([500, 502, 503, 504, 599])(
    '%iなら、サーバー側の失敗の一時的な失敗にする',
    (status) => {
      expect(
        interpretAnalyzeEntitiesResponse(status, 'Service Unavailable'),
      ).toEqual({ kind: 'temporary-failure', reason: 'server-error' });
    },
  );

  test.each([201, 204, 301, 304, 405, 408, 409, 413, 499])(
    '表に無い%iなら、その状態コードの設定の誤りにする',
    (status) => {
      expect(
        interpretAnalyzeEntitiesResponse(status, UNSUPPORTED_LANGUAGE_BODY),
      ).toEqual({ kind: 'configuration-error', status });
    },
  );
});
