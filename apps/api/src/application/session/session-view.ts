import type { Principal } from './session-verifier.ts';

// application層はpresentation層のSessionAccessを読み込めないため、同じ要求のセッションを読み取りだけの形で受け取る
export interface SessionView {
  principal(): Promise<Principal>;
}
