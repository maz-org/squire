import { describe, it } from 'vitest';
import { RuleTester } from 'eslint';
import rule from '../../eslint-rules/no-cache-on-authenticated-routes.js';

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
});

describe('no-cache-on-authenticated-routes', () => {
  it('requires Cache-Control: no-store on routes using requireSession()', () => {
    ruleTester.run('no-cache-on-authenticated-routes', rule, {
      valid: [
        // Authenticated route WITH Cache-Control: no-store — compliant
        {
          code: `
            app.get('/auth/me', requireSession(), async (c) => {
              c.header('Cache-Control', 'no-store');
              c.header('Vary', 'Cookie');
              return c.json({ user: c.get('session').user });
            })
          `,
        },
        // No requireSession() — rule does not apply
        {
          code: `
            app.get('/public', async (c) => {
              return c.json({ ok: true });
            })
          `,
        },
        // Non-HTTP method (e.g. app.use) — rule does not apply
        {
          code: `
            app.use('/auth/*', requireSession())
          `,
        },
      ],
      invalid: [
        // Authenticated route WITHOUT Cache-Control — violation
        {
          code: `
            app.get('/auth/me', requireSession(), async (c) => {
              return c.json({ user: c.get('session').user });
            })
          `,
          errors: [{ messageId: 'missingCacheControl' }],
        },
        // POST route with requireSession but no cache header
        {
          code: `
            app.post('/settings', requireSession(), async (c) => {
              return c.json({ saved: true });
            })
          `,
          errors: [{ messageId: 'missingCacheControl' }],
        },
        // Has Cache-Control but wrong value (not 'no-store')
        {
          code: `
            app.get('/profile', requireSession(), async (c) => {
              c.header('Cache-Control', 'max-age=60');
              return c.json({ user: c.get('session').user });
            })
          `,
          errors: [{ messageId: 'missingCacheControl' }],
        },
      ],
    });
  });
});
