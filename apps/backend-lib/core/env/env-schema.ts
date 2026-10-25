import type { z } from 'zod';

export class EnvValidationError extends Error {
  override readonly name = 'EnvValidationError';
  readonly missingKeys: readonly string[];
  readonly invalidKeys: readonly string[];

  constructor(missingKeys: readonly string[], invalidKeys: readonly string[]) {
    super(
      `環境の設定に不備があります。欠けたキー: ${formatKeys(missingKeys)}。不正なキー: ${formatKeys(invalidKeys)}。`,
    );
    this.missingKeys = Object.freeze([...missingKeys]);
    this.invalidKeys = Object.freeze([...invalidKeys]);
  }
}

function formatKeys(keys: readonly string[]): string {
  return keys.length === 0 ? 'なし' : keys.join(', ');
}

const validatedEnvsBySchema = new WeakMap<
  z.ZodType,
  WeakMap<object, unknown>
>();

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toSortedUnique(keys: Iterable<string>): string[] {
  return [...new Set(keys)].toSorted();
}

// Zodの問題には入力値が入り得るため、問題からはキー名だけを取り出し、問題そのものは保持しない
function classifyIssueKeys(
  issues: readonly z.core.$ZodIssue[],
  env: unknown,
): EnvValidationError {
  const missingKeys: string[] = [];
  const invalidKeys: string[] = [];
  for (const issue of issues) {
    if (issue.code === 'unrecognized_keys') {
      invalidKeys.push(...issue.keys);
      continue;
    }
    const [key] = issue.path;
    if (typeof key !== 'string' || !isObject(env)) {
      continue;
    }
    (env[key] === undefined ? missingKeys : invalidKeys).push(key);
  }
  return new EnvValidationError(
    toSortedUnique(missingKeys),
    toSortedUnique(invalidKeys),
  );
}

function parseEnv<TSchema extends z.ZodType>(
  schema: TSchema,
  env: unknown,
): z.infer<TSchema> {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw classifyIssueKeys(result.error.issues, env);
  }
  return result.data;
}

export function validateEnv<TSchema extends z.ZodType>(
  schema: TSchema,
  env: unknown,
): z.infer<TSchema> {
  if (!isObject(env)) {
    return parseEnv(schema, env);
  }
  let validatedEnvs = validatedEnvsBySchema.get(schema);
  if (validatedEnvs?.has(env)) {
    return validatedEnvs.get(env) as z.infer<TSchema>;
  }
  const data = parseEnv(schema, env);
  if (validatedEnvs === undefined) {
    validatedEnvs = new WeakMap();
    validatedEnvsBySchema.set(schema, validatedEnvs);
  }
  validatedEnvs.set(env, data);
  return data;
}
