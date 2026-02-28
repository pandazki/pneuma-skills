/**
 * Test mode manifest — used by mode-resolver integration tests.
 */
const testManifest = {
  name: "test-mode",
  version: "0.1.0",
  displayName: "Test Mode",
  description: "A minimal mode for testing",
  skill: {
    sourceDir: "skill",
    installName: "pneuma-test",
    claudeMdSection: "## Test Mode",
  },
  viewer: {
    watchPatterns: ["**/*.txt"],
    ignorePatterns: ["node_modules/**"],
  },
};

export default testManifest;
