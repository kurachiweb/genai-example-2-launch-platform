import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import {
  decideAfterOutcome,
  decideBeforeSend,
  type DeliveryAction,
} from '../../../lib/core/email/delivery-decision.ts';
import type {
  AnyEmailKind,
  EmailCategory,
  EmailKindRegistry,
} from '../../../lib/core/email/email-kind.ts';
import { EMAIL_TYPES } from '../../../lib/core/email/identifiers.ts';
import type {
  AlertThrottle,
  SenderInfoProvider,
  SendRecordStore,
  SuppressionList,
} from '../../../lib/core/email/ports.ts';
import { UNKNOWN_SEND_ERROR_CODE } from '../../../lib/core/email/provider-outcome.ts';
import type { EmailSendBody } from '../../../lib/core/email/send-message.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import type {
  MessageHandler,
  MessageHandlingResult,
  MessageMeta,
} from '../../../lib/core/messaging/message-contract.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { EVENT_EMAIL_TYPES } from './email-types.ts';
import {
  type EmailIncidentReporter,
  type EmailProvider,
  EmailRenderError,
  type EmailRenderer,
  type EmailRuntimeConfig,
  type RenderedEmail,
} from './ports.ts';

const logger = getAppLogger(['event', 'application', 'email-send']);

const DAILY_LIMIT_ALERT_NAME = 'email-daily-limit';

const DAILY_LIMIT_ALERT_INTERVAL_SECONDS = 3600;

type SendResult =
  | 'sent'
  | 'deferred'
  | 'expired'
  | 'suppressed'
  | 'duplicate'
  | 'retrying'
  | 'undeliverable'
  | 'recipient-suppressed'
  | 'recipient-not-allowed';

type UndeliverableCode = 'unknown-kind' | 'invalid-input' | 'render-failed';

interface HandlingContext {
  readonly requestId: string;
  readonly attempts: number;
  readonly startedAt: Date;
  readonly kindName: string;
  readonly category: EmailCategory | undefined;
}

// 宛先・件名・本文・入力・URLを出さないよう、ログの属性はこの識別子と結果の値だけで組む
interface LogIdentity {
  readonly kind: string;
  readonly kindCategory?: EmailCategory;
  readonly requestId: string;
}

const DONE: MessageHandlingResult = Object.freeze({ kind: 'done' });

const RESULT_MESSAGE = 'メールの送信処理を終えました';

export class EmailTransientFailure extends Error {
  override readonly name = 'EmailTransientFailure';
  readonly code: string;

  constructor(code: string) {
    super(
      `送信プロバイダの一時的な障害でメールを送信できませんでした: ${code}`,
    );
    this.code = code;
  }
}

function identityOf(context: HandlingContext): LogIdentity {
  return {
    kind: context.kindName,
    ...(context.category === undefined
      ? {}
      : { kindCategory: context.category }),
    requestId: context.requestId,
  };
}

function parseDeadline(deadline: string | undefined): Date | undefined {
  return deadline === undefined ? undefined : new Date(deadline);
}

