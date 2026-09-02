import {
  chmodSync,
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";

interface ClaudeConfig {
  projects?: Record<string, Record<string, unknown> | undefined>;
}

// `.claude.json`にはセッション履歴やOAuth情報など実行時に蓄積されるデータが含まれるため、ファイル全体を上書きせず、
// ワークスペース信頼設定のキーだけを既存内容を保持したまま冪等にマージする。
const configDir = process.env.CLAUDE_CONFIG_DIR;
if (!configDir) {
  throw new Error("環境変数CLAUDE_CONFIG_DIRが未設定です。");
}
const path = `${configDir}/.claude.json`;

let data: ClaudeConfig = {};
if (existsSync(path)) {
  try {
    data = JSON.parse(readFileSync(path, "utf8")) as ClaudeConfig;
  } catch {
    // 破損時は既存内容を捨てず、バックアップを退避してから初期化する
    const brokenBackupPath = `${path}.broken`;
    renameSync(path, brokenBackupPath);
    // OAuth情報等の機密データを含むため、owner以外から読めないよう0600に固定する
    chmodSync(brokenBackupPath, 0o600);
  }
}

data = {
  ...data,
  projects: {
    ...data.projects,
    "/workspace": {
      ...data.projects?.["/workspace"],
      hasTrustDialogAccepted: true,
      hasCompletedProjectOnboarding: true,
    },
  },
};

// 一時ファイルへ書いてからリネームすることで書き込み中断時の破壊を防ぐ
const mergedConfigTempPath = `${path}.tmp`;
try {
  // OAuth情報等の機密データを含むため、renameSync後もowner以外から読めないよう0600で作成する
  writeFileSync(mergedConfigTempPath, JSON.stringify(data), { mode: 0o600 });
  renameSync(mergedConfigTempPath, path);
} catch (error) {
  if (existsSync(mergedConfigTempPath)) {
    rmSync(mergedConfigTempPath);
  }
  throw error;
}
