/*
 * Merges every feature dictionary. To add a dictionary: create strings/<feature>.ts exporting
 * `default { ko: {...}, en: {...} }` and add it to the list below.
 */
import common from './common.ts';
import play from './play.ts';
import story from './story.ts';
import shop from './shop.ts';
import daily from './daily.ts';
import gallery from './gallery.ts';
import settings from './settings.ts';

import { VARIANT_ID } from '../../variants/index.ts';
import va from '../../variants/a/strings.ts';
import vb from '../../variants/b/strings.ts';
import vc from '../../variants/c/strings.ts';
import vd from '../../variants/d/strings.ts';
import ve from '../../variants/e/strings.ts';
import variantCommon from './variant-common.ts';

type Dict = Record<string, string>;
const parts: { ko: Dict; en: Dict }[] = [common, play, story, shop, daily, gallery, settings];

export const STRINGS: { ko: Dict; en: Dict } = { ko: {}, en: {} };
for (const p of parts) {
  Object.assign(STRINGS.ko, p.ko);
  Object.assign(STRINGS.en, p.en);
}

// Test versions: shared overrides, then the version's own strings.
if (VARIANT_ID !== 'orig') {
  const own = ({ a: va, b: vb, c: vc, d: vd, e: ve } as Record<string, { ko: Dict; en: Dict }>)[VARIANT_ID];
  for (const p of [variantCommon, own]) {
    Object.assign(STRINGS.ko, p.ko);
    Object.assign(STRINGS.en, p.en);
  }
}
