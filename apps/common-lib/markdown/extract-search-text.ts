import { DEFAULT_ID_PREFIX } from './markdown-options.ts';
import { processMarkdown } from './markdown-processor.ts';
import { plainTextOf } from './plain-text.ts';

export const extractSearchText = (markdown: string): string =>
  plainTextOf(processMarkdown(markdown, DEFAULT_ID_PREFIX));
