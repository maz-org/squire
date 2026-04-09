import { RuleTester } from 'eslint';
import rule from '../../eslint-rules/no-exported-row-types.js';

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
});

ruleTester.run('no-exported-row-types', rule, {
  valid: [
    // Normal export — no banned pattern in name
    { code: 'export const userService = {}' },
    // Re-export of a non-Row type
    { code: "export { User } from './types.ts'" },
    // Internal (non-exported) usage is fine
    { code: "const SessionRow = 'internal'" },
  ],
  invalid: [
    // Re-export specifier with Row suffix
    {
      code: "export { SessionRow } from './session-repository.ts'",
      errors: [{ messageId: 'noExportedRowType', data: { name: 'SessionRow' } }],
    },
    // Re-export specifier with $inferSelect
    {
      code: "export { $inferSelect } from './schema.ts'",
      errors: [{ messageId: 'noExportedRowType', data: { name: '$inferSelect' } }],
    },
    // Re-export specifier with $inferInsert
    {
      code: "export { $inferInsert } from './schema.ts'",
      errors: [{ messageId: 'noExportedRowType', data: { name: '$inferInsert' } }],
    },
  ],
});
