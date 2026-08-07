import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Company assignment source material, not project code:
    "support.js",
    "*.dc.html",
  ]),
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['mongodb', 'next', 'next/*', 'next-auth', 'next-auth/*', 'node:fs', 'node:fs/*'],
            message: 'src/domain must stay pure: no I/O, no framework imports.' },
        ],
      }],
    },
  },
  {
    // Vitest helpers named useX() (e.g. useTestDb) are not React hooks and are
    // called at describe-body top level, which the react-hooks plugin
    // otherwise flags based on the "use" naming convention alone.
    files: ['tests/**/*.ts'],
    rules: {
      'react-hooks/rules-of-hooks': 'off',
    },
  },
]);

export default eslintConfig;
