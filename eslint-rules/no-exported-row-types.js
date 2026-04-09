/**
 * Rule: no-exported-row-types
 *
 * Flags exported type aliases or interfaces in repository files whose names
 * contain "Row", "$inferSelect", or "$inferInsert". Row types are internal
 * to the persistence boundary and must not leak to callers.
 *
 * @type {import('eslint').Rule.RuleModule}
 */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow exporting Drizzle row types from repository files.',
    },
    messages: {
      noExportedRowType:
        'Exported row type "{{name}}" leaks Drizzle internals. FIX: Remove the export keyword. Row types ($inferSelect, $inferInsert, *Row) must stay internal to the repository file. If callers need this shape, define a domain type in src/db/repositories/types.ts instead.',
    },
    schema: [],
  },
  create(context) {
    const bannedPatterns = [/Row$/i, /\$inferSelect/, /\$inferInsert/];

    function checkName(name, node) {
      for (const pattern of bannedPatterns) {
        if (pattern.test(name)) {
          context.report({
            node,
            messageId: 'noExportedRowType',
            data: { name },
          });
        }
      }
    }

    return {
      // export type FooRow = ...
      ExportNamedDeclaration(node) {
        if (!node.declaration) return;

        if (node.declaration.type === 'TSTypeAliasDeclaration' && node.declaration.id) {
          checkName(node.declaration.id.name, node.declaration.id);
        }

        if (node.declaration.type === 'TSInterfaceDeclaration' && node.declaration.id) {
          checkName(node.declaration.id.name, node.declaration.id);
        }
      },
    };
  },
};
