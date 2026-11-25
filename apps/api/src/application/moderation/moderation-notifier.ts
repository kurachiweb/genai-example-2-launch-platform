import { inject, injectable } from 'inversify';

import { NOTICE_EXCERPT_MAX } from '../../../common-lib/moderation/moderation-actions.ts';
import {
  countGraphemes,
  truncateGraphemes,
} from '../../../common-lib/text/graphemes.ts';
import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { EMAIL_TYPES } from '../../../lib/core/email/identifiers.ts';
import {
  MODERATION_COMMENT_HIDDEN_EMAIL,
  MODERATION_PRODUCT_HIDDEN_EMAIL,
  MODERATION_USER_SUSPENDED_EMAIL,
} from '../../../lib/core/email/kinds/ugc-moderation.ts';
import type { EmailSender } from '../../../lib/core/email/ports.ts';
import { ENGAGEMENT_PLATFORM_TYPES } from '../../../lib/core/engagement/identifiers.ts';
import type { CommentStore } from '../../../lib/core/engagement/ports.ts';
import { IDENTITY_PLATFORM_TYPES } from '../../../lib/core/identity/identifiers.ts';
import type { UserContactDirectory } from '../../../lib/core/identity/ports.ts';
import { MODERATION_PLATFORM_TYPES } from '../../../lib/core/moderation/identifiers.ts';
import type {
  ModerationRecord,
  ModerationRecordStore,
} from '../../../lib/core/moderation/ports.ts';
import { PRODUCT_PLATFORM_TYPES } from '../../../lib/core/product/identifiers.ts';
import type { ProductDirectory } from '../../../lib/core/product/ports.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { normalizeModerationReason } from './moderation-reason.ts';

export type ModerationNoticeDispatch = 'requested' | 'skipped' | 'not-pending';

export interface ModerationNotifier {
  // 依頼待ちの記録だけを送る。送信の依頼と依頼済みへの更新の例外はそのまま投げ、記録は依頼待ちのまま残る
  // 送信の依頼は記録のIDを冪等のキーにするため、依頼済みへの更新だけが失敗した後に送り直しても2通目は送られない
  dispatch(actionId: string): Promise<ModerationNoticeDispatch>;
}

export interface ModerationNotifierEnv {
  readonly CLIENT_SITE_ORIGIN: string;
}

const CONTACT_PATH = '/contact';

const EXCERPT_ELLIPSIS = '…';

type NoticeSending = 'sent' | 'no-recipient';

const excerptOf = (body: string): string =>
  countGraphemes(body) <= NOTICE_EXCERPT_MAX
    ? body
    : `${truncateGraphemes(body, NOTICE_EXCERPT_MAX - 1)}${EXCERPT_ELLIPSIS}`;

@injectable()
export class EmailModerationNotifier implements ModerationNotifier {
  constructor(
    @inject(MODERATION_PLATFORM_TYPES.ModerationRecordStore)
    private readonly records: ModerationRecordStore,
    @inject(IDENTITY_PLATFORM_TYPES.UserContactDirectory)
    private readonly contacts: UserContactDirectory,
    @inject(PRODUCT_PLATFORM_TYPES.ProductDirectory)
    private readonly products: ProductDirectory,
    @inject(ENGAGEMENT_PLATFORM_TYPES.CommentStore)
    private readonly comments: CommentStore,
    @inject(EMAIL_TYPES.EmailSender) private readonly emails: EmailSender,
    @inject(PLATFORM_TYPES.Env) private readonly env: ModerationNotifierEnv,
    @inject(PLATFORM_TYPES.Clock) private readonly clock: Clock,
  ) {}

  async dispatch(actionId: string): Promise<ModerationNoticeDispatch> {
    const record = await this.records.find(actionId);
    if (record?.noticeStatus !== 'pending') {
      return 'not-pending';
    }
    const sending = await this.#send(record);
    if (sending === 'no-recipient') {
      const marked = await this.records.markNotice({
        id: record.id,
        from: 'pending',
        to: 'skipped',
        at: this.clock.now(),
      });
      return marked ? 'skipped' : 'not-pending';
    }
    await this.records.markNotice({
      id: record.id,
      from: 'pending',
      to: 'requested',
      at: this.clock.now(),
    });
    return 'requested';
  }

  async #send(record: ModerationRecord): Promise<NoticeSending> {
    switch (record.action) {
      case 'user.suspend': {
        return this.#sendUserSuspended(record);
      }
      case 'product.hide': {
        return this.#sendProductHidden(record);
      }
      case 'comment.hide': {
        return this.#sendCommentHidden(record);
      }
      default: {
        throw new Error(
          `通知の無い種類の措置が依頼待ちです: ${JSON.stringify(record.action)}`,
        );
      }
    }
  }

  async #sendUserSuspended(record: ModerationRecord): Promise<NoticeSending> {
    const contact = await this.contacts.findContact(record.targetId);
    if (contact === undefined) {
      return 'no-recipient';
    }
    await this.emails.send({
      kind: MODERATION_USER_SUSPENDED_EMAIL,
      to: contact.email,
      idempotencyKey: record.id,
      input: {
        nickname: contact.nickname,
        reason: this.#reasonOf(record),
        suspendedAt: record.occurredAt.toISOString(),
        contactUrl: this.#contactLink(),
      },
    });
    return 'sent';
  }

  async #sendProductHidden(record: ModerationRecord): Promise<NoticeSending> {
    const product = (
      await this.products.findSummaries([record.targetId], 'not-deleted')
    ).get(record.targetId);
    if (product === undefined) {
      return 'no-recipient';
    }
    const contact = await this.contacts.findContact(product.ownerUserId);
    if (contact === undefined) {
      return 'no-recipient';
    }
    await this.emails.send({
      kind: MODERATION_PRODUCT_HIDDEN_EMAIL,
      to: contact.email,
      idempotencyKey: record.id,
      input: {
        nickname: contact.nickname,
        productName: product.name,
        reason: this.#reasonOf(record),
        hiddenAt: record.occurredAt.toISOString(),
        contactUrl: this.#contactLink(),
      },
    });
    return 'sent';
  }

  async #sendCommentHidden(record: ModerationRecord): Promise<NoticeSending> {
    const comment = (await this.comments.findByIds([record.targetId])).get(
      record.targetId,
    );
    if (
      comment === undefined ||
      comment.authorUserId === null ||
      comment.anonymizedAt !== null
    ) {
      return 'no-recipient';
    }
    const [products, contact] = await Promise.all([
      this.products.findSummaries([comment.productId], 'not-deleted'),
      this.contacts.findContact(comment.authorUserId),
    ]);
    const product = products.get(comment.productId);
    if (product === undefined || contact === undefined) {
      return 'no-recipient';
    }
    await this.emails.send({
      kind: MODERATION_COMMENT_HIDDEN_EMAIL,
      to: contact.email,
      idempotencyKey: record.id,
      input: {
        nickname: contact.nickname,
        productName: product.name,
        excerpt: excerptOf(comment.bodyMarkdown),
        reason: this.#reasonOf(record),
        hiddenAt: record.occurredAt.toISOString(),
        contactUrl: this.#contactLink(),
      },
    });
    return 'sent';
  }

  #reasonOf(record: ModerationRecord): string {
    const reason = normalizeModerationReason(
      record.action,
      record.reason ?? undefined,
    );
    if (reason === null) {
      throw new Error(
        `理由の無い措置の記録は通知できません: ${JSON.stringify(record.action)}`,
      );
    }
    return reason;
  }

  #contactLink(): string {
    return new URL(CONTACT_PATH, this.env.CLIENT_SITE_ORIGIN).href;
  }
}
