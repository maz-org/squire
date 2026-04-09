/**
 * Wire ESLint's RuleTester into vitest so each RuleTester.run() call
 * produces proper vitest describe/it blocks without manual wrapping.
 */
import { describe, it, afterAll } from 'vitest';
import { RuleTester } from 'eslint';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;
RuleTester.afterAll = afterAll;
