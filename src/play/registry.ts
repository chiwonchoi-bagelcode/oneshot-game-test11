/* Core factories by kind. Every build includes all cores; the variant picks one. */
import type { CoreFactory } from './core.ts';
import type { CoreKind } from '../variants/index.ts';
import { createTimingCore } from './timing-core.ts';
import { createSpatialCore } from '../variants/a/core.ts';
import { createPathCore } from '../variants/b/core.ts';
import { createPaintCore } from '../variants/c/core.ts';

export const CORES: Record<CoreKind, CoreFactory> = {
  timing: createTimingCore,
  spatial: createSpatialCore,
  path: createPathCore,
  paint: createPaintCore,
};
