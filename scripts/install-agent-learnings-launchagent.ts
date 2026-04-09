import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const LABEL = 'org.maz.squire.agent-learnings';

export function buildLaunchAgentPlist(repoRoot: string): string {
  const escapedRepoRoot = repoRoot
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
  const shellCommand = [
    'export NVM_DIR="$HOME/.nvm"',
    '[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"',
    'nvm use >/dev/null 2>&1 || true',
    `[ -f "$HOME/.gstack/projects/maz-org-squire/learnings.jsonl" ] || exit 0`,
    `cd "${repoRoot}"`,
    'npm run agent:export-learnings >>"$HOME/.gstack/analytics/squire-agent-learnings.log" 2>&1',
  ].join('; ');

  const escapedCommand = shellCommand
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
      <string>/bin/zsh</string>
      <string>-lc</string>
      <string>${escapedCommand}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${escapedRepoRoot}</string>
    <key>RunAtLoad</key>
    <true/>
    <key>StartInterval</key>
    <integer>604800</integer>
    <key>StandardOutPath</key>
    <string>${homedir()}/.gstack/analytics/squire-agent-learnings.log</string>
    <key>StandardErrorPath</key>
    <string>${homedir()}/.gstack/analytics/squire-agent-learnings.log</string>
  </dict>
</plist>
`;
}

export function shouldInstallLaunchAgent(): { install: boolean; reason?: string } {
  if (process.env.CI === 'true') {
    return { install: false, reason: 'CI environment' };
  }
  if (process.platform !== 'darwin') {
    return { install: false, reason: 'non-macOS environment' };
  }
  if (!homedir()) {
    return { install: false, reason: 'HOME is not set' };
  }
  return { install: true };
}

export function getLaunchAgentPath(): string {
  return path.join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
}

export function installLaunchAgent(repoRoot: string): string {
  const plistPath = getLaunchAgentPath();
  mkdirSync(path.dirname(plistPath), { recursive: true });
  mkdirSync(path.join(homedir(), '.gstack', 'analytics'), { recursive: true });
  writeFileSync(plistPath, buildLaunchAgentPlist(repoRoot), 'utf8');
  return plistPath;
}

export function loadLaunchAgent(plistPath: string): void {
  const uid = String(process.getuid?.() ?? '');
  if (!uid) return;

  try {
    execFileSync('/bin/launchctl', ['bootout', `gui/${uid}`, plistPath], { stdio: 'ignore' });
  } catch {
    // No existing agent to unload is fine.
  }
  execFileSync('/bin/launchctl', ['bootstrap', `gui/${uid}`, plistPath], { stdio: 'ignore' });
}

export function isPlistUpToDate(plistPath: string, repoRoot: string): boolean {
  if (!existsSync(plistPath)) return false;
  return readFileSync(plistPath, 'utf8') === buildLaunchAgentPlist(repoRoot);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const decision = shouldInstallLaunchAgent();
  if (!decision.install) {
    console.log(`Skipping launch agent install: ${decision.reason}`);
    process.exit(0);
  }

  const repoRoot = path.resolve(new URL('..', import.meta.url).pathname);
  const plistPath = getLaunchAgentPath();

  if (isPlistUpToDate(plistPath, repoRoot)) {
    console.log(`Launch agent already up to date at ${plistPath}`);
    process.exit(0);
  }

  const installedPath = installLaunchAgent(repoRoot);
  loadLaunchAgent(installedPath);
  console.log(`Installed launch agent at ${installedPath}`);
}
