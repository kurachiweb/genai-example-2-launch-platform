import type { StoredSlot } from '../../../lib/core/notifications/ports.ts';
import type {
  ResultNoticeSupplement,
  ResultNoticeSupplementInput,
} from '../../../lib/core/notifications/result-notice-supplements.ts';

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

export interface SupplementSource {
  // 結果の通知のIDから追記への対応表で、追記の無い通知は含めない。提供元の例外はそのまま投げる
  supplementsFor(
    requests: readonly {
      readonly noticeId: string;
      readonly input: ResultNoticeSupplementInput;
    }[],
  ): Promise<ReadonlyMap<string, readonly ResultNoticeSupplement[]>>;
}

export interface GroupDispatchStep {
  readonly emails: number;
  readonly skipped: number;
  // 上限まで処理したため、未送信のまとめが残り得る
  readonly more: boolean;
}

export interface GroupDispatcher {
  // まとめのキーの昇順にlimit件のまとめを確かめ直して送り、通知を確定する。nowは処理の時点の時刻で、マッチの段階と送信の期限の判定に使う
  dispatchNext(
    slotKey: string,
    now: Date,
    limit: number,
  ): Promise<GroupDispatchStep>;
}
