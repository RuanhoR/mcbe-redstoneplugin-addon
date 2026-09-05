// @ts-check
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import mcx from "@mbler/eslint-plugin-mcx";

export default [
  {
    ignores: ["dist/**", "node_modules/**", "dist.mcaddon"],
  },
  {
    files: ["behavior/scripts/**/*.ts", "tests/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      ecmaVersion: "latest",
      sourceType: "module",
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "prefer-const": "error",
      "no-undef": "off",
      "no-unused-vars": "off",
      "no-empty": "off",
    },
  },
  // lint .mcx files (template + embedded <script>)
  mcx.configs.recommended,
];
