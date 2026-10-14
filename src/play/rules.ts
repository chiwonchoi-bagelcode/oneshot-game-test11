/* Rule-card diagrams: the variant's own diagrams first, then the shared ones. */
import { ruleDiagram } from '../ui/rule-diagrams.ts';
import { VARIANT_ID } from '../variants/index.ts';
import { diagram as diagramA } from '../variants/a/rules.ts';
import { diagram as diagramB } from '../variants/b/rules.ts';
import { diagram as diagramC } from '../variants/c/rules.ts';
import { diagram as diagramD } from '../variants/d/rules.ts';
import { diagram as diagramE } from '../variants/e/rules.ts';

const BY_VARIANT: Record<string, (key: string) => HTMLElement | null> = { a: diagramA, b: diagramB, c: diagramC, d: diagramD, e: diagramE };

export function ruleDiagramFor(key: string): HTMLElement {
  const own = BY_VARIANT[VARIANT_ID]?.(key);
  return own || ruleDiagram(key as any);
}
