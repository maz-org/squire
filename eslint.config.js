import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
        URL: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Ban TypeScript parameter-property constructor syntax project-wide.
      // Node 22's `--experimental-strip-types` loader (used by
      // `node src/server.ts` / `npm run serve`) rejects `constructor(private x)`
      // with ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX, crashing the production
      // server at module-load time. Vitest has its own TS pipeline and masks
      // the issue, so unit tests pass while the real process refuses to
      // boot. Linting catches every new occurrence. Caught live by /qa on
      // SQR-69.
      '@typescript-eslint/parameter-properties': ['error', { prefer: 'class-property' }],
    },
  },
  {
    ignores: ['node_modules/', 'data/'],
  },
);
