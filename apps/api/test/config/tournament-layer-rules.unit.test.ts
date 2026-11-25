import { describe, expect, test } from 'bun:test';

import {
  allowed,
  expectedStatementsOf,
  forbidden,
  type ImportCase,
  LINT_TIMEOUT_MS,
  type PositionCase,
  reportedStatementsOf,
} from '../support/layer-lint.ts';

const BRACKET_VIEW_IMPORTS: readonly ImportCase[] = [
  forbidden(
    "import { a } from '../../../lib/workers/tournament/d1-bracket-store.ts';",
  ),
  forbidden(
    "import type { b } from '../../../lib/core/week-tournament/ports.ts';",
  ),
  forbidden("import { c } from '../../../lib/core/week-tournament';"),
  forbidden(
    "import { weekBracketPathOf } from '../week-tournament/week-bracket-path.ts';",
  ),
  forbidden("import type { d } from '../week-tournament';"),
  forbidden(
    "import { e } from '../../infrastructure/match/d1-match-store.ts';",
  ),
  forbidden("import { env } from 'cloudflare:workers';"),
  allowed(
    "import type { BracketRecord } from '../../../lib/core/tournament/ports.ts';",
  ),
  allowed(
    "import { bracketLayout } from '../../../lib/core/tournament/bracket-layout.ts';",
  ),
  allowed(
    "import { tournamentRoundName } from '../../../common-lib/tournament/round-name.ts';",
  ),
  allowed("import type { MatchView } from '../match/match-view-reader.ts';"),
];

const toFixtures = (statement: string): string =>
  statement.replaceAll("'../", "'../../");

const TOURNAMENT_LAYER_CASES: readonly PositionCase[] = [
  {
    file: 'src/application/tournament/bracket-view-builder.ts',
    imports: BRACKET_VIEW_IMPORTS,
  },
  {
    file: 'src/application/tournament/bracket-view-builder.unit.test.ts',
    imports: BRACKET_VIEW_IMPORTS,
  },
  {
    file: 'src/application/tournament/testing/bracket-view-fixtures.ts',
    imports: BRACKET_VIEW_IMPORTS.map(({ statement, reported }) => ({
      statement: toFixtures(statement),
      reported,
    })),
  },
];

// 種類によらない表示の組み立ての禁止はその部品だけに当て、Weekのトロフィーを読む同じディレクトリの部品は変えない
const UNRESTRICTED_CASES: readonly PositionCase[] = [
  {
    file: 'src/application/tournament/product-trophy-reader.ts',
    imports: [
      allowed(
        "import { WEEK_TOURNAMENT_API_TYPES } from '../week-tournament/week-tournament-api-types.ts';",
      ),
      allowed(
        "import type { a } from '../../../lib/core/week-tournament/ports.ts';",
      ),
    ],
  },
];

describe('apiのブラケットの表示の組み立ての読み込み', () => {
  test.each(
    TOURNAMENT_LAYER_CASES.map((position) => [position.file, position]),
  )(
    '%sでWorkersの部品・Weekの部品・外側の層の読み込みを報告し、core/tournamentの契約を読み込める',
    async (_file, position) => {
      expect(await reportedStatementsOf('api', position)).toEqual(
        expectedStatementsOf(position),
      );
    },
    LINT_TIMEOUT_MS,
  );

  test.each(UNRESTRICTED_CASES.map((position) => [position.file, position]))(
    '%sではWeekの部品の読み込みを報告しない',
    async (_file, position) => {
      expect(await reportedStatementsOf('api', position)).toEqual(
        expectedStatementsOf(position),
      );
    },
    LINT_TIMEOUT_MS,
  );
});
