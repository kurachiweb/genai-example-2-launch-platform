const WHITESPACE_RUN = /\p{White_Space}+/gu;

const EDGE_WHITESPACE = /^\p{White_Space}+|\p{White_Space}+$/gu;

export const normalizeIndexText = (text: string): string =>
  text
    .normalize('NFKC')
    .replace(EDGE_WHITESPACE, '')
    .replace(WHITESPACE_RUN, ' ');
