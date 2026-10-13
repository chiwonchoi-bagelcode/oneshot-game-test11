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

type Dict = Record<string, string>;
const parts: { ko: Dict; en: Dict }[] = [common, play, story, shop, daily, gallery, settings];

export const STRINGS: { ko: Dict; en: Dict } = { ko: {}, en: {} };
for (const p of parts) {
  Object.assign(STRINGS.ko, p.ko);
  Object.assign(STRINGS.en, p.en);
}
