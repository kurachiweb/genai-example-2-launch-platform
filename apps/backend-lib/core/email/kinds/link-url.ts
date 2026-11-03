import { z } from 'zod';

// ローカル環境の画面のオリジンだけはHTTPSでないため、http:はホスト名がlocalhostのときに限る
function isAllowedLinkUrl(value: string): boolean {
  if (value.startsWith('https://')) {
    return true;
  }
  return (
    value.startsWith('http://localhost') &&
    URL.parse(value)?.hostname === 'localhost'
  );
}

export const linkUrlSchema = z.url().refine(isAllowedLinkUrl, {
  message: 'リンクのURLはhttps:かhttp://localhostで始めてください',
});
