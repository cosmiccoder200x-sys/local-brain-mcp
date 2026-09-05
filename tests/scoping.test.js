import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeFilePath,
  derivePackageScope,
  buildScopeFilter,
  toRelativePath,
} from '../dist/scoping.js';

test('sanitizeFilePath removes path traversals and dangerous characters', () => {
  assert.equal(sanitizeFilePath('../../../etc/passwd'), 'etc/passwd');
  assert.equal(sanitizeFilePath('..\\..\\windows\\system32'), 'windows/system32');
  assert.equal(sanitizeFilePath('src/../../auth/jwt.ts'), 'auth/jwt.ts');
  assert.equal(sanitizeFilePath('src/\x00/evil.ts'), 'src/evil.ts');
  assert.equal(sanitizeFilePath('C:\\Users\\test\\project\\src\\index.ts'), 'Users/test/project/src/index.ts');
  assert.equal(sanitizeFilePath(null), null);
  assert.equal(sanitizeFilePath(''), null);
});

test('derivePackageScope extracts monorepo package roots', () => {
  assert.equal(derivePackageScope('packages/auth/src/jwt.ts'), 'packages/auth');
  assert.equal(derivePackageScope('apps/dashboard/src/index.tsx'), 'apps/dashboard');
  assert.equal(derivePackageScope('services/payment/handler.go'), 'services/payment');
  assert.equal(derivePackageScope('src/components/button.tsx'), null);
  assert.equal(derivePackageScope(null), null);
});

test('buildScopeFilter generates parameterized SQL filter safely', () => {
  const emptyFilter = buildScopeFilter(null);
  assert.equal(emptyFilter.sql, '');
  assert.deepEqual(emptyFilter.params, []);

  const authFilter = buildScopeFilter('packages/auth');
  assert.ok(authFilter.sql.includes('package_scope = ?'));
  assert.deepEqual(authFilter.params, ['packages/auth', 'packages/auth/%']);
});

test('toRelativePath returns normalized relative paths', () => {
  const root = '/home/user/project';
  const target = '/home/user/project/src/db/client.ts';
  assert.equal(toRelativePath(target, root), 'src/db/client.ts');
});
