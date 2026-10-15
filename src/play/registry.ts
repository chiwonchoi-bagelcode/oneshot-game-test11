/* Picks the rules core for this build (see src/variant.ts). */
import { CORE } from '../variant.ts';
import { TimingCore } from './timing-core.ts';
import type { Core, CoreHost } from './core.ts';
import { createCore as coreA } from '../cores/a/core.ts';
import { createCore as coreB } from '../cores/b/core.ts';
import { createCore as coreC } from '../cores/c/core.ts';
import { createCore as coreD } from '../cores/d/core.ts';
import { createCore as coreE } from '../cores/e/core.ts';

export function createCore(host: CoreHost): Core {
  switch (CORE) {
    case 'a': return coreA(host);
    case 'b': return coreB(host);
    case 'c': return coreC(host);
    case 'd': return coreD(host);
    case 'e': return coreE(host);
    default: return new TimingCore(host);
  }
}
