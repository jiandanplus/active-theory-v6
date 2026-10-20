module.exports = [
  {
    files: [
      "scripts/docker-local.js",
      "scripts/test-postgres.js",
      "scripts/test-authorized-runtime.js",
      "tests/cd-docker.test.js",
      "shared/content-contract.js",
      "admin-ui/modules/*.js",
    ],
    ignores: [],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "commonjs",
      globals: {
        process: "readonly",
        console: "readonly",
        __dirname: "readonly",
        URL: "readonly",
      },
    },
    rules: {
      "no-constant-condition": "error",
      "no-unreachable": "error",
      "valid-typeof": "error",
      eqeqeq: ["error", "always"],
    },
  },
];
