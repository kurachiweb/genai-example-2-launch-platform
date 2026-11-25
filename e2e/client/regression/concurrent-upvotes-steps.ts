import type { APIRequestContext } from '@playwright/test';

import {
  ClientQualifierBoardDocument,
  ClientUpvoteDocument,
} from '../../../apps/client/src/graphql/generated/graphql.ts';
import { GRAPHQL_RELAY_PATH } from '../../../apps/frontend-lib/server/relay/relay-contract.ts';
import { documentIdOf } from '../../../apps/frontend-lib/utilities/graphql/persisted-document.ts';
import { BULK_BOT_TOKEN } from '../../support/bot-token.ts';

export interface UpvoteObservation {
  readonly status: number;
  readonly durationMs: number;
  readonly errorCodes: readonly string[];
  readonly upvotedEntryId: string | null;
}

export interface UpvoteTally {
  readonly total: number;
  readonly statusCounts: Readonly<Record<string, number>>;
  readonly serverErrorCount: number;
  readonly acceptedCount: number;
  readonly errorCodeCounts: Readonly<Record<string, number>>;
  readonly maxDurationMs: number;
}

export interface LiveMatchEntry {
  readonly id: string;
  readonly productHandle: string | null;
  readonly upvoteCount: number;
}

export interface LiveMatch {
  readonly id: string;
  readonly entries: readonly LiveMatchEntry[];
}

const FIRST_SERVER_ERROR_STATUS = 500;

const NETWORK_ERROR_STATUS = 0;

const UNPARSEABLE_BODY_CODE = 'UNPARSEABLE_BODY';

const UNKNOWN_ERROR_CODE = 'UNKNOWN';

const NETWORK_ERROR_CODE = 'NETWORK_ERROR';

// 100件が同時に走ると、最後の要求の応答までに既定の待ち時間を超え得るため、時間切れで失敗を作らない長さにする
const REQUEST_TIMEOUT_MS = 120_000;

const UPVOTE_DOCUMENT_ID = documentIdOf(ClientUpvoteDocument);

const QUALIFIER_BOARD_DOCUMENT_ID = documentIdOf(ClientQualifierBoardDocument);

const MAX_ERROR_MESSAGE_LENGTH = 160;

const describeError = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error))
    .replaceAll(/\s+/gu, ' ')
    .slice(0, MAX_ERROR_MESSAGE_LENGTH);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const errorCodeOf = (error: unknown): string => {
  if (!isRecord(error) || !isRecord(error.extensions)) {
    return UNKNOWN_ERROR_CODE;
  }
  const { code } = error.extensions;
  return typeof code === 'string' ? code : UNKNOWN_ERROR_CODE;
};

export function parseUpvoteBody(
  text: string,
): Pick<UpvoteObservation, 'errorCodes' | 'upvotedEntryId'> {
  const body = parseJson(text);
  if (!isRecord(body)) {
    return { errorCodes: [UNPARSEABLE_BODY_CODE], upvotedEntryId: null };
  }
  if (Array.isArray(body.errors) && body.errors.length > 0) {
    return { errorCodes: body.errors.map(errorCodeOf), upvotedEntryId: null };
  }
  const upvote = isRecord(body.data) ? body.data.upvote : undefined;
  if (!isRecord(upvote)) {
    return { errorCodes: [UNPARSEABLE_BODY_CODE], upvotedEntryId: null };
  }
  const { viewerUpvotedEntryId } = upvote;
  return {
    errorCodes: [],
    upvotedEntryId:
      typeof viewerUpvotedEntryId === 'string' ? viewerUpvotedEntryId : null,
  };
}

