import {
  assertLifecycleHandlerName,
  LifecycleRegistrationError,
} from '../identity/user-lifecycle.ts';
import { type BusinessDate, parseBusinessDate } from '../time/business-time.ts';

export interface EveningDispatchReadyInput {
  // '<spec名>.<名詞句>'。送り出しの前提の登録口に登録した名前
  readonly participant: string;
  // 23:45のジョブの予定時刻の業務日付(ScheduledJobContext.business.date)
  readonly date: BusinessDate;
  readonly at: Date;
}

export type EveningDispatchReadiness =
  | { readonly kind: 'waiting'; readonly missing: readonly string[] }
  | { readonly kind: 'dispatch-requested' }
  | { readonly kind: 'already-requested' };

export type EveningDispatchErrorReason = 'unknown-participant' | 'invalid-date';

export class EveningDispatchError extends Error {
  override readonly name = 'EveningDispatchError';
  readonly reason: EveningDispatchErrorReason;

  constructor(reason: EveningDispatchErrorReason) {
    super(`夜の枠の送り出しの準備の完了を受け付けられません: ${reason}`);
    this.reason = reason;
  }
}

export interface EveningDispatchGate {
  markReady(
    input: EveningDispatchReadyInput,
  ): Promise<EveningDispatchReadiness>;
}

// 本specの23:45のジョブだけが使い、他の機能には公開しない
export interface EveningSlotOpener {
  open(date: BusinessDate, at: Date): Promise<{ readonly requested: boolean }>;
}

export const EVENING_DISPATCH_PARTICIPANTS_LABEL = '夜の枠の送り出しの前提';

export function assertEveningDispatchParticipants(
  names: readonly string[],
): void {
  const seen = new Set<string>();
  for (const name of names) {
    assertLifecycleHandlerName(name, EVENING_DISPATCH_PARTICIPANTS_LABEL);
    if (seen.has(name)) {
      throw new LifecycleRegistrationError(
        `${EVENING_DISPATCH_PARTICIPANTS_LABEL}の名前が重複しています: ${JSON.stringify(name)}`,
      );
    }
    seen.add(name);
  }
}

function isBusinessDate(value: string): boolean {
  try {
    parseBusinessDate(value);
    return true;
  } catch {
    return false;
  }
}

export function parseEveningDispatchReadyInput(
  input: EveningDispatchReadyInput,
  participants: readonly string[],
): EveningDispatchReadyInput {
  if (!participants.includes(input.participant)) {
    throw new EveningDispatchError('unknown-participant');
  }
  if (!isBusinessDate(input.date) || Number.isNaN(input.at.getTime())) {
    throw new EveningDispatchError('invalid-date');
  }
  return { participant: input.participant, date: input.date, at: input.at };
}
