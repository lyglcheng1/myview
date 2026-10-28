// @vitest-environment node
// The playground's Pine editor runs scripts through @luxalgo/vela-pinets (Pine v5).
// This guards the bundled hunter strategy: it must keep transpiling after the v6→v5
// conversion, and its declared inputs must surface on the prepared script.
import { describe, it, expect } from 'vitest';
import { PineEngine } from '@luxalgo/vela-pinets';
import hunterSource from '../pine.script?raw';

describe('Pine v5 engine (vela-pinets)', () => {
    it('transpiles the bundled hunter strategy after its v6→v5 conversion', async () => {
        expect(hunterSource.startsWith('//@version=5')).toBe(true);

        const prepared = await new PineEngine().prepare(hunterSource, 'pine-test-hunter');
        expect(prepared.language).toBe('pine');
        expect(prepared.inputs.some((i) => i.key === 'moveBar')).toBe(true);
        expect(prepared.meta).toBeTruthy();
    }, 30000);
});