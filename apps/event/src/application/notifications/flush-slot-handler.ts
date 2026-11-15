import { inject, injectable } from 'inversify';

import { PLATFORM_TYPES } from '../../../lib/core/di/identifiers.ts';
import { getAppLogger } from '../../../lib/core/logging/app-logger.ts';
import {
  type FlushNotificationSlotBody,
  NOTIFICATION_CONTINUE_DELAY_SECONDS,
} from '../../../lib/core/messaging/contracts/notifications.ts';
import type {
  MessageHandler,
  MessageHandlingResult,
  MessageMeta,
} from '../../../lib/core/messaging/message-contract.ts';
import { NOTIFICATIONS_PLATFORM_TYPES } from '../../../lib/core/notifications/identifiers.ts';
import type {
  NotificationIncident,
  NotificationIncidentReporter,
  NotificationSlotStore,
  SlotPhase,
  StoredSlot,
} from '../../../lib/core/notifications/ports.ts';
import type { Clock } from '../../../lib/core/time/clock.ts';
import { EVENT_NOTIFICATIONS_TYPES } from './event-notifications-types.ts';
import type { GroupDispatcher, SlotCollector } from './ports.ts';

// まとめの送信は同時に動くと同じまとめを二重に送り得るため、20通を送る段の所要時間より十分長く排他する
export const FLUSH_SLOT_LEASE_SECONDS = 120;

export const FLUSH_SLOT_LEASE_WAIT_SECONDS = 30;

export const FLUSH_SLOT_DISPATCH_LIMIT = 20;

// Cloudflare Queuesが受け付ける遅延秒数の上限(12時間)
const MAX_DEFER_SECONDS = 43_200;

const MILLISECONDS_PER_SECOND = 1000;

const DONE: MessageHandlingResult = Object.freeze({ kind: 'done' });

const CONTINUE: MessageHandlingResult = Object.freeze({
  kind: 'defer',
  delaySeconds: NOTIFICATION_CONTINUE_DELAY_SECONDS,
});

const logger = getAppLogger(['event', 'notifications', 'flush']);

interface StepContext {
  readonly slot: StoredSlot;
  readonly holder: string;
  readonly now: Date;
}

function secondsUntil(deadline: Date, now: Date): number {
  return Math.min(
    Math.ceil((deadline.getTime() - now.getTime()) / MILLISECONDS_PER_SECOND),
    MAX_DEFER_SECONDS,
  );
}

// 1回の処理で1つの段を進め、続きは同じ封筒の遅延再送で受け取る。リースの保持者は封筒のIDのため、遅延再送と再試行の同じ封筒はリースを取り直せる。例外は捕まえずに投げ、再試行は保存した段・カーソルと未送信の通知から再開する
@injectable()
export class FlushSlotHandler implements MessageHandler<FlushNotificationSlotBody> {
  constructor(
    @inject(NOTIFICATIONS_PLATFORM_TYPES.NotificationSlotStore)
    private readonly slots: NotificationSlotStore,
    @inject(EVENT_NOTIFICATIONS_TYPES.EveningCollector)
    private readonly eveningCollector: SlotCollector,
    @inject(EVENT_NOTIFICATIONS_TYPES.MorningCollector)
    private readonly morningCollector: SlotCollector,
    @inject(EVENT_NOTIFICATIONS_TYPES.GroupDispatcher)
    private readonly dispatcher: GroupDispatcher,
    @inject(NOTIFICATIONS_PLATFORM_TYPES.NotificationIncidentReporter)
    private readonly incidents: NotificationIncidentReporter,
    @inject(PLATFORM_TYPES.Clock)
    private readonly clock: Clock,
  ) {}

  async handle(
    body: FlushNotificationSlotBody,
    meta: MessageMeta,
  ): Promise<MessageHandlingResult> {
    const now = this.clock.now();
    // 通知が0件の受賞では枠が作られないため、リースを取る前に枠の有無を確かめる
    const found = await this.slots.find(body.slotKey);
    if (found === undefined) {
      logger.info('送信枠が無いため送り出しを終えました', {
        slot: body.slotKey,
      });
      return DONE;
    }
    const holder = meta.id;
    if (
      !(await this.slots.acquireLease(
        body.slotKey,
        holder,
        now,
        FLUSH_SLOT_LEASE_SECONDS,
      ))
    ) {
      logger.info('送信枠のリースを取れないため後で送り出します', {
        slot: body.slotKey,
        phase: found.phase,
        delaySeconds: FLUSH_SLOT_LEASE_WAIT_SECONDS,
      });
      return { kind: 'defer', delaySeconds: FLUSH_SLOT_LEASE_WAIT_SECONDS };
    }
    // リースを取るまでに別の封筒が段を進めた場合に古い段をやり直さないよう、取った後の状態を読み直す
    const slot = await this.slots.find(body.slotKey);
    if (slot === undefined) {
      return DONE;
    }
    return this.runPhase({ slot, holder, now });
  }

