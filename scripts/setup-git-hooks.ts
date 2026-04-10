import { chmodSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const hookDir = path.join(repoRoot, '.husky');
const hookFiles = ['post-checkout', 'pre-commit', 'pre-push'];

if (!existsSync(hookDir)) {
  throw new Error(`Missing hook directory: ${hookDir}`);
}

execFileSync('git', ['config', 'core.hooksPath', '.husky'], {
  cwd: repoRoot,
  stdio: 'inherit',
});

for (const hookFile of hookFiles) {
  const fullPath = path.join(hookDir, hookFile);
  if (!existsSync(fullPath)) {
    throw new Error(`Missing hook file: ${fullPath}`);
  }

  chmodSync(fullPath, 0o755);
}
