import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

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
    renameSync(path, `${path}.broken-${Date.now()}`);
  }
}

data.projects ??= {};
data.projects["/workspace"] = {
  ...data.projects["/workspace"],
  hasTrustDialogAccepted: true,
  hasCompletedProjectOnboarding: true,
};

// 一時ファイルへ書いてからリネームすることで書き込み中断時の破壊を防ぐ
const mergedConfigTempPath = `${path}.tmp`;
writeFileSync(mergedConfigTempPath, JSON.stringify(data));
renameSync(mergedConfigTempPath, path);
