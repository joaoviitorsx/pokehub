import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'dist-electron', 'release', 'node_modules', 'graphify-out'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  reactHooks.configs.flat.recommended,
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  { files: ['spike/remote-ui/public/sw.js'], languageOptions: { globals: globals.serviceworker } },
  {
    // node:sqlite é carregado via require para não ser empacotado pelo Vite/Vitest; mocks de teste usam alias de this.
    files: ['spike/electron/database.ts', 'spike/tests/**'],
    rules: { '@typescript-eslint/no-require-imports': 'off', '@typescript-eslint/no-this-alias': 'off' },
  },
);
