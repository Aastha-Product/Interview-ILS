"use client";

import {
  profileInputSchema,
  type EducationInput,
  type ExperienceInput,
  type LinkInput,
  type ProfileInput,
  type ProfileView,
  type ProjectInput,
  type SkillInput,
} from "@pathfinder/core/profile";
import { ArrowDown, ArrowUp, Plus, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { StrengthMeter } from "@/components/strength-meter";
import { Button } from "@/components/ui/button";
import { Alert, Card, CardHeader } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { api, ApiRequestError } from "@/lib/api";

type Keyed<T> = T & { _key: string };
type ListName = "links" | "experiences" | "projects" | "education" | "skills";
interface EditorState {
  headline: string;
  summary: string;
  location: string;
  phone: string;
  links: Keyed<LinkInput>[];
  experiences: Keyed<ExperienceInput>[];
  projects: Keyed<ProjectInput>[];
  education: Keyed<EducationInput>[];
  skills: Keyed<SkillInput>[];
}

const newKey = () => crypto.randomUUID();
const withKeys = <T,>(items: T[]) => items.map((item) => ({ ...item, _key: newKey() }));
const stripKey = <T extends { _key: string }>({ _key, ...rest }: T) => {
  void _key;
  return rest;
};

function toState(p: ProfileInput): EditorState {
  return {
    headline: p.headline,
    summary: p.summary,
    location: p.location,
    phone: p.phone,
    links: withKeys(p.links),
    experiences: withKeys(p.experiences),
    projects: withKeys(p.projects),
    education: withKeys(p.education),
    skills: withKeys(p.skills),
  };
}

const nonEmpty = (list: string[]) => list.map((s) => s.trim()).filter(Boolean);

/** Editor state → the shape the API accepts. Empty bullet lines and technology entries are dropped. */
function fromState(s: EditorState): ProfileInput {
  return {
    headline: s.headline,
    summary: s.summary,
    location: s.location,
    phone: s.phone,
    links: s.links.map(stripKey),
    experiences: s.experiences.map((e) => ({ ...stripKey(e), highlights: nonEmpty(e.highlights) })),
    projects: s.projects.map((p) => ({
      ...stripKey(p),
      highlights: nonEmpty(p.highlights),
      technologies: nonEmpty(p.technologies),
    })),
    education: s.education.map(stripKey),
    skills: s.skills.map(stripKey),
  };
}

const BLANK = {
  links: (): LinkInput => ({ label: "", url: "" }),
  experiences: (): ExperienceInput => ({ title: "", company: "", location: "", startDate: "", endDate: "", current: false, highlights: [] }),
  projects: (): ProjectInput => ({ name: "", role: "", url: "", startDate: "", endDate: "", technologies: [], highlights: [] }),
  education: (): EducationInput => ({ institution: "", degree: "", field: "", startDate: "", endDate: "", grade: "" }),
};

export interface ProfileEditorProps {
  initial: ProfileInput;
  initialVersion: number;
  /** "review" is the confirm-your-imported-resume step of onboarding. */
  mode?: "edit" | "review";
  saveLabel?: string;
  onSaved?: (profile: ProfileView) => void;
}

export function ProfileEditor({ initial, initialVersion, mode = "edit", saveLabel = "Save profile", onSaved }: ProfileEditorProps) {
  const [state, setState] = useState<EditorState>(() => toState(initial));
  const [version, setVersion] = useState(initialVersion);
  const [dirty, setDirty] = useState(mode === "review");
  const [saving, setSaving] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});

  const cleaned = useMemo(() => fromState(state), [state]);
  const validation = useMemo(() => profileInputSchema.safeParse(cleaned), [cleaned]);
  const clientErrors = useMemo(() => {
    const out: Record<string, string> = {};
    if (!validation.success) for (const issue of validation.error.issues) out[issue.path.join(".")] ??= issue.message;
    return out;
  }, [validation]);
  const errors = showErrors ? { ...serverErrors, ...clientErrors } : serverErrors;
  const errorFor = (path: string) =>
    errors[path] ?? Object.entries(errors).find(([p]) => p.startsWith(`${path}.`))?.[1];

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const update = (patch: Partial<EditorState>) => {
    setState((s) => ({ ...s, ...patch }));
    setDirty(true);
    setMessage(null);
  };
  const updateItem = <L extends ListName>(list: L, index: number, patch: Partial<EditorState[L][number]>) =>
    update({ [list]: state[list].map((item, i) => (i === index ? { ...item, ...patch } : item)) } as Partial<EditorState>);
  const addItem = (list: Exclude<ListName, "skills">) =>
    update({ [list]: [...state[list], { ...BLANK[list](), _key: newKey() }] } as Partial<EditorState>);
  const removeItem = (list: ListName, index: number) =>
    update({ [list]: state[list].filter((_, i) => i !== index) } as Partial<EditorState>);
  const moveItem = (list: ListName, index: number, delta: -1 | 1) => {
    const items = [...state[list]];
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    [items[index], items[target]] = [items[target]!, items[index]!];
    update({ [list]: items } as Partial<EditorState>);
  };

  async function save() {
    setShowErrors(true);
    setServerErrors({});
    if (!validation.success) {
      setMessage({ tone: "error", text: `Please fix ${Object.keys(clientErrors).length} highlighted field(s) before saving.` });
      return;
    }
    setSaving(true);
    try {
      const saved = await api<ProfileView>("/api/profile", {
        method: "PUT",
        body: JSON.stringify({ expectedVersion: version, profile: cleaned }),
      });
      setVersion(saved.version);
      setState(toState(saved));
      setDirty(false);
      setShowErrors(false);
      setMessage({ tone: "success", text: "Saved." });
      onSaved?.(saved);
    } catch (error) {
      const e = error instanceof ApiRequestError ? error : null;
      if (e?.fields.length) {
        setServerErrors(Object.fromEntries(e.fields.map((f) => [f.path.replace(/^profile\./, ""), f.message])));
      }
      setMessage({ tone: "error", text: e?.message ?? "Something went wrong. Please try again." });
    } finally {
      setSaving(false);
    }
  }

  const listControls = (list: ListName, index: number, count: number, name: string) => (
    <div className="flex gap-1">
      <Button variant="ghost" size="icon" aria-label={`Move ${name} up`} disabled={index === 0} onClick={() => moveItem(list, index, -1)}>
        <ArrowUp className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" aria-label={`Move ${name} down`} disabled={index === count - 1} onClick={() => moveItem(list, index, 1)}>
        <ArrowDown className="h-4 w-4" />
      </Button>
      <Button variant="danger" size="icon" aria-label={`Remove ${name}`} onClick={() => removeItem(list, index)}>
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
      <div className="flex flex-col gap-6">
        {mode === "review" && (
          <Alert tone="info">
            We read your resume and filled in the profile below. Check every section: fix anything we got wrong, and remove
            anything that isn&apos;t true. Pathfinder only ever uses what you confirm here.
          </Alert>
        )}

        <Card>
          <CardHeader title="Basics" description="How you introduce yourself to employers." />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Headline" hint="For example: Final-year B.Tech CSE student, aiming for QA roles" error={errorFor("headline")} className="sm:col-span-2">
              {(p) => <Input {...p} value={state.headline} onChange={(e) => update({ headline: e.target.value })} />}
            </Field>
            <Field label="Summary" hint="Two or three lines on what you're looking for." error={errorFor("summary")} className="sm:col-span-2">
              {(p) => <Textarea {...p} rows={3} value={state.summary} onChange={(e) => update({ summary: e.target.value })} />}
            </Field>
            <Field label="City" error={errorFor("location")}>
              {(p) => <Input {...p} value={state.location} onChange={(e) => update({ location: e.target.value })} />}
            </Field>
            <Field label="Phone (optional)" error={errorFor("phone")}>
              {(p) => <Input {...p} type="tel" value={state.phone} onChange={(e) => update({ phone: e.target.value })} />}
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Education"
            action={<AddButton onClick={() => addItem("education")} label="Add education" />}
          />
          <ItemList empty="No education added yet.">
            {state.education.map((ed, i) => (
              <Item key={ed._key} title={ed.institution || `Education ${i + 1}`} controls={listControls("education", i, state.education.length, `education ${i + 1}`)}>
                <Field label="College or school" error={errorFor(`education.${i}.institution`)} className="sm:col-span-2">
                  {(p) => <Input {...p} value={ed.institution} onChange={(e) => updateItem("education", i, { institution: e.target.value })} />}
                </Field>
                <Field label="Degree" hint="For example: B.Tech" error={errorFor(`education.${i}.degree`)}>
                  {(p) => <Input {...p} value={ed.degree} onChange={(e) => updateItem("education", i, { degree: e.target.value })} />}
                </Field>
                <Field label="Subject" error={errorFor(`education.${i}.field`)}>
                  {(p) => <Input {...p} value={ed.field} onChange={(e) => updateItem("education", i, { field: e.target.value })} />}
                </Field>
                <Field label="Start" error={errorFor(`education.${i}.startDate`)}>
                  {(p) => <Input {...p} placeholder="2022" value={ed.startDate} onChange={(e) => updateItem("education", i, { startDate: e.target.value })} />}
                </Field>
                <Field label="End (or expected)" error={errorFor(`education.${i}.endDate`)}>
                  {(p) => <Input {...p} placeholder="2026" value={ed.endDate} onChange={(e) => updateItem("education", i, { endDate: e.target.value })} />}
                </Field>
                <Field label="CGPA or percentage" error={errorFor(`education.${i}.grade`)}>
                  {(p) => <Input {...p} value={ed.grade} onChange={(e) => updateItem("education", i, { grade: e.target.value })} />}
                </Field>
              </Item>
            ))}
          </ItemList>
        </Card>

        <Card>
          <CardHeader title="Skills" description="Languages, tools and frameworks you can actually use." />
          <SkillsInput
            skills={state.skills}
            error={errorFor("skills")}
            onChange={(skills) => update({ skills })}
          />
        </Card>

        <Card>
          <CardHeader
            title="Projects"
            description="College, personal and hackathon projects all count."
            action={<AddButton onClick={() => addItem("projects")} label="Add project" />}
          />
          <ItemList empty="No projects added yet.">
            {state.projects.map((pr, i) => (
              <Item key={pr._key} title={pr.name || `Project ${i + 1}`} controls={listControls("projects", i, state.projects.length, `project ${i + 1}`)}>
                <Field label="Project name" error={errorFor(`projects.${i}.name`)}>
                  {(p) => <Input {...p} value={pr.name} onChange={(e) => updateItem("projects", i, { name: e.target.value })} />}
                </Field>
                <Field label="Your role (optional)" error={errorFor(`projects.${i}.role`)}>
                  {(p) => <Input {...p} value={pr.role} onChange={(e) => updateItem("projects", i, { role: e.target.value })} />}
                </Field>
                <Field label="Technologies" hint="Separate with commas" error={errorFor(`projects.${i}.technologies`)} className="sm:col-span-2">
                  {(p) => (
                    <Input {...p} value={pr.technologies.join(",")} onChange={(e) => updateItem("projects", i, { technologies: e.target.value.split(",") })} />
                  )}
                </Field>
                <Field label="What you did" hint="One point per line: what you built and the result." error={errorFor(`projects.${i}.highlights`)} className="sm:col-span-2">
                  {(p) => (
                    <Textarea {...p} rows={4} value={pr.highlights.join("\n")} onChange={(e) => updateItem("projects", i, { highlights: e.target.value.split("\n") })} />
                  )}
                </Field>
                <Field label="Link (optional)" error={errorFor(`projects.${i}.url`)} className="sm:col-span-2">
                  {(p) => <Input {...p} type="url" placeholder="https://github.com/…" value={pr.url} onChange={(e) => updateItem("projects", i, { url: e.target.value })} />}
                </Field>
              </Item>
            ))}
          </ItemList>
        </Card>

        <Card>
          <CardHeader
            title="Internships and work"
            description="Leave this empty if you haven't had one yet."
            action={<AddButton onClick={() => addItem("experiences")} label="Add internship or job" />}
          />
          <ItemList empty="No internships or jobs added yet.">
            {state.experiences.map((ex, i) => (
              <Item key={ex._key} title={ex.title || `Experience ${i + 1}`} controls={listControls("experiences", i, state.experiences.length, `experience ${i + 1}`)}>
                <Field label="Job title" error={errorFor(`experiences.${i}.title`)}>
                  {(p) => <Input {...p} value={ex.title} onChange={(e) => updateItem("experiences", i, { title: e.target.value })} />}
                </Field>
                <Field label="Company" error={errorFor(`experiences.${i}.company`)}>
                  {(p) => <Input {...p} value={ex.company} onChange={(e) => updateItem("experiences", i, { company: e.target.value })} />}
                </Field>
                <Field label="Start" error={errorFor(`experiences.${i}.startDate`)}>
                  {(p) => <Input {...p} placeholder="Jun 2025" value={ex.startDate} onChange={(e) => updateItem("experiences", i, { startDate: e.target.value })} />}
                </Field>
                <Field label="End" error={errorFor(`experiences.${i}.endDate`)}>
                  {(p) => (
                    <Input {...p} placeholder="Aug 2025" disabled={ex.current} value={ex.endDate} onChange={(e) => updateItem("experiences", i, { endDate: e.target.value })} />
                  )}
                </Field>
                <label className="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-brand-600"
                    checked={ex.current}
                    onChange={(e) => updateItem("experiences", i, { current: e.target.checked, endDate: e.target.checked ? "" : ex.endDate })}
                  />
                  I still work here
                </label>
                <Field label="What you did" hint="One point per line." error={errorFor(`experiences.${i}.highlights`)} className="sm:col-span-2">
                  {(p) => (
                    <Textarea {...p} rows={4} value={ex.highlights.join("\n")} onChange={(e) => updateItem("experiences", i, { highlights: e.target.value.split("\n") })} />
                  )}
                </Field>
              </Item>
            ))}
          </ItemList>
        </Card>

        <Card>
          <CardHeader
            title="Links"
            description="LinkedIn, GitHub, portfolio."
            action={<AddButton onClick={() => addItem("links")} label="Add link" />}
          />
          <ItemList empty="No links added yet.">
            {state.links.map((ln, i) => (
              <Item key={ln._key} title={ln.label || `Link ${i + 1}`} controls={listControls("links", i, state.links.length, `link ${i + 1}`)}>
                <Field label="Label" error={errorFor(`links.${i}.label`)}>
                  {(p) => <Input {...p} placeholder="LinkedIn" value={ln.label} onChange={(e) => updateItem("links", i, { label: e.target.value })} />}
                </Field>
                <Field label="Web address" error={errorFor(`links.${i}.url`)}>
                  {(p) => <Input {...p} type="url" placeholder="https://" value={ln.url} onChange={(e) => updateItem("links", i, { url: e.target.value })} />}
                </Field>
              </Item>
            ))}
          </ItemList>
        </Card>
      </div>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <Card className="flex flex-col gap-4">
          <StrengthMeter profile={cleaned} />
          {message && <Alert tone={message.tone}>{message.text}</Alert>}
          <Button size="lg" onClick={save} disabled={saving}>
            {saving ? "Saving…" : saveLabel}
          </Button>
          {dirty && !saving && <p className="text-center text-xs text-slate-500">You have unsaved changes.</p>}
        </Card>
      </aside>
    </div>
  );
}

function AddButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <Button variant="outline" size="sm" onClick={onClick}>
      <Plus className="h-4 w-4" /> {label}
    </Button>
  );
}

function ItemList({ children, empty }: { children: ReactNode[]; empty: string }) {
  if (children.length === 0) return <p className="text-sm text-slate-500">{empty}</p>;
  return <div className="flex flex-col gap-4">{children}</div>;
}

function Item({ title, controls, children }: { title: string; controls: ReactNode; children: ReactNode }) {
  return (
    <fieldset className="rounded-md border border-slate-200 p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <legend className="truncate text-sm font-semibold text-slate-800">{title}</legend>
        {controls}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function SkillsInput({
  skills,
  error,
  onChange,
}: {
  skills: Keyed<SkillInput>[];
  error?: string;
  onChange: (skills: Keyed<SkillInput>[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const names = draft.split(",").map((s) => s.trim()).filter(Boolean);
    const existing = new Set(skills.map((s) => s.name.toLowerCase()));
    const fresh = names.filter((n) => !existing.has(n.toLowerCase()));
    if (fresh.length) onChange([...skills, ...fresh.map((name) => ({ name, category: "", _key: newKey() }))]);
    setDraft("");
  };
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-wrap gap-2" aria-label="Your skills">
        {skills.map((s) => (
          <li key={s._key} className="flex items-center gap-1 rounded-full bg-brand-50 py-1 pl-3 pr-1 text-sm text-brand-800">
            {s.name}
            <button
              type="button"
              aria-label={`Remove ${s.name}`}
              className="rounded-full p-0.5 hover:bg-brand-100"
              onClick={() => onChange(skills.filter((x) => x._key !== s._key))}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
        {skills.length === 0 && <li className="text-sm text-slate-500">No skills added yet.</li>}
      </ul>
      <Field label="Add a skill" hint="Press Enter to add. You can paste several, separated by commas." error={error}>
        {(p) => (
          <div className="flex gap-2">
            <Input
              {...p}
              value={draft}
              placeholder="For example: Selenium"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
            />
            <Button variant="outline" onClick={add} disabled={!draft.trim()}>
              Add
            </Button>
          </div>
        )}
      </Field>
    </div>
  );
}
