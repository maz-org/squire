import { chmodSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const hookDir = path.join(repoRoot, '.husky');
const gitMetadataPath = path.join(repoRoot, '.git');
const hookFiles = ['post-checkout', 'pre-commit'];

if (!existsSync(gitMetadataPath) || !existsSync(hookDir)) {
  console.warn(`Skipping git hook setup outside a full git worktree: ${repoRoot}`);
  process.exit(0);
}

try {
  execFileSync('git', ['config', 'core.hooksPath', '.husky'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
} catch {
  console.warn(`Skipping git hook setup because git is unavailable: ${repoRoot}`);
  process.exit(0);
}

for (const hookFile of hookFiles) {
  const fullPath = path.join(hookDir, hookFile);
  if (!existsSync(fullPath)) {
    throw new Error(`Missing hook file: ${fullPath}`);
  }

  chmodSync(fullPath, 0o755);
}
