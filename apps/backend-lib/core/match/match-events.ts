export const MATCH_EVENT_TYPES = Object.freeze([
  'scheduled',
  'started',
  'decided',
] as const);

export type MatchEventType = (typeof MATCH_EVENT_TYPES)[number];

export const MATCH_EVENT_STATUSES = Object.freeze([
  'pending',
  'completed',
] as const);

export type MatchEventStatus = (typeof MATCH_EVENT_STATUSES)[number];
