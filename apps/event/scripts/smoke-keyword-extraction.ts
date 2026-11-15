import type { KeywordExtractionOutcome } from '../lib/core/search/ports.ts';
import { GoogleNaturalLanguageExtractor } from '../src/infrastructure/search/google-natural-language-extractor.ts';

interface TextSink {
  readonly write: (text: string) => unknown;
}

export interface KeywordExtractionSmokeDependencies {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fetcher: typeof fetch;
  readonly stdout: TextSink;
  readonly stderr: TextSink;
}

export interface SmokeSample {
  readonly label: string;
  readonly languageCode: string;
  readonly text: string;
}

export const SMOKE_SAMPLES: readonly SmokeSample[] = [
  {
    label: '日本語',
    languageCode: 'ja',
    text: '東京スカイツリーは墨田区にある電波塔で、展望台から富士山を望める。',
  },
  {
    label: '英語',
    languageCode: 'en',
    text: 'Cloudflare Workers runs JavaScript close to users around the world.',
  },
];

export const EXIT_KEY_MISSING = 2;

const EXIT_SUCCESS = 0;
const EXIT_FAILURE = 1;

const API_KEY_NAME = 'GOOGLE_NL_API_KEY';

const RUN_COMMAND =
  'infisical --telemetry=false run --env staging -- bun run smoke:keyword-extraction';

const KEY_MISSING_GUIDANCE = [
  `${API_KEY_NAME}が注入されていません。疎通確認は次の手順で実行してください。`,
  `1. InfisicalのWeb画面で、環境\`staging\`のフォルダ\`/\`に${API_KEY_NAME}を登録する(登録済みなら不要。\`dev\`には登録しない)`,
  `2. \`cd /workspace/apps/event\`の後に\`${RUN_COMMAND}\`を実行する`,
  '',
].join('\n');

const UNSUPPORTED_LANGUAGE_HINT =
  '対応言語の短文が非対応言語に分類されました。200の応答に`languageSupported: true`が付いていない可能性があり、その場合は全ての索引の更新が縮退します。\n';

function countKeywords(keywords: string): number {
  return keywords === '' ? 0 : keywords.split(' ').length;
}

function describeOutcome(outcome: KeywordExtractionOutcome): string {
  switch (outcome.kind) {
    case 'extracted':
      return `キーワード${String(countKeywords(outcome.keywords))}件`;
    case 'unsupported-language':
      return `判定された言語 ${outcome.languageCode ?? '不明'}`;
    case 'temporary-failure':
      return `種類 ${outcome.reason}`;
    case 'configuration-error':
      return `状態コード${String(outcome.status)}`;
    case 'disabled':
      return '抽出の無効';
  }
}

function formatLine(
  sample: SmokeSample,
  outcome: KeywordExtractionOutcome,
): string {
  return `${sample.label}(${sample.languageCode}): 結果 ${outcome.kind}、${describeOutcome(outcome)}\n`;
}

export async function runKeywordExtractionSmoke({
  env,
  fetcher,
  stdout,
  stderr,
}: KeywordExtractionSmokeDependencies): Promise<number> {
  const apiKey = env[API_KEY_NAME];
  if (apiKey === undefined || apiKey === '') {
    stderr.write(KEY_MISSING_GUIDANCE);
    return EXIT_KEY_MISSING;
  }

  const extractor = new GoogleNaturalLanguageExtractor(apiKey, fetcher);
  stdout.write('キーワード抽出(Google Cloud Natural Language)の疎通確認\n');
  const outcomes: KeywordExtractionOutcome[] = [];
  for (const sample of SMOKE_SAMPLES) {
    const outcome = await extractor.extract(sample.text);
    outcomes.push(outcome);
    stdout.write(formatLine(sample, outcome));
  }

  if (outcomes.every((outcome) => outcome.kind === 'extracted')) {
    stdout.write('全ての短文でキーワードを抽出できました。\n');
    return EXIT_SUCCESS;
  }
  stderr.write('抽出できなかった短文があります。\n');
  if (outcomes.some((outcome) => outcome.kind === 'unsupported-language')) {
    stderr.write(UNSUPPORTED_LANGUAGE_HINT);
  }
  return EXIT_FAILURE;
}

if (import.meta.main) {
  process.exitCode = await runKeywordExtractionSmoke({
    env: process.env,
    fetcher: fetch,
    stdout: process.stdout,
    stderr: process.stderr,
  });
}
