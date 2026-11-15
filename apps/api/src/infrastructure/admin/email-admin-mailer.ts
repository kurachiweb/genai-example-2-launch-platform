import { inject, injectable } from 'inversify';

import { EMAIL_TYPES } from '../../../lib/core/email/identifiers.ts';
import {
  ADMIN_EMAIL_CHANGE_CONFIRMATION_KIND,
  ADMIN_EMAIL_CHANGED_KIND,
  ADMIN_INVITATION_KIND,
  ADMIN_PASSWORD_CHANGED_KIND,
  ADMIN_PASSWORD_RESET_COMPLETED_KIND,
  ADMIN_PASSWORD_RESET_KIND,
} from '../../../lib/core/email/kinds/admin.ts';
import type { EmailSender } from '../../../lib/core/email/ports.ts';
import { ADMIN_TYPES } from '../../application/admin/admin-types.ts';
import type {
  AdminMailer,
  AdminRecord,
  AdminSettings,
} from '../../application/admin/ports.ts';

const INVITATION_PATH = '/auth/invitation';

const EMAIL_CHANGE_CONFIRM_PATH = '/auth/email-change/confirm';

const PASSWORD_RESET_CONFIRM_PATH = '/auth/password-reset/confirm';

// 有効な管理者は招待の完了でニックネームを必ず持つため、無ければ宛名の無いメールを送らずに不整合として止める。
// 呼び出し側が失敗をログに残すため、メッセージに宛先や管理者の値を含めない
function nicknameOf(admin: AdminRecord): string {
  if (admin.nickname === null) {
    throw new Error(
      'ニックネームの無い管理者には宛名を付けたメールを送れません',
    );
  }
  return admin.nickname;
}

@injectable()
export class EmailAdminMailer implements AdminMailer {
  constructor(
    @inject(EMAIL_TYPES.EmailSender) private readonly emails: EmailSender,
    @inject(ADMIN_TYPES.AdminSettings)
    private readonly settings: AdminSettings,
  ) {}

  async sendInvitation(
    to: string,
    token: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.emails.send({
      kind: ADMIN_INVITATION_KIND,
      to,
      input: {
        invitationUrl: this.tokenLink(INVITATION_PATH, token),
        expiresAt: expiresAt.toISOString(),
      },
      deadline: expiresAt,
    });
  }

  async sendEmailChangeConfirmation(
    admin: AdminRecord,
    newEmail: string,
    token: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.emails.send({
      kind: ADMIN_EMAIL_CHANGE_CONFIRMATION_KIND,
      to: newEmail,
      input: {
        nickname: nicknameOf(admin),
        confirmUrl: this.tokenLink(EMAIL_CHANGE_CONFIRM_PATH, token),
        expiresAt: expiresAt.toISOString(),
      },
      deadline: expiresAt,
    });
  }

  async sendEmailChanged(
    previousEmail: string,
    admin: AdminRecord,
    at: Date,
  ): Promise<void> {
    await this.emails.send({
      kind: ADMIN_EMAIL_CHANGED_KIND,
      to: previousEmail,
      input: { nickname: nicknameOf(admin), changedAt: at.toISOString() },
    });
  }

  async sendPasswordReset(
    admin: AdminRecord,
    token: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.emails.send({
      kind: ADMIN_PASSWORD_RESET_KIND,
      to: admin.email,
      input: {
        nickname: nicknameOf(admin),
        resetUrl: this.tokenLink(PASSWORD_RESET_CONFIRM_PATH, token),
        expiresAt: expiresAt.toISOString(),
      },
      deadline: expiresAt,
    });
  }

  async sendPasswordResetCompleted(
    admin: AdminRecord,
    at: Date,
  ): Promise<void> {
    await this.emails.send({
      kind: ADMIN_PASSWORD_RESET_COMPLETED_KIND,
      to: admin.email,
      input: { nickname: nicknameOf(admin), completedAt: at.toISOString() },
    });
  }

  async sendPasswordChanged(admin: AdminRecord, at: Date): Promise<void> {
    await this.emails.send({
      kind: ADMIN_PASSWORD_CHANGED_KIND,
      to: admin.email,
      input: { nickname: nicknameOf(admin), changedAt: at.toISOString() },
    });
  }

  // トークンをフラグメントに置くのは、ブラウザがフラグメントをサーバーへ送らず、管理者側画面のアクセスログに残らないため
  private tokenLink(path: string, token: string): string {
    const url = new URL(path, this.settings.adminOrigin);
    url.hash = `token=${encodeURIComponent(token)}`;
    return url.href;
  }
}
