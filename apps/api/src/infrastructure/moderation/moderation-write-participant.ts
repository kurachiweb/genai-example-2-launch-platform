import type { BatchItem } from 'drizzle-orm/batch';
import type { ServiceIdentifier } from 'inversify';

import type { ModerationAction } from '../../../common-lib/moderation/moderation-actions.ts';
import {
  assertLifecycleHandlerName,
  LifecycleRegistrationError,
} from '../../../lib/core/identity/user-lifecycle.ts';
import type { NewModerationRecord } from '../../../lib/core/moderation/ports.ts';
import type { ModerationWriteParticipation } from '../../application/moderation/ports.ts';

export interface ModerationWriteContext {
  // 措置の記録のIDで、参加者は自分の記録にこの値を同じ一括の書き込みで残せる
  readonly actionId: string;
  readonly action: ModerationAction;
  readonly targetId: string;
  readonly occurredAt: Date;
}

// 措置の状態の変更と記録と同じ一括の書き込みに入る文を返す。読み取りはしてよいが、書き込みは返す文だけで行い、payloadの形が違えばErrorを投げる
export interface ModerationWriteParticipant {
  statementsFor(
    participation: ModerationWriteParticipation,
    context: ModerationWriteContext,
  ): Promise<readonly BatchItem<'sqlite'>[]>;
}

export interface ModerationWriteParticipantRegistration {
  // <spec名>.<名詞句>
  readonly kind: string;
  readonly participant: ServiceIdentifier<ModerationWriteParticipant>;
}

export interface ModerationWriteParticipants {
  statementsFor(
    participation: ModerationWriteParticipation | undefined,
    context: ModerationWriteContext,
  ): Promise<readonly BatchItem<'sqlite'>[]>;
}

const PARTICIPANT_LABEL = '措置の書き込みの参加者';

function identifiersOf(
  registrations: readonly ModerationWriteParticipantRegistration[],
): ReadonlyMap<string, ServiceIdentifier<ModerationWriteParticipant>> {
  const identifiers = new Map<
    string,
    ServiceIdentifier<ModerationWriteParticipant>
  >();
  for (const { kind, participant } of registrations) {
    assertLifecycleHandlerName(kind, PARTICIPANT_LABEL);
    if (identifiers.has(kind)) {
      throw new LifecycleRegistrationError(
        `${PARTICIPANT_LABEL}の種類が重複しています: ${JSON.stringify(kind)}`,
      );
    }
    identifiers.set(kind, participant);
  }
  return identifiers;
}

export function moderationWriteContextOf(
  record: NewModerationRecord,
): ModerationWriteContext {
  return {
    actionId: record.id,
    action: record.action,
    targetId: record.targetId,
    occurredAt: record.occurredAt,
  };
}

// 参加者は処理単位のコンテナから参加の度に解決し、要求をまたいで持ち越さない
export function createModerationWriteParticipants(
  registrations: readonly ModerationWriteParticipantRegistration[],
  resolve: <T>(identifier: ServiceIdentifier<T>) => T,
): ModerationWriteParticipants {
  const identifiers = identifiersOf(registrations);

  return Object.freeze({
    async statementsFor(
      participation: ModerationWriteParticipation | undefined,
      context: ModerationWriteContext,
    ): Promise<readonly BatchItem<'sqlite'>[]> {
      if (participation === undefined) {
        return [];
      }
      const identifier = identifiers.get(participation.kind);
      // 登録の無い種類は束縛か呼び出し側の誤りで、運用者に知らせるためAppErrorにしない
      if (identifier === undefined) {
        throw new Error(
          `${PARTICIPANT_LABEL}に登録の無い種類です: ${JSON.stringify(participation.kind)}`,
        );
      }
      return resolve(identifier).statementsFor(participation, context);
    },
  });
}
