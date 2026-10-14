/* Variant A core (placeholder: behaves like the timing core until implemented). */
import { createTimingCore } from '../../play/timing-core.ts';
import type { CoreHost, Core } from '../../play/core.ts';

export function createSpatialCore(host: CoreHost): Core {
  return createTimingCore(host);
}
