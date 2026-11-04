import {
  canonicalSkill,
  factVerifyTask,
  findSkillsInText,
  isKnownSkill,
  type AiClient,
  type AiRecorder,
  type AnswersDraftOutput,
  type ResumeTailorOutput,
} from "@pathfinder/ai";
import type { ProfileFact } from "./types";

/**
 * The no-invented-experience guard. Code checks run first and are deterministic; the model is
 * only asked (fact.verify) about items that already pass them. Anything that fails is removed and
 * reported, never silently kept.
 */

export interface CheckResult {
  ok: boolean;
  reason: string;
}

export interface RemovedItem {
  text: string;
  reason: string;
}

export interface FactCheckDeps {
  ai: AiClient;
  recorder?: AiRecorder;
}

const SHARED_KINDS = new Set<ProfileFact["kind"]>(["skill", "summary", "headline"]);

/** Numbers as written, normalised: "2,000" → "2000", "3.50" → "3.5". */
function numbersIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.match(/\d+(?:[.,]\d+)*/g) ?? []) {
    let n = raw.replace(/,/g, "");
    if (n.includes(".")) n = n.replace(/0+$/, "").replace(/\.$/, "");
    out.add(n);
  }
  return out;
}

/** Known skills a sentence names: dictionary matches plus capitalised tokens the dictionary knows. */
function skillsIn(text: string): Set<string> {
  const found = new Set(findSkillsInText(text).map((s) => s.toLowerCase()));
  for (const token of text.match(/\b[A-Z][A-Za-z0-9+#.]{1,}/g) ?? []) {
    const clean = token.replace(/\.+$/, "");
    if (isKnownSkill(clean)) found.add(canonicalSkill(clean).toLowerCase());
  }
  return found;
}

export interface CodeCheckOptions {
  /** The item this text belongs to ("exp:0", "proj:1"), or "any" for summaries and answers. */
  allowedParents: string[] | "any";
}

/**
 * Deterministic checks for one drafted sentence against the facts it cites:
 * it must cite at least one fact; every cited id must exist; ids must belong to the same item
 * (or be skills/summary/headline); every number must appear in the cited facts; every known skill
 * it names must appear in the cited facts or somewhere in the profile.
 */
export function codeCheckBullet(text: string, factIds: string[], facts: ProfileFact[], opts: CodeCheckOptions): CheckResult {
  if (!text.trim()) return { ok: false, reason: "Empty text." };
  if (factIds.length === 0) return { ok: false, reason: "Doesn't cite anything from your profile." };
  const byId = new Map(facts.map((f) => [f.id, f]));
  const cited: ProfileFact[] = [];
  for (const id of factIds) {
    const fact = byId.get(id);
    if (!fact) return { ok: false, reason: "Cites something that isn't in your profile." };
    cited.push(fact);
  }
  if (opts.allowedParents !== "any") {
    const allowed = new Set(opts.allowedParents);
    for (const fact of cited) {
      if (!SHARED_KINDS.has(fact.kind) && !allowed.has(fact.id) && !(fact.parentId && allowed.has(fact.parentId))) {
        return { ok: false, reason: "Mixes in details from a different experience or project." };
      }
    }
  }

  const citedText = cited.map((f) => f.text).join("\n");
  const citedNumbers = numbersIn(citedText);
  for (const n of numbersIn(text)) {
    if (!citedNumbers.has(n)) return { ok: false, reason: `Mentions "${n}", which your profile doesn't say.` };
  }

  const citedSkills = skillsIn(citedText);
  const profileSkills = skillsIn(facts.map((f) => f.text).join("\n"));
  for (const skill of skillsIn(text)) {
    if (!citedSkills.has(skill) && !profileSkills.has(skill)) {
      return { ok: false, reason: `Mentions ${canonicalSkill(skill)}, which isn't in your profile.` };
    }
  }
  return { ok: true, reason: "" };
}

interface Candidate {
  key: string;
  text: string;
  factIds: string[];
}

/** Asks the model whether each candidate is supported by its cited facts. Unanswered items fail closed. */
async function verify(
  deps: FactCheckDeps,
  candidates: Candidate[],
  facts: ProfileFact[],
  extraContext: Array<{ id: string; text: string }> = [],
): Promise<Map<string, CheckResult>> {
  const out = new Map<string, CheckResult>();
  if (candidates.length === 0) return out;
  const byId = new Map(facts.map((f) => [f.id, f]));
  const result = await deps.ai.run(
    factVerifyTask,
    {
      items: candidates.map((c) => ({
        id: c.key,
        text: c.text,
        facts: [...c.factIds.map((id) => ({ id, text: byId.get(id)?.text ?? "" })), ...extraContext],
      })),
    },
    { recorder: deps.recorder },
  );
  const answers = new Map(result.results.map((r) => [r.id, r]));
  for (const c of candidates) {
    const r = answers.get(c.key);
    out.set(
      c.key,
      r?.supported
        ? { ok: true, reason: "" }
        : { ok: false, reason: r?.reason?.trim() || "Couldn't be confirmed from your profile." },
    );
  }
  return out;
}

export interface CheckedResume {
  /** null when the drafted headline/summary failed (the caller falls back to the profile's own). */
  headline: string | null;
  summary: { text: string; factIds: string[] } | null;
  skills: string[];
  experiences: Array<{ sourceId: string; bullets: Array<{ text: string; factIds: string[] }> }>;
  projects: Array<{ sourceId: string; bullets: Array<{ text: string; factIds: string[] }> }>;
  removed: RemovedItem[];
  /** Removed bullets, headline or summary (skill-list trims don't count). Drives the one regeneration. */
  removedContent: number;
  passed: number;
}

export async function factCheckResume(deps: FactCheckDeps, draft: ResumeTailorOutput, facts: ProfileFact[]): Promise<CheckedResume> {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const removed: RemovedItem[] = [];
  const candidates: Candidate[] = [];
  let removedContent = 0;
  const fail = (text: string, reason: string, counts = true) => {
    removed.push({ text, reason });
    if (counts) removedContent++;
  };

  // Headline: implicitly based on the headline and summary facts.
  const headlineIds = ["headline", "summary"].filter((id) => byId.has(id));
  if (draft.headline.trim()) {
    const r = codeCheckBullet(draft.headline, headlineIds, facts, { allowedParents: "any" });
    if (r.ok) candidates.push({ key: "headline", text: draft.headline.trim(), factIds: headlineIds });
    else fail(draft.headline, r.reason);
  }
  if (draft.summary.text.trim()) {
    const r = codeCheckBullet(draft.summary.text, draft.summary.factIds, facts, { allowedParents: "any" });
    if (r.ok) candidates.push({ key: "summary", text: draft.summary.text.trim(), factIds: draft.summary.factIds });
    else fail(draft.summary.text, r.reason);
  }

  const sections = (["experiences", "projects"] as const).map((section) => {
    const kind = section === "experiences" ? "experience" : "project";
    const seen = new Set<string>();
    const items: CheckedResume["experiences"] = [];
    for (const item of draft[section]) {
      const source = byId.get(item.sourceId);
      if (!source || source.kind !== kind || seen.has(item.sourceId)) {
        for (const b of item.bullets) fail(b.text, `Not one of your profile's ${section}.`);
        continue;
      }
      seen.add(item.sourceId);
      items.push({ sourceId: item.sourceId, bullets: [] });
      item.bullets.forEach((b, k) => {
        const r = codeCheckBullet(b.text, b.factIds, facts, { allowedParents: [item.sourceId] });
        if (r.ok) candidates.push({ key: `${section}|${item.sourceId}|${k}`, text: b.text.trim(), factIds: [...new Set(b.factIds)] });
        else fail(b.text, r.reason);
      });
    }
    return { section, items };
  });

  // Skills: only names from the profile's own skill list.
  const profileSkills = new Map(
    facts.filter((f) => f.kind === "skill").map((f) => [canonicalSkill(f.text).toLowerCase(), f.text]),
  );
  const skills: string[] = [];
  for (const name of draft.skills) {
    const own = profileSkills.get(canonicalSkill(name).toLowerCase());
    if (own) {
      if (!skills.includes(own)) skills.push(own);
    } else {
      fail(name, "Not in your profile's skills.", false);
    }
  }

  const verdicts = await verify(deps, candidates, facts);
  const accepted = (key: string, text: string) => {
    const v = verdicts.get(key);
    if (v?.ok) return true;
    fail(text, v?.reason ?? "Couldn't be confirmed from your profile.");
    return false;
  };

  const headline = candidates.find((c) => c.key === "headline");
  const summary = candidates.find((c) => c.key === "summary");
  const result: CheckedResume = {
    headline: headline && accepted("headline", headline.text) ? headline.text : null,
    summary: summary && accepted("summary", summary.text) ? { text: summary.text, factIds: summary.factIds } : null,
    skills,
    experiences: [],
    projects: [],
    removed,
    removedContent: 0,
    passed: 0,
  };
  for (const { section, items } of sections) {
    for (const item of items) {
      for (const c of candidates.filter((x) => x.key.startsWith(`${section}|${item.sourceId}|`))) {
        if (accepted(c.key, c.text)) item.bullets.push({ text: c.text, factIds: c.factIds });
      }
    }
    result[section] = items;
  }
  result.removedContent = removedContent;
  result.passed = candidates.filter((c) => verdicts.get(c.key)?.ok).length;
  return result;
}

export interface CheckedAnswer {
  question: string;
  answer: string;
  factIds: string[];
  needsInput: boolean;
  note: string;
}

const REMOVED_NOTE = "We removed our draft because your profile doesn't support it. Please write this answer yourself.";

/**
 * Same rules for application answers. One answer per question, in order; an answer that fails
 * becomes "needs your input" (answer emptied) instead of being kept.
 */
export async function factCheckAnswers(
  deps: FactCheckDeps,
  draft: AnswersDraftOutput,
  facts: ProfileFact[],
  questions: string[],
  job: { title: string; company: string },
): Promise<{ answers: CheckedAnswer[]; removed: RemovedItem[]; passed: number }> {
  const norm = (s: string) => s.trim().toLowerCase();
  const removed: RemovedItem[] = [];
  const answers: CheckedAnswer[] = questions.map((question, i) => {
    const d = draft.answers.find((a) => norm(a.question) === norm(question)) ?? draft.answers[i];
    if (!d || d.needsInput || !d.answer.trim()) {
      return {
        question,
        answer: "",
        factIds: [],
        needsInput: true,
        note: d?.note?.trim() || "Write this answer yourself; we couldn't draft it from your profile.",
      };
    }
    return { question, answer: d.answer.trim(), factIds: [...new Set(d.factIds)], needsInput: false, note: d.note ?? "" };
  });

  const candidates: Candidate[] = [];
  answers.forEach((a, i) => {
    if (a.needsInput) return;
    const r = codeCheckBullet(a.answer, a.factIds, facts, { allowedParents: "any" });
    if (r.ok) candidates.push({ key: `answer|${i}`, text: a.answer, factIds: a.factIds });
    else {
      removed.push({ text: a.answer, reason: r.reason });
      answers[i] = { ...a, answer: "", factIds: [], needsInput: true, note: REMOVED_NOTE };
    }
  });

  const verdicts = await verify(deps, candidates, facts, [{ id: "job", text: `${job.title} ${job.company}` }]);
  for (const c of candidates) {
    const v = verdicts.get(c.key);
    if (v?.ok) continue;
    const i = Number(c.key.split("|")[1]);
    removed.push({ text: c.text, reason: v?.reason ?? "Couldn't be confirmed from your profile." });
    answers[i] = { ...answers[i]!, answer: "", factIds: [], needsInput: true, note: REMOVED_NOTE };
  }
  return { answers, removed, passed: candidates.filter((c) => verdicts.get(c.key)?.ok).length };
}