  private runPhase(context: StepContext): Promise<MessageHandlingResult> {
    switch (context.slot.phase) {
      case 'waiting':
        return this.leaveWaiting(context);
      case 'collecting':
        return this.collect(context);
      case 'sending':
      case 'done':
        return this.dispatch(context);
    }
  }

  private async leaveWaiting(
    context: StepContext,
  ): Promise<MessageHandlingResult> {
    const { slot, holder, now } = context;
    if (slot.dispatchRequestedAt === null) {
      if (now.getTime() < slot.settleUntil.getTime()) {
        await this.slots.releaseLease(slot.key, holder);
        const delaySeconds = secondsUntil(slot.settleUntil, now);
        logger.info('送り出しの依頼を期限まで待ちます', {
          slot: slot.key,
          phase: slot.phase,
          delaySeconds,
        });
        return { kind: 'defer', delaySeconds };
      }
      // 前提の読み取りが失敗しても再試行で報告できるよう依頼の記録より先に読み、報告の後の失敗の再試行では依頼済みとして進めて同じ報告を繰り返さない
      const incident = await this.incompleteDispatchOf(slot);
      await this.slots.markDispatchRequested(slot.key, now);
      if (incident !== undefined) {
        this.incidents.report(incident);
      }
    }
    const phase: SlotPhase = slot.kind === 'award' ? 'sending' : 'collecting';
    await this.slots.advance(
      slot.key,
      holder,
      { phase, cursor: slot.cursor },
      now,
    );
    return this.runPhase({ ...context, slot: { ...slot, phase } });
  }

  private async incompleteDispatchOf(
    slot: StoredSlot,
  ): Promise<NotificationIncident | undefined> {
    if (slot.kind !== 'evening') {
      return undefined;
    }
    const missing = await this.slots.missingParticipants(slot.key);
    // 前提がそろった後に依頼の記録だけが欠けた夜は、そろわなかった前提が無いため報告しない
    if (missing !== null && missing.length === 0) {
      return undefined;
    }
    return {
      kind: 'evening-dispatch-incomplete',
      slotKey: slot.key,
      missing,
    };
  }

  private async collect(context: StepContext): Promise<MessageHandlingResult> {
    const { slot, holder, now } = context;
    const collector = this.collectorFor(slot);
    if (collector === undefined) {
      await this.slots.advance(
        slot.key,
        holder,
        { phase: 'sending', cursor: slot.cursor },
        now,
      );
      return this.dispatch({ ...context, slot: { ...slot, phase: 'sending' } });
    }
    const step = await collector.step(slot, now);
    if (step.kind === 'wait') {
      await this.slots.releaseLease(slot.key, holder);
      logger.info('収集を待ってから再開します', {
        slot: slot.key,
        phase: slot.phase,
        delaySeconds: step.delaySeconds,
        pendingKickoffs: step.pendingKickoffs,
      });
      return { kind: 'defer', delaySeconds: step.delaySeconds };
    }
    // 収集を終えた後のカーソルは使わないため、大きな進み具合を枠に残さない
    const change = step.done
      ? { phase: 'sending' as const, cursor: null }
      : { phase: 'collecting' as const, cursor: step.cursor };
    await this.slots.advance(slot.key, holder, change, now);
    logger.info('送信枠の収集の段を進めました', {
      slot: slot.key,
      phase: change.phase,
    });
    return CONTINUE;
  }

  private collectorFor(slot: StoredSlot): SlotCollector | undefined {
    switch (slot.kind) {
      case 'evening':
        return this.eveningCollector;
      case 'morning':
        return this.morningCollector;
      case 'award':
        return undefined;
    }
  }

  // 完了の枠へ遅れて記録された通知も同じ送信の段で送る
  private async dispatch(context: StepContext): Promise<MessageHandlingResult> {
    const { slot, holder, now } = context;
    const step = await this.dispatcher.dispatchNext(
      slot.key,
      now,
      FLUSH_SLOT_DISPATCH_LIMIT,
    );
    const counts = { emails: step.emails, skipped: step.skipped };
    if (step.more) {
      if (slot.phase === 'done') {
        await this.slots.advance(
          slot.key,
          holder,
          { phase: 'sending', cursor: slot.cursor },
          now,
        );
      }
      logger.info('送信枠の送信の段を進めました', {
        slot: slot.key,
        phase: 'sending',
        ...counts,
      });
      return CONTINUE;
    }
    if (slot.phase !== 'done') {
      await this.slots.advance(
        slot.key,
        holder,
        { phase: 'done', cursor: slot.cursor },
        now,
      );
    }
    await this.slots.releaseLease(slot.key, holder);
    logger.info('送信枠の送り出しを終えました', {
      slot: slot.key,
      phase: 'done',
      ...counts,
    });
    return DONE;
  }
}
