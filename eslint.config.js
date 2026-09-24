// loupe workspace lint (scaffold-frozen; amendments are integration-owner-only).
// Notable: the no-raw-hex rule under packages/catalog/src/react — components must
// style exclusively through @loupe/tokens (--lp-* custom properties). A raw hex
// color literal anywhere in catalog react code fails the build.
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      'apps/host/dist-ui/**',
      '**/node_modules/**',
      'schema/**',
      '**/*.css',
      '**/__screenshots__/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Design-language enforcement: catalog react impls reference tokens only.
    files: ['packages/catalog/src/react/**/*.ts', 'packages/catalog/src/react/**/*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/#[0-9a-fA-F]{3,8}([^0-9a-zA-Z]|$)/]',
          message: 'Raw hex colors are forbidden in catalog components — use @loupe/tokens (--lp-* vars).',
        },
        {
          selector: 'TemplateElement[value.raw=/#[0-9a-fA-F]{3,8}([^0-9a-zA-Z]|$)/]',
          message: 'Raw hex colors are forbidden in catalog components — use @loupe/tokens (--lp-* vars).',
        },
      ],
    },
  },
);
