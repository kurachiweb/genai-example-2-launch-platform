import { inject, injectable } from 'inversify';

import { EMAIL_TYPES } from '../../../lib/core/email/identifiers.ts';
import {
  IDENTITY_EMAIL_CHANGE_CONFIRMATION_KIND,
  IDENTITY_EMAIL_CHANGED_KIND,
  IDENTITY_EMAIL_VERIFICATION_KIND,
  IDENTITY_PASSWORD_CHANGE_CONFIRMATION_KIND,
  IDENTITY_PASSWORD_CHANGED_KIND,
  IDENTITY_PASSWORD_RESET_COMPLETED_KIND,
  IDENTITY_PASSWORD_RESET_KIND,
} from '../../../lib/core/email/kinds/identity.ts';
import type { EmailSender } from '../../../lib/core/email/ports.ts';
import { IDENTITY_TYPES } from '../../application/identity/identity-types.ts';
import type {
  IdentityMailer,
  IdentitySettings,
  UserRecord,
} from '../../application/identity/ports.ts';

const VERIFY_EMAIL_PATH = '/auth/verify-email';

const EMAIL_CHANGE_CONFIRM_PATH = '/auth/email-change/confirm';

const PASSWORD_RESET_CONFIRM_PATH = '/auth/password-reset/confirm';

const PASSWORD_CHANGE_CONFIRM_PATH = '/auth/password-change/confirm';

const CONTACT_PATH = '/contact';

@injectable()
export class EmailIdentityMailer implements IdentityMailer {
  constructor(
    @inject(EMAIL_TYPES.EmailSender) private readonly emails: EmailSender,
    @inject(IDENTITY_TYPES.IdentitySettings)
    private readonly settings: IdentitySettings,
  ) {}

  async sendEmailVerification(
    to: UserRecord,
    token: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.emails.send({
      kind: IDENTITY_EMAIL_VERIFICATION_KIND,
      to: to.email,
      input: {
        nickname: to.nickname,
        verifyUrl: this.tokenLink(VERIFY_EMAIL_PATH, token),
        expiresAt: expiresAt.toISOString(),
      },
      deadline: expiresAt,
    });
  }

  async sendEmailChangeConfirmation(
    user: UserRecord,
    newEmail: string,
    token: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.emails.send({
      kind: IDENTITY_EMAIL_CHANGE_CONFIRMATION_KIND,
      to: newEmail,
      input: {
        nickname: user.nickname,
        confirmUrl: this.tokenLink(EMAIL_CHANGE_CONFIRM_PATH, token),
        expiresAt: expiresAt.toISOString(),
      },
      deadline: expiresAt,
    });
  }

  async sendEmailChanged(
    previousEmail: string,
    user: UserRecord,
    at: Date,
  ): Promise<void> {
    await this.emails.send({
      kind: IDENTITY_EMAIL_CHANGED_KIND,
      to: previousEmail,
      input: {
        nickname: user.nickname,
        changedAt: at.toISOString(),
        contactUrl: this.contactLink(),
      },
    });
  }

  async sendPasswordReset(
    user: UserRecord,
    token: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.emails.send({
      kind: IDENTITY_PASSWORD_RESET_KIND,
      to: user.email,
      input: {
        nickname: user.nickname,
        resetUrl: this.tokenLink(PASSWORD_RESET_CONFIRM_PATH, token),
        expiresAt: expiresAt.toISOString(),
      },
      deadline: expiresAt,
    });
  }

  async sendPasswordResetCompleted(user: UserRecord, at: Date): Promise<void> {
    await this.emails.send({
      kind: IDENTITY_PASSWORD_RESET_COMPLETED_KIND,
      to: user.email,
      input: {
        nickname: user.nickname,
        completedAt: at.toISOString(),
        contactUrl: this.contactLink(),
      },
    });
  }

  async sendPasswordChangeConfirmation(
    user: UserRecord,
    token: string,
    expiresAt: Date,
  ): Promise<void> {
    await this.emails.send({
      kind: IDENTITY_PASSWORD_CHANGE_CONFIRMATION_KIND,
      to: user.email,
      input: {
        nickname: user.nickname,
        confirmUrl: this.tokenLink(PASSWORD_CHANGE_CONFIRM_PATH, token),
        expiresAt: expiresAt.toISOString(),
      },
      deadline: expiresAt,
    });
  }

  async sendPasswordChanged(user: UserRecord, at: Date): Promise<void> {
    await this.emails.send({
      kind: IDENTITY_PASSWORD_CHANGED_KIND,
      to: user.email,
      input: {
        nickname: user.nickname,
        changedAt: at.toISOString(),
        contactUrl: this.contactLink(),
      },
    });
  }

  // トークンをフラグメントに置くのは、ブラウザがフラグメントをサーバーへ送らず、利用者側画面のアクセスログに残らないため
  private tokenLink(path: string, token: string): string {
    const url = new URL(path, this.settings.clientOrigin);
    url.hash = `token=${encodeURIComponent(token)}`;
    return url.href;
  }

  private contactLink(): string {
    return new URL(CONTACT_PATH, this.settings.clientOrigin).href;
  }
}
