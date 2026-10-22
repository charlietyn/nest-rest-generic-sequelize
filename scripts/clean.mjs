import { rmSync } from 'node:fs';
// A fixed directory relative to this script, never supplied by CLI input.
rmSync(new URL('../dist/', import.meta.url), { recursive: true, force: true });
