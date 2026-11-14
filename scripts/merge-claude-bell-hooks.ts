import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { type ClaudeSettings, mergeBellHooks } from './claude-bell-hooks';

// ユーザー設定にはモデルや他ツールのフックなど利用者ごとの設定が含まれるため、ファイル全体を上書きせず、ベルのフックだけを冪等にマージする。
const configDir = process.env.CLAUDE_CONFIG_DIR;
if (!configDir) {
  throw new Error('環境変数CLAUDE_CONFIG_DIRが未設定です。');
}
const path = `${configDir}/settings.json`;

// 壊れた設定を初期化すると利用者の設定を失うため、JSONとして読めなければ書き込まずに失敗させる
const settings: ClaudeSettings = existsSync(path)
  ? (JSON.parse(readFileSync(path, 'utf8')) as ClaudeSettings)
  : {};

// 一時ファイルへ書いてからリネームすることで書き込み中断時の破壊を防ぐ
const mergedSettingsTempPath = `${path}.tmp`;
try {
  writeFileSync(
    mergedSettingsTempPath,
    `${JSON.stringify(mergeBellHooks(settings), null, 2)}\n`,
  );
  renameSync(mergedSettingsTempPath, path);
} catch (error) {
  if (existsSync(mergedSettingsTempPath)) {
    rmSync(mergedSettingsTempPath);
  }
  throw error;
}
