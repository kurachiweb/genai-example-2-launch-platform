import { describe, expect, test } from 'bun:test';
import type { BatchItem } from 'drizzle-orm/batch';
import type { ServiceIdentifier } from 'inversify';

import { AppError } from '../../../lib/core/errors/app-error.ts';
import { LifecycleRegistrationError } from '../../../lib/core/identity/user-lifecycle.ts';
import type { NewModerationRecord } from '../../../lib/core/moderation/ports.ts';
import type { ModerationWriteParticipation } from '../../application/moderation/ports.ts';
import {
  createModerationWriteParticipants,
  type ModerationWriteContext,
  type ModerationWriteParticipant,
  type ModerationWriteParticipantRegistration,
  moderationWriteContextOf,
} from './moderation-write-participant.ts';

const REPORT_CLOSURE = Symbol.for('test.ReportClosureParticipant');

const NOTE_PARTICIPANT = Symbol.for('test.NoteParticipant');

const CONTEXT: ModerationWriteContext = {
  actionId: '01JQ0MDR000000000000000001',
  action: 'comment.hide',
  targetId: '01JD0COMMENT00000000000001',
  occurredAt: new Date('2026-11-20T04:21:00.000Z'),
};

const STATEMENT = { label: '参加者の文' } as unknown as BatchItem<'sqlite'>;

interface RecordingParticipant extends ModerationWriteParticipant {
  readonly calls: (readonly [
    ModerationWriteParticipation,
    ModerationWriteContext,
  ])[];
}

function participantReturning(
  statements: readonly BatchItem<'sqlite'>[],
): RecordingParticipant {
  const calls: (readonly [
    ModerationWriteParticipation,
    ModerationWriteContext,
  ])[] = [];
  return {
    calls,
    statementsFor: (participation, context) => {
      calls.push([participation, context]);
      return Promise.resolve(statements);
    },
  };
}

interface RecordingResolver {
  readonly resolved: ServiceIdentifier[];
  readonly resolve: <T>(identifier: ServiceIdentifier<T>) => T;
}

function resolverOf(
  entries: ReadonlyMap<ServiceIdentifier, unknown>,
): RecordingResolver {
  const resolved: ServiceIdentifier[] = [];
  return {
    resolved,
    resolve: <T>(identifier: ServiceIdentifier<T>): T => {
      resolved.push(identifier);
      if (!entries.has(identifier)) {
        throw new Error('登録の無い識別子を解決しようとしました');
      }
      return entries.get(identifier) as T;
    },
  };
}

function registrationOf(
  kind: string,
  participant: symbol = REPORT_CLOSURE,
): ModerationWriteParticipantRegistration {
  return { kind, participant };
}

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error: unknown) {
    return error;
  }
  throw new Error('失敗するはずの呼び出しが成功しました');
}

describe('createModerationWriteParticipants(登録の検証)', () => {
  test.each([
    ['大文字を含む', 'Content-Reporting.report-closure'],
    ['spec名と名詞句の区切りが無い', 'content-reporting'],
    ['名詞句が空', 'content-reporting.'],
  ])(
    '種類が<spec名>.<名詞句>の形でない(%s)登録は、組み立ての時に拒否する',
    (_case, kind) => {
      expect(() =>
        createModerationWriteParticipants(
          [registrationOf(kind)],
          resolverOf(new Map()).resolve,
        ),
      ).toThrow(LifecycleRegistrationError);
    },
  );

  test('同じ種類を2回登録すると、組み立ての時に重複として拒否する', () => {
    expect(() =>
      createModerationWriteParticipants(
        [
          registrationOf('content-reporting.report-closure'),
          registrationOf('content-reporting.report-closure', NOTE_PARTICIPANT),
        ],
        resolverOf(new Map()).resolve,
      ),
    ).toThrow(
      new LifecycleRegistrationError(
        '措置の書き込みの参加者の種類が重複しています: "content-reporting.report-closure"',
      ),
    );
  });

  test('空の登録と、形式どおりで重複しない登録は組み立てられ、組み立ての時には参加者を解決しない', () => {
    const resolver = resolverOf(new Map());

    expect(() =>
      createModerationWriteParticipants([], resolver.resolve),
    ).not.toThrow();
    expect(() =>
      createModerationWriteParticipants(
        [
          registrationOf('content-reporting.report-closure'),
          registrationOf('test-spec.note', NOTE_PARTICIPANT),
        ],
        resolver.resolve,
      ),
    ).not.toThrow();
    expect(resolver.resolved).toStrictEqual([]);
  });
});

