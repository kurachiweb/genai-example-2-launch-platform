import { UsageError } from './delivery-command.ts';

export interface ParseOptionsSpec {
  readonly names: readonly string[];
  readonly rest: 'allowed' | 'none';
}

export interface ParsedOptions {
  readonly options: ReadonlyMap<string, string>;
  readonly rest: readonly string[];
}

const REST_SEPARATOR = '--';
const OPTION_PREFIX = '--';

const splitOption = (
  arg: string,
): { readonly name: string; readonly inlineValue: string | undefined } => {
  const body = arg.slice(OPTION_PREFIX.length);
  const equals = body.indexOf('=');
  return equals === -1
    ? { name: body, inlineValue: undefined }
    : { name: body.slice(0, equals), inlineValue: body.slice(equals + 1) };
};

export function parseOptions(
  args: readonly string[],
  { names, rest }: ParseOptionsSpec,
): ParsedOptions {
  const separator = args.indexOf(REST_SEPARATOR);
  const optionArgs = separator === -1 ? args : args.slice(0, separator);
  const restArgs = separator === -1 ? [] : args.slice(separator + 1);
  if (separator !== -1 && rest === 'none') {
    throw new UsageError('`--`の後のコマンドは受け取りません');
  }
  const options = new Map<string, string>();
  for (let index = 0; index < optionArgs.length; index += 1) {
    const arg = optionArgs[index] ?? '';
    if (!arg.startsWith(OPTION_PREFIX)) {
      throw new UsageError(`オプションでない引数は受け取りません: ${arg}`);
    }
    const { name, inlineValue } = splitOption(arg);
    if (!names.includes(name)) {
      throw new UsageError(`未知のオプションです: --${name}`);
    }
    const value = inlineValue ?? optionArgs[index + 1];
    if (
      value === undefined ||
      value === '' ||
      value.startsWith(OPTION_PREFIX)
    ) {
      throw new UsageError(`--${name}に値を指定してください`);
    }
    if (inlineValue === undefined) index += 1;
    if (options.has(name)) throw new UsageError(`--${name}が重複しています`);
    options.set(name, value);
  }
  return { options, rest: restArgs };
}

const isChoice = <T extends string>(
  choices: readonly T[],
  value: string,
): value is T => choices.some((choice) => choice === value);

export function optionalChoice<T extends string>(
  options: ReadonlyMap<string, string>,
  name: string,
  choices: readonly T[],
): T | undefined {
  const value = options.get(name);
  if (value === undefined) return undefined;
  if (!isChoice(choices, value)) {
    throw new UsageError(
      `--${name}は${choices.join('・')}のいずれかにしてください(実際: ${value})`,
    );
  }
  return value;
}

export function requiredChoice<T extends string>(
  options: ReadonlyMap<string, string>,
  name: string,
  choices: readonly T[],
): T {
  const value = optionalChoice(options, name, choices);
  if (value === undefined) {
    throw new UsageError(`--${name}を指定してください(${choices.join('・')})`);
  }
  return value;
}
