import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(path.join(projectRoot, 'dist'), { recursive: true });
copyFileSync(
  path.join(projectRoot, 'src', 'schema.sql'),
  path.join(projectRoot, 'dist', 'schema.sql'),
);
