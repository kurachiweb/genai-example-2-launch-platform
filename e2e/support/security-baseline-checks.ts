import { type APIResponse, expect } from '@playwright/test';

import {
  findScriptTagsWithoutNonce,
  findSecurityHeaderProblems,
  scriptNonceOf,
  type SecurityHeaderTarget,
} from './security-assertions.ts';

const CSP_HEADER_NAME = 'content-security-policy';

export const SET_COOKIE_HEADER_NAME = 'set-cookie';

export const HTML_ACCEPT_HEADER = { accept: 'text/html' } as const;

export function expectSecurityHeaders(
  response: APIResponse,
  target: SecurityHeaderTarget,
): void {
  expect(findSecurityHeaderProblems(response.headers(), target)).toEqual([]);
}

// HTMLの全てのスクリプトが、応答のCSPのnonceと同じnonceを持つことを確かめる
export async function expectPageNonce(response: APIResponse): Promise<void> {
  const nonce = scriptNonceOf(response.headers()[CSP_HEADER_NAME] ?? '');
  expect(nonce).toBeDefined();
  const html = await response.text();
  expect(html).toContain('<script');
  expect(findScriptTagsWithoutNonce(html, nonce ?? '')).toEqual([]);
}

export async function expectErrorCode(
  response: APIResponse,
  status: number,
  code: string,
): Promise<void> {
  expect(response.status()).toBe(status);
  expect(await response.json()).toEqual({
    error: { code, message: expect.any(String) },
  });
}
