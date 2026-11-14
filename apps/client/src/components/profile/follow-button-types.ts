export type FollowButtonSize = 'sm' | 'default';

export interface FollowState {
  readonly following: boolean;
  readonly followerCount: number;
}
