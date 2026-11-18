import { and, isNull, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { inject, injectable } from 'inversify';

import type { Database } from '../../../db/client.ts';
import { sponsorshipDisplayStops } from '../../../db/schema/sponsorship/sponsorship-display-stops.ts';
import { PLATFORM_TYPES } from '../../core/di/identifiers.ts';
import type { IdGenerator } from '../../core/ids/id-generator.ts';
import type { DisplayStopSubject } from '../../core/sponsorship/ports.ts';
import {
  displayStopSubjectColumnsOf,
  displayStopSubjectIs,
} from './display-stop-subject.ts';

// 非公開化・停止とその解除の確定と同じ一括の書き込みへ並べる文を返す。infrastructure層の同期の処理だけが使う
export interface DisplayStopStatements {
  // 同じ主体の継続中の区間が無いときだけ、atに始まる継続中の区間を作る
  startStatement(
    subject: DisplayStopSubject,
    at: Date,
    db: Database,
  ): BatchItem<'sqlite'>;
  // 同じ主体の継続中の区間をatで終える。継続中の区間が無ければ何も変えない
  endStatement(
    subject: DisplayStopSubject,
    at: Date,
    db: Database,
  ): BatchItem<'sqlite'>;
}

@injectable()
export class D1DisplayStopStatements implements DisplayStopStatements {
  constructor(
    @inject(PLATFORM_TYPES.IdGenerator) private readonly ids: IdGenerator,
  ) {}

  startStatement(
    subject: DisplayStopSubject,
    at: Date,
    db: Database,
  ): BatchItem<'sqlite'> {
    const { kind, id } = displayStopSubjectColumnsOf(subject);
    const atMs = at.getTime();
    const openInterval = and(
      displayStopSubjectIs(subject),
      isNull(sponsorshipDisplayStops.endedAt),
    );
    return db.run(
      sql`INSERT INTO ${sponsorshipDisplayStops} (id, subject_kind, subject_id, started_at, ended_at, created_at, updated_at) SELECT ${this.ids.generate()}, ${kind}, ${id}, ${atMs}, NULL, ${atMs}, ${atMs} WHERE NOT EXISTS (SELECT 1 FROM ${sponsorshipDisplayStops} WHERE ${openInterval})`,
    );
  }

  endStatement(
    subject: DisplayStopSubject,
    at: Date,
    db: Database,
  ): BatchItem<'sqlite'> {
    return db
      .update(sponsorshipDisplayStops)
      .set({ endedAt: at, updatedAt: at })
      .where(
        and(
          displayStopSubjectIs(subject),
          isNull(sponsorshipDisplayStops.endedAt),
        ),
      );
  }
}
