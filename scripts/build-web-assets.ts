import 'dotenv/config';

import { mkdir, writeFile } from 'node:fs/promises';

import { GENERATED_APP_CSS_PATH, GENERATED_WEB_UI_DIR } from '../src/web-ui/asset-paths.ts';
import { compileAppCss } from '../src/web-ui/css-build.ts';

async function main(): Promise<void> {
  const { content, hash } = await compileAppCss({ minify: true });
  await mkdir(GENERATED_WEB_UI_DIR, { recursive: true });
  await writeFile(GENERATED_APP_CSS_PATH, content);
  console.log(`✓ built ${GENERATED_APP_CSS_PATH} (${hash})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
