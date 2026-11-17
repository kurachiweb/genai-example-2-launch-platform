import type { ClientWeekBracketQuery } from '../../graphql/generated/graphql.ts';

export type WeekBracketView = NonNullable<
  ClientWeekBracketQuery['weekBracket']
>;
