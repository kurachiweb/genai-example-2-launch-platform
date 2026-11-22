import { toBusinessDateTime } from '../time/business-time.ts';

const FORBIDDEN_CHARACTERS = /[:*?"<>|]/g;
const RESERVED_DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const TRAILING_DOTS_AND_SPACES = /[. ]+$/;
const BLANK_EXTENSION = /^ *$/;
const FALLBACK_STEM = 'file';
const FIRST_COLLISION_SEQUENCE = 2;

interface NameParts {
  readonly stem: string;
  readonly extension: string;
}

// 拡張子は最後の`.`から後ろとする。空や半角スペースだけの拡張子は拡張子として扱わず、区切りの`.`ごと名前の一部にして末尾の除去の対象にする
function splitName(name: string): NameParts {
  const dotIndex = name.lastIndexOf('.');
  if (dotIndex < 0 || BLANK_EXTENSION.test(name.slice(dotIndex + 1))) {
    return { stem: name, extension: '' };
  }
  return {
    stem: name.slice(0, dotIndex),
    extension: name.slice(dotIndex),
  };
}

// 末尾の除去で拡張子の境界が移る(`con.txt.`→`con.txt`)ため、名前が変わらなくなるまで拡張子を取り直して繰り返す
function trimStemTrailing(name: string): string {
  const { stem, extension } = splitName(name);
  const trimmed = `${stem.replace(TRAILING_DOTS_AND_SPACES, '')}${extension}`;
  return trimmed === name ? name : trimStemTrailing(trimmed);
}

export function toPortableFileName(name: string): string {
  const trimmedName = trimStemTrailing(name.replace(FORBIDDEN_CHARACTERS, '-'));
  const { stem, extension } = splitName(trimmedName);
  const safeStem = RESERVED_DEVICE_NAME.test(stem) ? `${stem}_` : stem;
  const portable = `${safeStem}${extension}`;
  return portable === '' ? FALLBACK_STEM : portable;
}

export interface EntryNameAllocator {
  allocate(directory: string, name: string): string;
}

interface DirectoryState {
  readonly usedNames: Set<string>;
  readonly nextSequenceByName: Map<string, number>;
}

export function createEntryNameAllocator(): EntryNameAllocator {
  const stateByDirectory = new Map<string, DirectoryState>();

  return {
    allocate(directory, name) {
      const state = stateByDirectory.get(directory) ?? {
        usedNames: new Set<string>(),
        nextSequenceByName: new Map<string, number>(),
      };
      stateByDirectory.set(directory, state);

      const requestedKey = name.toLowerCase();
      if (!state.usedNames.has(requestedKey)) {
        state.usedNames.add(requestedKey);
        return name;
      }

      const { stem, extension } = splitName(name);
      // 同じ名前の連番は前回の続きから探し、同名が大量にあっても数え直さない
      let sequence =
        state.nextSequenceByName.get(requestedKey) ?? FIRST_COLLISION_SEQUENCE;
      let candidate = `${stem}-${String(sequence)}${extension}`;
      while (state.usedNames.has(candidate.toLowerCase())) {
        sequence += 1;
        candidate = `${stem}-${String(sequence)}${extension}`;
      }
      state.usedNames.add(candidate.toLowerCase());
      state.nextSequenceByName.set(requestedKey, sequence + 1);
      return candidate;
    },
  };
}

export function archiveFileName(handle: string, requestedAt: Date): string {
  const businessDate = toBusinessDateTime(requestedAt).date.replaceAll('-', '');
  return `launch-stadium-export-${handle}-${businessDate}.zip`;
}

export const EXPORT_SCHEMA_VERSION = 1;

export const README_TEXT = [
  'Launch Stadiumをご利用いただきありがとうございます。',
  '',
  'このアーカイブには、あなたがLaunch Stadiumで登録・投稿したデータと、あなたのプロダクトが受けた対戦成績が含まれています。',
  '',
  'JSONファイル一覧はmanifest.jsonをご覧ください。',
  'プロダクトの説明文やコメントなどのマークダウン本文は、各JSONから相対パスで参照される.mdファイルに保存されています。',
  '',
].join('\n');
