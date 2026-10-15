// Core e — placeholder until the core is implemented (falls back to the timing core).
import { TimingCore } from '../../play/timing-core.ts';
import type { Core, CoreHost } from '../../play/core.ts';
export function createCore(host: CoreHost): Core {
  return new TimingCore(host);
}