@injectable()
export class SendEmailHandler implements MessageHandler<EmailSendBody> {
  constructor(
    @inject(EMAIL_TYPES.EmailKindRegistry)
    private readonly kinds: EmailKindRegistry,
    @inject(EMAIL_TYPES.SendRecordStore)
    private readonly sendRecords: SendRecordStore,
    @inject(EMAIL_TYPES.SuppressionList)
    private readonly suppressions: SuppressionList,
    @inject(EMAIL_TYPES.SenderInfoProvider)
    private readonly senderInfo: SenderInfoProvider,
    @inject(EMAIL_TYPES.AlertThrottle)
    private readonly alertThrottle: AlertThrottle,
    @inject(EVENT_EMAIL_TYPES.EmailRenderer)
    private readonly renderer: EmailRenderer,
    @inject(EVENT_EMAIL_TYPES.EmailProvider)
    private readonly provider: EmailProvider,
    @inject(EVENT_EMAIL_TYPES.EmailIncidentReporter)
    private readonly incidents: EmailIncidentReporter,
    @inject(EVENT_EMAIL_TYPES.EmailRuntimeConfig)
    private readonly config: EmailRuntimeConfig,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  async handle(
    body: EmailSendBody,
    meta: MessageMeta,
  ): Promise<MessageHandlingResult> {
    const startedAt = this.clock.now();
    const kind = this.kinds.get(body.kind);
    const context: HandlingContext = {
      requestId: meta.id,
      attempts: meta.attempts,
      startedAt,
      kindName: body.kind,
      category: kind?.category,
    };
    if (await this.sendRecords.hasSent(meta.id)) {
      return this.finish(context, 'duplicate');
    }
    const preSend = decideBeforeSend(parseDeadline(body.deadline), startedAt);
    if (preSend.kind === 'skip') {
      return this.finish(context, 'expired');
    }
    if (kind === undefined) {
      return this.giveUp(context, 'unknown-kind');
    }
    const parsed = kind.inputSchema.safeParse(body.input);
    if (!parsed.success) {
      return this.giveUp(context, 'invalid-input');
    }
    if (await this.isSuppressedNotification(kind, body.to)) {
      return this.finish(context, 'suppressed');
    }
    const rendered = await this.render(kind, parsed.data);
    if (rendered === undefined) {
      return this.giveUp(context, 'render-failed');
    }
    const outcome = await this.provider.send({
      from: { address: this.config.fromAddress, name: this.config.fromName },
      to: body.to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      headers: body.headers ?? {},
    });
    return this.act(context, decideAfterOutcome(outcome, meta.attempts));
  }

  // トランザクションメールは抑止中の宛先へも届ける必要があるため、抑止リストを照会しない
  private async isSuppressedNotification(
    kind: AnyEmailKind,
    to: string,
  ): Promise<boolean> {
    if (kind.category !== 'notification') {
      return false;
    }
    const status = await this.suppressions.getStatus(to);
    return status.suppressed;
  }

  // 描画の失敗は再試行しても変わらないため送信不能とし、それ以外の例外は再試行に任せる
  private async render(
    kind: AnyEmailKind,
    input: unknown,
  ): Promise<RenderedEmail | undefined> {
    const senderInfo = await this.senderInfo.get();
    try {
      return await this.renderer.render(kind, input, senderInfo);
    } catch (error) {
      if (error instanceof EmailRenderError) {
        return undefined;
      }
      throw error;
    }
  }

  private async act(
    context: HandlingContext,
    action: DeliveryAction,
  ): Promise<MessageHandlingResult> {
    switch (action.kind) {
      case 'completed':
        await this.recordSent(context);
        return this.finish(context, 'sent', {
          providerMessageId: action.providerMessageId,
        });
      case 'defer':
        if (action.cause === 'daily-limit') {
          await this.alertDailyLimit(context);
        }
        this.logResult(context, 'deferred', {
          deferCause: action.cause,
          delaySeconds: action.delaySeconds,
        });
        return { kind: 'defer', delaySeconds: action.delaySeconds };
      case 'retry':
        this.logResult(context, 'retrying', { code: action.code });
        throw new EmailTransientFailure(action.code);
      case 'give-up':
        if (action.report) {
          this.reportUndeliverable(
            context,
            action.code ?? UNKNOWN_SEND_ERROR_CODE,
          );
        }
        return this.finish(
          context,
          action.result,
          action.code === undefined ? {} : { code: action.code },
        );
    }
  }

  // 送信は済んでいるため、記録の失敗を例外にすると再試行で同じメールを二重に送ってしまう
  private async recordSent(context: HandlingContext): Promise<void> {
    try {
      await this.sendRecords.markSent(
        context.requestId,
        context.kindName,
        this.clock.now(),
      );
    } catch (error) {
      logger.error('送信済みの記録に失敗しました', {
        error,
        ...identityOf(context),
      });
    }
  }

  // 間引きの失敗を例外にすると、試行回数に数えない待機が再試行として数えられてしまう
  // 間引けないときは警告を送る。指紋が1つに固定された警告なので、重ねて送ってもエラートラッキング上の1つの問題にまとまる
  private async alertDailyLimit(context: HandlingContext): Promise<void> {
    let acquired: boolean;
    try {
      acquired = await this.alertThrottle.tryAcquire(
        DAILY_LIMIT_ALERT_NAME,
        this.clock.now(),
        DAILY_LIMIT_ALERT_INTERVAL_SECONDS,
      );
    } catch (error) {
      logger.error('日次上限の警告の間引きに失敗しました', {
        error,
        ...identityOf(context),
      });
      acquired = true;
    }
    if (acquired) {
      this.incidents.report({ kind: 'daily-limit' });
    }
  }

  private giveUp(
    context: HandlingContext,
    code: UndeliverableCode,
  ): MessageHandlingResult {
    this.reportUndeliverable(context, code);
    return this.finish(context, 'undeliverable', { code });
  }

  private reportUndeliverable(context: HandlingContext, code: string): void {
    this.incidents.report({
      kind: 'undeliverable',
      emailKind: context.kindName,
      category: context.category,
      requestId: context.requestId,
      code,
    });
  }

  private finish(
    context: HandlingContext,
    result: SendResult,
    extra: Readonly<Record<string, string>> = {},
  ): MessageHandlingResult {
    this.logResult(context, result, extra);
    return DONE;
  }

  private logResult(
    context: HandlingContext,
    result: SendResult,
    extra: Readonly<Record<string, string | number>>,
  ): void {
    const properties = {
      result,
      ...identityOf(context),
      attempts: context.attempts,
      durationMs: this.clock.now().getTime() - context.startedAt.getTime(),
      ...extra,
    };
    switch (result) {
      case 'undeliverable':
        logger.error(RESULT_MESSAGE, properties);
        return;
      case 'retrying':
        logger.warn(RESULT_MESSAGE, properties);
        return;
      default:
        logger.info(RESULT_MESSAGE, properties);
    }
  }
}
