import { render } from '@react-email/render';

import {
  type EmailRenderer,
  EmailRenderError,
  type RenderedEmail,
} from '../../../application/email/ports.ts';
import type { AnyEmailKind } from '../../../../lib/core/email/email-kind.ts';
import type { SenderInfo } from '../../../../lib/core/email/ports.ts';
import { EmailLayout } from './email-layout.tsx';
import type { EmailTemplate, EmailTemplateRegistry } from './email-template.ts';

export class ReactEmailRenderer implements EmailRenderer {
  constructor(private readonly registry: EmailTemplateRegistry) {}

  async render(
    kind: AnyEmailKind,
    input: unknown,
    senderInfo: SenderInfo | undefined,
  ): Promise<RenderedEmail> {
    const template = this.registry.get(kind.name);
    if (template === undefined) {
      throw new EmailRenderError(
        `メール種別${JSON.stringify(kind.name)}のテンプレートがありません`,
      );
    }
    // 入力は利用者の値を含み得るため、例外のメッセージには種別の名前だけを載せて元の例外はcauseに残す
    try {
      return await renderTemplate(kind, template, input, senderInfo);
    } catch (error) {
      throw new EmailRenderError(
        `メール種別${JSON.stringify(kind.name)}の描画に失敗しました`,
        { cause: error },
      );
    }
  }
}

async function renderTemplate(
  kind: AnyEmailKind,
  template: EmailTemplate<unknown>,
  input: unknown,
  senderInfo: SenderInfo | undefined,
): Promise<RenderedEmail> {
  const subject = template.subject(input);
  const element = (
    <EmailLayout
      category={kind.category}
      preview={template.preview(input)}
      greeting={template.greeting(input)}
      action={template.action?.(input)}
      unsubscribeUrl={template.unsubscribeUrl?.(input)}
      senderInfo={senderInfo}
    >
      <template.Body input={input} />
    </EmailLayout>
  );
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);
  return { subject, html, text };
}
