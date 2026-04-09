import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import noInlineHtmlResponse from './eslint-rules/no-inline-html-response.js';
import noCacheOnAuthenticatedRoutes from './eslint-rules/no-cache-on-authenticated-routes.js';
import noExportedRowTypes from './eslint-rules/no-exported-row-types.js';

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
      // Node 22's `--experimental-strip-types` loader rejects `constructor(private x)`
      // with ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX. Vitest masks the issue.
      '@typescript-eslint/parameter-properties': ['error', { prefer: 'class-property' }],
    },
  },
  {
    // Browser-side vanilla JS islands (SQR-71, ADR 0011).
    files: ['src/web-ui/**/*.js'],
    languageOptions: {
      globals: {
        document: 'readonly',
        window: 'readonly',
      },
    },
  },

  // ─── Application layering rules (SQR-83) ──────────────────────────────
  // Enforce the four-layer architecture described in ARCHITECTURE.md
  // § Application Layering. See docs/agent/lint-rules.md for details.

  // Rule 1: Views must not import from auth or persistence layers.
  // Views are pure data in, HTML out. Only domain types are allowed.
  {
    files: ['src/web-ui/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/auth/*', '**/auth.ts'],
              message:
                'Views must not import from auth modules. FIX: Accept session?: Session as a function parameter instead of importing auth internals. Import the Session type from src/db/repositories/types.ts. See src/web-ui/layout.ts for the pattern.',
            },
            {
              group: ['**/db.ts', '**/db/schema/*'],
              message:
                'Views must not import from the database layer. FIX: Import domain types (Session, User) from src/db/repositories/types.ts instead. Views never touch Drizzle, schema, or db.ts directly.',
            },
            {
              group: ['**/db/repositories/*-repository*'],
              message:
                'Views must not import repository implementations. FIX: Import domain types (Session, User) from src/db/repositories/types.ts only. Views receive data as function parameters, not by calling repositories.',
            },
          ],
        },
      ],
    },
  },

  // Rule 2: Repositories must not import from auth (except audit) or views.
  // Persistence layer depends down only.
  {
    files: ['src/db/repositories/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/auth/*', '!**/auth/audit*'],
              message:
                'Repositories must not import from auth modules. FIX: If you need DbOrTx, import it from src/auth/audit.ts (the one allowed exception). For everything else, the persistence layer depends down only: schema and db.ts.',
            },
            {
              group: ['**/web-ui/*'],
              message:
                'Repositories must not import from the view layer. FIX: Repositories return domain types. The route handler passes them to views. Repositories never render HTML.',
            },
            {
              group: ['**/server.ts'],
              message:
                'Repositories must not import from route handlers. FIX: Dependencies flow down only. If you need request data in a repository, pass it as a function parameter.',
            },
          ],
        },
      ],
    },
  },

  // Rule 3: Domain types must not use Drizzle or schema imports.
  // The domain contract is ORM-independent.
  {
    files: ['src/db/repositories/types.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['drizzle-orm', 'drizzle-orm/*', '**/db/schema/*', '**/db.ts'],
              message:
                'Domain types must be ORM-independent. FIX: Define domain types as plain TypeScript interfaces with no Drizzle imports. Row types ($inferSelect) belong inside the repository files, not in types.ts.',
            },
          ],
        },
      ],
    },
  },

  // Rule 4: Repository files must not export row types.
  {
    files: ['src/db/repositories/*-repository.ts'],
    plugins: {
      squire: {
        rules: {
          'no-exported-row-types': noExportedRowTypes,
        },
      },
    },
    rules: {
      'squire/no-exported-row-types': 'error',
    },
  },

  // Rule 5: No inline HTML in route handlers.
  // Rule 6: Authenticated routes must set Cache-Control.
  {
    files: ['src/server.ts'],
    plugins: {
      squire: {
        rules: {
          'no-inline-html-response': noInlineHtmlResponse,
          'no-cache-on-authenticated-routes': noCacheOnAuthenticatedRoutes,
        },
      },
    },
    rules: {
      'squire/no-inline-html-response': 'error',
      'squire/no-cache-on-authenticated-routes': 'error',
    },
  },

  {
    ignores: ['node_modules/', 'data/', 'eslint-rules/'],
  },
);