describe('createModerationWriteParticipants(参加者の文の解決)', () => {
  test('参加が無ければ参加者を解決せず、文を返さない', async () => {
    const participant = participantReturning([STATEMENT]);
    const resolver = resolverOf(new Map([[REPORT_CLOSURE, participant]]));
    const participants = createModerationWriteParticipants(
      [registrationOf('content-reporting.report-closure')],
      resolver.resolve,
    );

    const statements = await participants.statementsFor(undefined, CONTEXT);

    expect(statements).toStrictEqual([]);
    expect(resolver.resolved).toStrictEqual([]);
    expect(participant.calls).toStrictEqual([]);
  });

  test('登録の無い種類の参加は、束縛か呼び出し側の誤りとしてAppErrorでない通常のErrorを投げる', async () => {
    const participants = createModerationWriteParticipants(
      [registrationOf('content-reporting.report-closure')],
      resolverOf(new Map()).resolve,
    );

    const error = await failureOf(
      participants.statementsFor(
        { kind: 'content-reporting.unknown', payload: {} },
        CONTEXT,
      ),
    );

    expect(error).toStrictEqual(
      new Error(
        '措置の書き込みの参加者に登録の無い種類です: "content-reporting.unknown"',
      ),
    );
    expect(error).not.toBeInstanceOf(AppError);
  });

  test('登録した種類の参加者を解決し、参加の値と文脈をそのまま渡して、その文を返す', async () => {
    const participant = participantReturning([STATEMENT]);
    const other = participantReturning([]);
    const resolver = resolverOf(
      new Map<ServiceIdentifier, unknown>([
        [REPORT_CLOSURE, participant],
        [NOTE_PARTICIPANT, other],
      ]),
    );
    const participants = createModerationWriteParticipants(
      [
        registrationOf('content-reporting.report-closure'),
        registrationOf('test-spec.note', NOTE_PARTICIPANT),
      ],
      resolver.resolve,
    );
    const participation = {
      kind: 'content-reporting.report-closure',
      payload: { reportId: '01JR0REPORT000000000000001' },
    };

    const statements = await participants.statementsFor(participation, CONTEXT);

    expect(statements).toStrictEqual([STATEMENT]);
    expect(resolver.resolved).toStrictEqual([REPORT_CLOSURE]);
    expect(participant.calls).toHaveLength(1);
    const [received, context] = participant.calls[0] ?? [];
    expect(received).toBe(participation);
    expect(context).toBe(CONTEXT);
    expect(other.calls).toStrictEqual([]);
  });
});

describe('moderationWriteContextOf', () => {
  test('記録のID・措置の種類・対象・日時から参加者へ渡す文脈を作る', () => {
    const record: NewModerationRecord = {
      id: CONTEXT.actionId,
      action: 'comment.hide',
      targetId: CONTEXT.targetId,
      subjectUserId: '01JC0VSER00000000000000002',
      productId: '01JD0PRODUCT00000000000001',
      operatorAdminId: '01JQ0ADM000000000000000001',
      reason: '誹謗中傷のため',
      lifecycleEventId: null,
      occurredAt: CONTEXT.occurredAt,
      noticeStatus: 'pending',
    };

    expect(moderationWriteContextOf(record)).toStrictEqual(CONTEXT);
  });
});
