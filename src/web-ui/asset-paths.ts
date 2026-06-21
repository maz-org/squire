import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WEB_UI_DIR = path.dirname(fileURLToPath(import.meta.url));
export const STYLES_PATH = path.join(WEB_UI_DIR, 'styles.css');
export const SQUIRE_JS_PATH = path.join(WEB_UI_DIR, 'squire.js');
export const SQUIRE_LOGO_PNG_PATH = path.join(WEB_UI_DIR, 'squire-wax-seal-s.png');
export const HTMX_JS_PATH = path.join(
  WEB_UI_DIR,
  '..',
  '..',
  'node_modules',
  'htmx.org',
  'dist',
  'htmx.js',
);
export const GENERATED_WEB_UI_DIR = path.join(WEB_UI_DIR, '..', '..', 'dist', 'web-ui');
export const GENERATED_APP_CSS_PATH = path.join(GENERATED_WEB_UI_DIR, 'app.css');