const countBy = (keys: readonly string[]): Readonly<Record<string, number>> => {
  const counts = new Map<string, number>();
  for (const key of keys) {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries(
    [...counts].toSorted(([left], [right]) => left.localeCompare(right)),
  );
};

export function tallyUpvotes(
  observations: readonly UpvoteObservation[],
  targetEntryId: string,
): UpvoteTally {
  return {
    total: observations.length,
    statusCounts: countBy(observations.map(({ status }) => String(status))),
    serverErrorCount: observations.filter(
      ({ status }) => status >= FIRST_SERVER_ERROR_STATUS,
    ).length,
    acceptedCount: observations.filter(
      ({ status, errorCodes, upvotedEntryId }) =>
        status >= 200 &&
        status < 300 &&
        errorCodes.length === 0 &&
        upvotedEntryId === targetEntryId,
    ).length,
    errorCodeCounts: countBy(
      observations.flatMap(({ errorCodes }) => errorCodes),
    ),
    maxDurationMs: Math.max(
      0,
      ...observations.map(({ durationMs }) => durationMs),
    ),
  };
}

const countLines = (counts: Readonly<Record<string, number>>): string[] =>
  Object.entries(counts).map(([key, count]) => `  ${key}: ${String(count)}件`);

export function formatUpvoteReport(
  tally: UpvoteTally,
  result: {
    readonly elapsedMs: number;
    readonly counts: { readonly target: number; readonly other: number };
  },
): string {
  return [
    `要求: ${String(tally.total)}件`,
    `所要時間: ${String(result.elapsedMs)}ms(最初の要求の開始から全ての応答まで)`,
    `最大の応答時間: ${String(tally.maxDurationMs)}ms`,
    '状態コードの内訳:',
    ...countLines(tally.statusCounts),
    `5xx: ${String(tally.serverErrorCount)}件`,
    `対象の側へのUpvoteを受理した応答: ${String(tally.acceptedCount)}件`,
    'GraphQLのエラーのコード:',
    ...countLines(tally.errorCodeCounts),
    `対象の側の数え上げ: ${String(result.counts.target)}`,
    `もう一方の側の数え上げ: ${String(result.counts.other)}`,
  ].join('\n');
}

const graphqlHeaders = {
  accept: 'application/graphql-response+json',
  'cf-turnstile-response': BULK_BOT_TOKEN,
};

async function upvoteOnce(
  context: APIRequestContext,
  matchId: string,
  entryId: string,
): Promise<UpvoteObservation> {
  const startedAt = performance.now();
  try {
    const response = await context.post(GRAPHQL_RELAY_PATH, {
      headers: graphqlHeaders,
      data: {
        documentId: UPVOTE_DOCUMENT_ID,
        variables: { input: { matchId, entryId } },
      },
      timeout: REQUEST_TIMEOUT_MS,
    });
    const text = await response.text();
    return {
      status: response.status(),
      durationMs: Math.round(performance.now() - startedAt),
      ...parseUpvoteBody(text),
    };
  } catch (error) {
    return {
      status: NETWORK_ERROR_STATUS,
      durationMs: Math.round(performance.now() - startedAt),
      errorCodes: [`${NETWORK_ERROR_CODE}: ${describeError(error)}`],
      upvotedEntryId: null,
    };
  }
}

// 全ての要求を同じ時点で送り出し、最初の送信から最後の応答までを測る。失敗した要求も例外にせず観測として返す
export async function upvoteConcurrently(
  contexts: readonly APIRequestContext[],
  target: { readonly matchId: string; readonly entryId: string },
): Promise<{
  readonly observations: readonly UpvoteObservation[];
  readonly elapsedMs: number;
}> {
  const startedAt = performance.now();
  const observations = await Promise.all(
    contexts.map((context) =>
      upvoteOnce(context, target.matchId, target.entryId),
    ),
  );
  return {
    observations,
    elapsedMs: Math.round(performance.now() - startedAt),
  };
}

const entryOf = (entry: unknown): LiveMatchEntry | undefined => {
  if (
    !isRecord(entry) ||
    typeof entry.id !== 'string' ||
    typeof entry.upvoteCount !== 'number'
  ) {
    return undefined;
  }
  const product = isRecord(entry.product) ? entry.product : undefined;
  return {
    id: entry.id,
    productHandle: typeof product?.handle === 'string' ? product.handle : null,
    upvoteCount: entry.upvoteCount,
  };
};

const matchOf = (match: unknown): LiveMatch | undefined => {
  if (!isRecord(match) || typeof match.id !== 'string') {
    return undefined;
  }
  const entries = Array.isArray(match.entries)
    ? match.entries.map(entryOf)
    : [];
  return {
    id: match.id,
    entries: entries.filter((entry) => entry !== undefined),
  };
};

// プロダクトの詳細ページの照会は未掲載の他者のプロダクトを返さないため、マッチ中の予選はトップページと同じ当日の予選の照会から探す
export function parseQualifierBoardBody(
  text: string,
  productHandle: string,
): LiveMatch | undefined {
  const body = parseJson(text);
  const board =
    isRecord(body) && isRecord(body.data)
      ? body.data.qualifierBoard
      : undefined;
  const matches =
    isRecord(board) && Array.isArray(board.matches) ? board.matches : [];
  return matches
    .map(matchOf)
    .find((match) =>
      match?.entries.some((entry) => entry.productHandle === productHandle),
    );
}

export async function readQualifierMatch(
  context: APIRequestContext,
  productHandle: string,
): Promise<LiveMatch> {
  const response = await context.post(GRAPHQL_RELAY_PATH, {
    headers: graphqlHeaders,
    data: { documentId: QUALIFIER_BOARD_DOCUMENT_ID, variables: {} },
  });
  const text = await response.text();
  const match = parseQualifierBoardBody(text, productHandle);
  if (!response.ok() || match === undefined) {
    throw new Error(
      `当日の予選にプロダクト${productHandle}のマッチを取得できません: 状態コード${String(response.status())} ${text.slice(0, 300)}`,
    );
  }
  return match;
}

export function entryOfProduct(
  match: LiveMatch,
  productHandle: string,
): LiveMatchEntry {
  const found = match.entries.find(
    (entry) => entry.productHandle === productHandle,
  );
  if (found === undefined) {
    throw new Error(
      `マッチ${match.id}にプロダクト${productHandle}の側がありません`,
    );
  }
  return found;
}
