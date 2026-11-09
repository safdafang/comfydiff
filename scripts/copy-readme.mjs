import { copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const f of ['README.md', 'LICENSE']) copyFileSync(join(root, f), join(root, 'packages', 'cli', f));
