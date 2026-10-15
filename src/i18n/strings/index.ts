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

import { CORE, IS_VARIANT } from '../../variant.ts';
import coreA from '../../cores/a/strings.ts';
import coreB from '../../cores/b/strings.ts';
import coreC from '../../cores/c/strings.ts';
import coreD from '../../cores/d/strings.ts';
import coreE from '../../cores/e/strings.ts';

type Dict = Record<string, string>;
/** Comparison builds end after one chapter: the closing lines say so. */
const variantCommon = {
  ko: {
    'story.epilogue': '새벽 연못 그림을 모두 되살렸어요. 오늘의 그림은 매일 새로 찾아와요.',
    'journey.allDone': '그림 완성',
  } as Dict,
  en: {
    'story.epilogue': 'The Dawn Pond painting is fully restored. New daily pictures arrive every day.',
    'journey.allDone': 'Painting complete',
  } as Dict,
};
const CORE_STRINGS: Record<string, { ko: Dict; en: Dict }> = { a: coreA, b: coreB, c: coreC, d: coreD, e: coreE };
const parts: { ko: Dict; en: Dict }[] = [common, play, story, shop, daily, gallery, settings];
if (IS_VARIANT) parts.push(variantCommon, CORE_STRINGS[CORE]);

export const STRINGS: { ko: Dict; en: Dict } = { ko: {}, en: {} };
for (const p of parts) {
  Object.assign(STRINGS.ko, p.ko);
  Object.assign(STRINGS.en, p.en);
}
