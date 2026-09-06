import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDiffStats, STALE_CHANGE_THRESHOLD } from '../dist/invalidation.js';

test('parseDiffStats correctly calculates added and removed lines from git diff', () => {
  const diffOutput = `
diff --git a/src/db.ts b/src/db.ts
index 123..456 100644
--- a/src/db.ts
+++ b/src/db.ts
@@ -1,5 +1,6 @@
 import Database from 'better-sqlite3';
+import { readFileSync } from 'fs';
-const oldConst = 1;
+const newConst = 2;
+const thirdLine = 3;
`;
  const { added, removed } = parseDiffStats(diffOutput);
  assert.equal(added, 3);
  assert.equal(removed, 1);
});

test('STALE_CHANGE_THRESHOLD is configured to 30%', () => {
  assert.equal(STALE_CHANGE_THRESHOLD, 0.30);
});
