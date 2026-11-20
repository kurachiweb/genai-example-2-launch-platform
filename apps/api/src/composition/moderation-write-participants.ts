import type { ModerationWriteParticipantRegistration } from '../infrastructure/moderation/moderation-write-participant.ts';

// 措置と同じ一括の書き込みで自分の記録を確定させる機能が、'<spec名>.<名詞句>'の種類と参加者の識別子をここへ追記する
export const MODERATION_WRITE_PARTICIPANTS: readonly ModerationWriteParticipantRegistration[] =
  [];
