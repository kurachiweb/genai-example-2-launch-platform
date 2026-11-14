import { parseArgs } from 'node:util';

export interface CliArgs {
  readonly previousRef: string | undefined;
}

const PREVIOUS_REF_OPTION = 'previous-ref';

const USAGE = '使い方: graphql:allowlist [--previous-ref <コミット>]';

const MISSING_PREVIOUS_REF_MESSAGE = `--${PREVIOUS_REF_OPTION}にコミットを指定してください。${USAGE}`;

function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

function readPreviousRef(argv: readonly string[]): string | undefined {
  try {
    return parseArgs({
      args: [...argv],
      options: { [PREVIOUS_REF_OPTION]: { type: 'string' } },
      strict: true,
      allowPositionals: false,
    }).values[PREVIOUS_REF_OPTION];
  } catch (error) {
    if (hasErrorCode(error, 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE')) {
      throw new Error(MISSING_PREVIOUS_REF_MESSAGE, { cause: error });
    }
    throw new Error(`引数が正しくありません。${USAGE}`, { cause: error });
  }
}

// 値はGitのコミットの指定に使うため、ハイフンで始まる値をオプションとして解釈させない
export function parseCliArgs(argv: readonly string[]): CliArgs {
  const previousRef = readPreviousRef(argv);
  if (previousRef === '' || previousRef?.startsWith('-') === true) {
    throw new Error(MISSING_PREVIOUS_REF_MESSAGE);
  }
  return { previousRef };
}
