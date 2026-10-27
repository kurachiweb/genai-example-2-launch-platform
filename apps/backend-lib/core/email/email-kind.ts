import { z } from 'zod';

export type EmailCategory = 'transactional' | 'notification';

export interface EmailKind<TName extends string, TInput> {
  readonly name: TName;
  readonly category: EmailCategory;
  readonly inputSchema: z.ZodType<TInput>;
}

export type AnyEmailKind = EmailKind<string, unknown>;

export interface EmailKindRegistry {
  get(name: string): AnyEmailKind | undefined;
  names(): readonly string[];
}

export class EmailKindRegistryError extends Error {
  override readonly name = 'EmailKindRegistryError';
}

// <ドメイン>.<名詞句>の形で、それぞれ小文字の英数字をハイフンでつなぐ(例: product.weekly-digest)
const EMAIL_KIND_NAME_PATTERN =
  /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

const EMAIL_CATEGORIES: ReadonlySet<string> = new Set<EmailCategory>([
  'transactional',
  'notification',
]);

export function defineEmailKind<TName extends string, TInput>(
  kind: EmailKind<TName, TInput>,
): EmailKind<TName, TInput> {
  const { name, category, inputSchema } = kind;
  return Object.freeze({ name, category, inputSchema });
}

// 型を経ずに組み立てた登録も実行時に検出するため、分類と検証規則の有無も確かめる
function assertValidKind(kind: AnyEmailKind): void {
  if (!EMAIL_KIND_NAME_PATTERN.test(kind.name)) {
    throw new EmailKindRegistryError(
      `メール種別の名前は<ドメイン>.<名詞句>の形で指定してください: ${JSON.stringify(kind.name)}`,
    );
  }
  if (!EMAIL_CATEGORIES.has(kind.category)) {
    throw new EmailKindRegistryError(
      `メール種別${JSON.stringify(kind.name)}の分類はtransactionalかnotificationで指定してください: ${JSON.stringify(kind.category)}`,
    );
  }
  if (!((kind.inputSchema as unknown) instanceof z.ZodType)) {
    throw new EmailKindRegistryError(
      `メール種別${JSON.stringify(kind.name)}にテンプレート入力の検証規則がありません`,
    );
  }
}

export function createEmailKindRegistry(
  kinds: readonly AnyEmailKind[],
): EmailKindRegistry {
  const kindsByName = new Map<string, AnyEmailKind>();
  for (const kind of kinds) {
    assertValidKind(kind);
    if (kindsByName.has(kind.name)) {
      throw new EmailKindRegistryError(
        `メール種別の名前が重複しています: ${JSON.stringify(kind.name)}`,
      );
    }
    kindsByName.set(kind.name, kind);
  }
  const names = Object.freeze([...kindsByName.keys()]);
  return Object.freeze({
    get: (name: string) => kindsByName.get(name),
    names: () => names,
  });
}
