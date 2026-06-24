// @ts-check
import eslint from "@eslint/js";
import json from "@eslint/json";
import prettierConfig from "eslint-config-prettier";
import importPlugin from "eslint-plugin-import";
import perfectionistPlugin from "eslint-plugin-perfectionist";
import prettierPlugin from "eslint-plugin-prettier";
import tseslint from "typescript-eslint";

/**
 * Shared ESLint flat config, mirroring nextgen/packages/sdk-* exactly.
 *
 * Each package re-exports this so a single edit propagates everywhere
 * and the spike stays a faithful Zitadel-style monorepo.
 */
export default tseslint.config(
  { ignores: ["dist/**", ".snapshots/**", "public/**", "node_modules/**", "snapshot-manifest.ts"] },
  {
    ...eslint.configs.recommended,
    files: ["**/*.{ts,js,mjs,cjs}"],
  },
  tseslint.configs.recommended,
  importPlugin.flatConfigs.recommended,
  importPlugin.flatConfigs.typescript,
  {
    files: ["**/*.{ts,js,mjs,cjs}"],
    plugins: {
      perfectionist: perfectionistPlugin,
      prettier: prettierPlugin,
    },
    settings: {
      "import/resolver": {
        typescript: { alwaysTryTypes: true },
        node: true,
      },
    },
    rules: {
      "import/no-named-as-default-member": "off",
      "import/no-unresolved": "off",
      "import/order": "off",
      "perfectionist/sort-imports": ["error", { type: "natural" }],
      "prettier/prettier": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["**/*.{test,spec}.ts", "**/__tests__/**/*.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  prettierConfig,
  {
    files: ["**/*.json"],
    ignores: ["**/tsconfig*.json"],
    language: "json/json",
    ...json.configs.recommended,
  },
  {
    files: ["**/tsconfig*.json"],
    language: "json/jsonc",
    ...json.configs.recommended,
  },
);
