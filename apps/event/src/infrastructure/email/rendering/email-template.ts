import type { ReactNode } from 'react';

import type {
  AnyEmailKind,
  EmailKind,
} from '../../../../lib/core/email/email-kind.ts';

export interface EmailAction {
  readonly label: string;
  readonly url: string;
}

export interface EmailUnsubscribeLink {
  readonly url: string;
  // 省略できるのはリンクが1つのときだけで、そのときは共通の文言で表示する
  readonly label?: string;
}

// 複数のリンクを並べるときは、どの通知の配信停止かを見分けられるようすべてにラベルを付ける
export type EmailUnsubscribeLinkList =
  readonly [EmailUnsubscribeLink] | readonly Required<EmailUnsubscribeLink>[];

// 種別ごとの入力の型を持つテンプレートをEmailTemplate<unknown>の集約点へ並べられるよう、
// 入力を受け取る部品はすべて引数が双変になるメソッドの記法で宣言する
export interface EmailTemplate<TInput> {
  readonly kind: EmailKind<string, TInput>;
  // 件名には接頭辞を付けず、ここで返した文字列をそのまま使う
  subject(input: TInput): string;
  preview(input: TInput): string;
  // 宛名のニックネーム。undefinedなら宛名の行を省略する
  greeting(input: TInput): string | undefined;
  action?(input: TInput): EmailAction | undefined;
  // 通知メールの種別でだけ配信停止の区画に使い、空なら区画を置かない
  unsubscribeLinks?(input: TInput): EmailUnsubscribeLinkList;
  Body(props: { readonly input: TInput }): ReactNode;
}

export interface EmailTemplateRegistry {
  get(kindName: string): EmailTemplate<unknown> | undefined;
}

export class EmailTemplateRegistryError extends Error {
  override readonly name = 'EmailTemplateRegistryError';
}

export function defineEmailTemplate<TInput>(
  template: EmailTemplate<TInput>,
): EmailTemplate<TInput> {
  return Object.freeze({ ...template });
}

function indexTemplatesByKindName(
  templates: readonly EmailTemplate<unknown>[],
  kindsByName: ReadonlyMap<string, AnyEmailKind>,
): Map<string, EmailTemplate<unknown>> {
  const templatesByKindName = new Map<string, EmailTemplate<unknown>>();
  for (const template of templates) {
    const { name } = template.kind;
    const kind = kindsByName.get(name);
    if (kind === undefined) {
      throw new EmailTemplateRegistryError(
        `テンプレートの種別${JSON.stringify(name)}が種別の集約点にありません`,
      );
    }
    // 名前だけ一致する別の定義を指すと、分類や入力の検証規則が送信の判定とずれる
    if (template.kind !== kind) {
      throw new EmailTemplateRegistryError(
        `テンプレートの種別${JSON.stringify(name)}が種別の集約点の定義と異なります`,
      );
    }
    if (templatesByKindName.has(name)) {
      throw new EmailTemplateRegistryError(
        `メール種別${JSON.stringify(name)}のテンプレートが重複しています`,
      );
    }
    templatesByKindName.set(name, template);
  }
  return templatesByKindName;
}

export function createEmailTemplateRegistry(
  templates: readonly EmailTemplate<unknown>[],
  kinds: readonly AnyEmailKind[],
): EmailTemplateRegistry {
  const kindsByName = new Map(kinds.map((kind) => [kind.name, kind]));
  const templatesByKindName = indexTemplatesByKindName(templates, kindsByName);
  for (const name of kindsByName.keys()) {
    if (!templatesByKindName.has(name)) {
      throw new EmailTemplateRegistryError(
        `メール種別${JSON.stringify(name)}のテンプレートがありません`,
      );
    }
  }
  return Object.freeze({
    get: (kindName: string) => templatesByKindName.get(kindName),
  });
}
