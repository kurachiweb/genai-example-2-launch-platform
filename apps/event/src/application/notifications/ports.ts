import type { StoredSlot } from '../../../lib/core/notifications/ports.ts';

export type SlotCollectStep =
  | {
      readonly kind: 'progress';
      // 次の段へ持ち越す進み具合(JSON)。持ち越す進み具合が無ければnull。doneがtrueのときは収集を終えたため、値は次の段で使われない
      readonly cursor: string | null;
      readonly done: boolean;
    }
  | {
      // 朝の枠で、開始の日時を過ぎても開始していない当日のマッチが残る
      readonly kind: 'wait';
      readonly delaySeconds: number;
      readonly pendingKickoffs: number;
    };

export interface SlotCollector {
  // 夜・朝の枠ごとの実装。nowは処理の時点の時刻で、マッチの段階はこの時刻から導く
  step(slot: StoredSlot, now: Date): Promise<SlotCollectStep>;
}
