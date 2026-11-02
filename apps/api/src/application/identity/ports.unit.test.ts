import { describe, expect, expectTypeOf, test } from 'bun:test';
import { Container } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import type { DisposableEmailStatus } from '../../../lib/core/identity/disposable-email.ts';
import type { UserLifecycleEvent } from '../../../lib/core/identity/user-lifecycle.ts';
import {
  RECHECK_DISPOSABLE_EMAIL_MESSAGE,
  RUN_USER_LIFECYCLE_MESSAGE,
} from '../../../lib/core/messaging/contracts/identity.ts';
import type { MessageContract } from '../../../lib/core/messaging/message-contract.ts';
import type { SessionTimes } from '../../domain/auth/session-policy.ts';
import type { AuthTokenPurpose } from '../../domain/identity/auth-token-purpose.ts';
import type { UserAccountSnapshot } from '../../domain/identity/user-account.ts';
import type {
  IdentityMessagePublisher,
  IdentityPublishOptions,
  LimitedMailKind,
  MailSendLimits,
  NewAuthToken,
  NewSessionRecord,
  StoredSession,
  UserAccountStore,
  UserLifecycleCommitter,
  UserRecord,
  UserStateTransition,
} from './ports.ts';
import type { RequestMeta } from './request-meta.ts';

const EVENT_ID = '01JC0EVT000000000000000001';

const USER_ID = '01JC0USR000000000000000001';

class RecordingPublisher implements IdentityMessagePublisher {
  readonly sent: {
    readonly type: string;
    readonly body: unknown;
    readonly options?: IdentityPublishOptions;
  }[] = [];

  publish<TType extends string, TBody>(
    contract: MessageContract<TType, TBody>,
    body: TBody,
    options?: IdentityPublishOptions,
  ): Promise<string> {
    this.sent.push(
      options === undefined
        ? { type: contract.type, body }
        : { type: contract.type, body, options },
    );
    return Promise.resolve(`message-${String(this.sent.length)}`);
  }
}

describe('UserRecord', () => {
  test('利用者の規則で判定できる形に、保存する項目と使い捨て判定・版を加えた形である', () => {
    expectTypeOf<UserRecord>().toExtend<UserAccountSnapshot>();
    expectTypeOf<
      UserRecord['disposableEmailStatus']
    >().toEqualTypeOf<DisposableEmailStatus | null>();
    expectTypeOf<UserRecord['lifecycleVersion']>().toEqualTypeOf<number>();
  });
});

describe('NewAuthToken', () => {
  test('用途はトークンの用途の型で、変更先のメールアドレスとパスワードは任意である', () => {
    expectTypeOf<NewAuthToken['purpose']>().toEqualTypeOf<AuthTokenPurpose>();
    expectTypeOf<NewAuthToken['newEmail']>().toEqualTypeOf<
      string | undefined
    >();
    expectTypeOf<NewAuthToken['pendingPasswordHash']>().toEqualTypeOf<
      string | undefined
    >();
  });
});

describe('NewSessionRecord', () => {
  test('セッションの日時の規則の形を含み、保存済みのセッションとして読める', () => {
    expectTypeOf<NewSessionRecord>().toExtend<SessionTimes>();
    expectTypeOf<StoredSession>().toEqualTypeOf<NewSessionRecord>();
  });
});

describe('UserAccountStore', () => {
  test('作成は重複の種類を判別した結果を返す', () => {
    expectTypeOf<
      ReturnType<UserAccountStore['createWithVerification']>
    >().toEqualTypeOf<Promise<'created' | 'email-in-use' | 'handle-in-use'>>();
    expectTypeOf<
      ReturnType<UserAccountStore['applyEmailChange']>
    >().toEqualTypeOf<Promise<'changed' | 'email-in-use'>>();
  });
});

describe('UserLifecycleCommitter', () => {
  test('退会・停止・停止解除の遷移を受け取り、共通ライブラリのイベントを返す', () => {
    expectTypeOf<UserStateTransition['kind']>().toEqualTypeOf<
      'withdraw' | 'suspend' | 'unsuspend'
    >();
    expectTypeOf<ReturnType<UserLifecycleCommitter['commit']>>().toEqualTypeOf<
      Promise<UserLifecycleEvent>
    >();
  });
});

describe('MailSendLimits', () => {
  test('回数を制限するメールはパスワード変更を除くトークンの用途である', () => {
    expectTypeOf<LimitedMailKind>().toEqualTypeOf<
      Exclude<AuthTokenPurpose, 'password_change'>
    >();
    expectTypeOf<Parameters<MailSendLimits['consume']>>().toEqualTypeOf<
      [LimitedMailKind, string, RequestMeta]
    >();
  });
});

describe('RequestMeta', () => {
  test('IPアドレスとUser-Agentは不明なことがあり、現在時刻は必ずある', () => {
    expectTypeOf<RequestMeta>().toEqualTypeOf<{
      readonly clientIp: string | undefined;
      readonly userAgent: string | undefined;
      readonly now: Date;
    }>();
  });
});

describe('IdentityMessagePublisher', () => {
  test('共通の送信部品の識別子から受け取り、共通ライブラリのメッセージの契約で送れる', async () => {
    const publisher = new RecordingPublisher();
    const container = new Container();
    container
      .bind<IdentityMessagePublisher>(PLATFORM_TYPES.MessagePublisher)
      .toConstantValue(publisher);

    const resolved = container.get<IdentityMessagePublisher>(
      PLATFORM_TYPES.MessagePublisher,
    );
    const id = await resolved.publish(RUN_USER_LIFECYCLE_MESSAGE, {
      eventId: EVENT_ID,
    });

    expect(id).toBe('message-1');
    expect(publisher.sent).toEqual([
      { type: 'identity.run-user-lifecycle', body: { eventId: EVENT_ID } },
    ]);
  });

  test('共通の送信部品と同じ形で、遅延秒数を任意で指定して送れる', async () => {
    expectTypeOf<IdentityPublishOptions>().toEqualTypeOf<{
      readonly delaySeconds?: number;
    }>();
    const publisher = new RecordingPublisher();

    await publisher.publish(
      RECHECK_DISPOSABLE_EMAIL_MESSAGE,
      { userId: USER_ID },
      { delaySeconds: 900 },
    );

    expect(publisher.sent).toEqual([
      {
        type: 'identity.recheck-disposable-email',
        body: { userId: USER_ID },
        options: { delaySeconds: 900 },
      },
    ]);
  });
});
