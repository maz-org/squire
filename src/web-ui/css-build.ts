import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { compile, optimize } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';

import { STYLES_PATH, WEB_UI_DIR } from './asset-paths.ts';

interface CompileAppCssOptions {
  minify?: boolean;
}

interface CssBuildEntry {
  content: string;
  hash: string;
}

export async function compileAppCss({
  minify = false,
}: CompileAppCssOptions = {}): Promise<CssBuildEntry> {
  const cssSource = await readFile(STYLES_PATH, 'utf8');
  const compiler = await compile(cssSource, {
    base: WEB_UI_DIR,
    onDependency: () => {
      // Dev invalidation is handled by assets.ts. Docker builds run once.
    },
  });
  const scanner = new Scanner({ sources: compiler.sources });
  const candidates = scanner.scan();
  let content = compiler.build(candidates);
  if (minify) content = optimize(content, { minify: true }).code;
  return { content, hash: hashContent(content) };
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 10);
}
