const js = require("@eslint/js");
const globals = require("globals");

const rules = {
  ...js.configs.recommended.rules,
  eqeqeq: ["error", "always"],
  // Input validators deliberately match and reject control characters.
  "no-control-regex": "off",
  "no-unused-vars": [
    "error",
    { argsIgnorePattern: "^_", caughtErrors: "none" },
  ],
};

module.exports = [
  {
    // Remaining historical root generators (generate-o-*.js) are not maintained.
    ignores: [
      "*.js",
      "!server.js",
      "!eslint.config.js",
      ".deployment/**",
      "data/**",
    ],
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    rules,
  },
  {
    // UMD scripts load in the browser and under Node tests.
    files: ["shared/**/*.js", "examples/**/*.js"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    // The admin UI is native ES modules (admin-ui/package.json "type").
    files: ["admin-ui/**/*.js"],
    languageOptions: {
      sourceType: "module",
      globals: { ...globals.browser },
    },
  },
];
