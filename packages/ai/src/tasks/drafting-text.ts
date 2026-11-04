/**
 * Small text helpers shared by the drafting tasks' mocks and the fact check.
 * Deterministic and dependency-free.
 */

/** A profile fact as the drafting prompts see it. Mirrors ProfileFact in @pathfinder/core. */
export interface PromptFact {
  id: string;
  kind: string;
  text: string;
  parentId?: string;
}

const STOPWORDS = new Set(
  (
    "a an the and or but nor of for to in on at by with from into onto over under as is are was were be been being " +
    "it its this that these those i me my we our you your he she they them their his her which who whom whose " +
    "do does did done have has had having can could will would shall should may might must also too very just " +
    "so such than then there here about after before during while up down out off again further once more most " +
    "some any each other only own same not no all both few per via using use used"
  ).split(" "),
);

/** Words that join facts into sentences without adding any claim. Ignored by the support check. */
const GLUE = new Set(
  (
    "interested interest role job position opportunity fit fits fitting match matches matching background " +
    "because since want would like keen looking apply applying team company work working worked experience " +
    "skill skills project projects relevant relates related include includes including also hands learn " +
    "learned learning enjoy enjoyed good strong well able helped help"
  ).split(" "),
);

/** Crude stemmer: enough to match "tests"/"tested"/"testing" to "test". */
export function stem(word: string): string {
  let w = word;
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("es") && /(ch|sh|x|ss)es$/.test(w)) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  return w;
}

export function words(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9+#.]+(?:'[a-z]+)?/g)?.map((w) => w.replace(/\.+$/, "")).filter(Boolean) ?? [];
}

/** Content words of a sentence (no stopwords, no glue words), stemmed. */
export function contentWords(text: string): string[] {
  return words(text)
    .filter((w) => !STOPWORDS.has(w) && !GLUE.has(w) && !/^\d+$/.test(w))
    .map(stem);
}

/** Share of the item's content words that appear in the facts (1 when it has none). */
export function supportRatio(itemText: string, factTexts: string[]): number {
  const item = contentWords(itemText);
  if (item.length === 0) return 1;
  const known = new Set(factTexts.flatMap(contentWords));
  return item.filter((w) => known.has(w)).length / item.length;
}

/** "wrote 120 test cases." → "Wrote 120 test cases" */
export function tidyBullet(text: string): string {
  const t = text.trim().replace(/\s+/g, " ").replace(/[.;,\s]+$/, "");
  return t.charAt(0).toUpperCase() + t.slice(1);
}
