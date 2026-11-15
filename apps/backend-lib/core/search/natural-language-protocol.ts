import { z } from 'zod';

import { selectKeywords } from './keyword-selection.ts';
import type { KeywordExtractionOutcome } from './ports.ts';

export const ANALYZE_ENTITIES_ENDPOINT =
  'https://language.googleapis.com/v2/documents:analyzeEntities';

export interface AnalyzeEntitiesRequest {
  readonly document: { readonly type: 'PLAIN_TEXT'; readonly content: string };
  readonly encodingType: 'UTF8';
}

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_SERVER_ERROR_MIN = 500;

const LANGUAGE_MENTION = /\blanguages?\b/iu;

// 応答はproto3のJSONで、既定値の項目(空の配列・空文字列・種類のUNKNOWN・languageSupportedのfalse)が省かれる。languageSupportedのtrueは省かれないため、項目が無ければfalseとする
const analyzeEntitiesResponseSchema = z.object({
  entities: z
    .array(
      z.object({
        name: z.string().default(''),
        type: z.string().default('UNKNOWN'),
      }),
    )
    .default([]),
  languageCode: z.string().optional(),
  languageSupported: z.boolean().default(false),
});

const errorResponseSchema = z.object({
  error: z.object({
    status: z.string(),
    message: z.string(),
  }),
});

export function buildAnalyzeEntitiesRequest(
  text: string,
): AnalyzeEntitiesRequest {
  return {
    document: { type: 'PLAIN_TEXT', content: text },
    encodingType: 'UTF8',
  };
}

const interpretSuccess = (body: unknown): KeywordExtractionOutcome => {
  const parsed = analyzeEntitiesResponseSchema.safeParse(body);
  if (!parsed.success) {
    return { kind: 'configuration-error', status: HTTP_OK };
  }
  const { entities, languageCode, languageSupported } = parsed.data;
  if (!languageSupported) {
    return { kind: 'unsupported-language', languageCode };
  }
  return { kind: 'extracted', keywords: selectKeywords(entities) };
};

// 言語を指定せずに送るため、言語を理由とするINVALID_ARGUMENTは自動判定した言語が非対応であることを表す
const isUnsupportedLanguageError = (body: unknown): boolean => {
  const parsed = errorResponseSchema.safeParse(body);
  return (
    parsed.success &&
    parsed.data.error.status === 'INVALID_ARGUMENT' &&
    LANGUAGE_MENTION.test(parsed.data.error.message)
  );
};

export function interpretAnalyzeEntitiesResponse(
  status: number,
  body: unknown,
): KeywordExtractionOutcome {
  if (status === HTTP_OK) {
    return interpretSuccess(body);
  }
  if (status === HTTP_BAD_REQUEST && isUnsupportedLanguageError(body)) {
    return { kind: 'unsupported-language', languageCode: undefined };
  }
  if (status === HTTP_TOO_MANY_REQUESTS) {
    return { kind: 'temporary-failure', reason: 'rate-limited' };
  }
  if (status >= HTTP_SERVER_ERROR_MIN) {
    return { kind: 'temporary-failure', reason: 'server-error' };
  }
  return { kind: 'configuration-error', status };
}
