// パス・クエリ・フラグメントを持たないhttp・httpsのオリジンだけを受け付ける
export function isHttpOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.origin === value
    );
  } catch {
    return false;
  }
}
