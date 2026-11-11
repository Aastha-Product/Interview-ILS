import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { BrandMark } from "@/components/brand-mark";
import { env } from "@/lib/env";
import { missingPrivacyContacts, PRIVACY_CONTACTS, PRIVACY_PLACEHOLDERS, PRIVACY_UPDATED, type PrivacyContacts } from "@/lib/privacy";

export const metadata: Metadata = { title: "Privacy notice" };

/** How long the server's own nightly database copies are kept (deploy/lightsail/setup.sh). */
const SERVER_BACKUP_DAYS = 14;

const PROVIDER_NAMES = {
  local: "a model running on a computer chosen by the people who run this server",
  openai: "an OpenAI-compatible service",
  anthropic: "Anthropic (Claude)",
  mistral: "Mistral AI",
  lmstudio: "a model in LM Studio, on a computer chosen by the people who run this server",
} as const;

/** A contact from src/lib/privacy.ts, or its marked placeholder while it isn't filled in. */
function Contact({ field }: { field: keyof PrivacyContacts }) {
  const value = PRIVACY_CONTACTS[field]?.trim();
  if (!value) return <mark className="rounded-sm bg-warning-surface px-1 text-ink">{PRIVACY_PLACEHOLDERS[field]}</mark>;
  if (field === "email") {
    return (
      <a href={`mailto:${value}`} className="font-medium text-ink underline underline-offset-2">
        {value}
      </a>
    );
  }
  return <>{value}</>;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-serif text-[22px] font-medium tracking-[-0.01em] text-ink">{title}</h2>
      {children}
    </section>
  );
}

function Rows({ head, rows }: { head: [string, string]; rows: [ReactNode, ReactNode][] }) {
  return (
    <div className="overflow-x-auto rounded-card border border-line-card">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-paper text-muted">
          <tr>
            <th scope="col" className="w-2/5 px-4 py-2.5 font-medium">
              {head[0]}
            </th>
            <th scope="col" className="px-4 py-2.5 font-medium">
              {head[1]}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([what, why], index) => (
            <tr key={index} className="border-t border-line align-top">
              <td className="px-4 py-2.5 text-ink">{what}</td>
              <td className="px-4 py-2.5">{why}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Pathfinder's privacy notice (India's DPDP Act 2023), open without signing in so it can be read
 * before signing up. It describes what this app stores and where; the contacts come from
 * src/lib/privacy.ts.
 */
export default function PrivacyPage() {
  const missing = missingPrivacyContacts();
  const sharedAi = env.DOSSIER_AI_PROVIDER && env.DOSSIER_AI_MODEL ? PROVIDER_NAMES[env.DOSSIER_AI_PROVIDER] : null;
  const backupDays = env.DOSSIER_BACKUP_RETENTION_DAYS;

  return (
    <main className="min-h-screen bg-surface px-6 py-12 sm:px-10">
      <article className="mx-auto flex max-w-[720px] flex-col gap-9 text-[15px] leading-[1.6] text-pretty text-muted [&_strong]:font-medium [&_strong]:text-ink">
        <header className="flex flex-col gap-4">
          <Link href="/login" className="flex items-center gap-2 self-start text-sm text-muted hover:text-ink">
            <BrandMark className="size-7" />
            <span>Back to sign in</span>
          </Link>
          <h1 className="font-serif text-title leading-[1.1] text-ink">Privacy notice</h1>
          <p className="text-meta">Last updated {PRIVACY_UPDATED}</p>
          {missing.length > 0 && (
            <p role="note" className="rounded-card border border-warning-line bg-warning-surface px-4 py-3 text-sm text-ink">
              Draft: the highlighted contact details aren&apos;t filled in yet. Don&apos;t invite students until they are.
            </p>
          )}
          <p>
            Pathfinder helps students and recent graduates apply for jobs. You build one profile, keep track of the jobs
            you apply for, and Pathfinder drafts resumes, cover letters and emails for each one from the facts in your
            profile. If you switch on <strong>Auto-apply</strong> and connect the Pathfinder extension to Chrome, it
            applies for you to the jobs that match, from your own browser and within the limits you set (section 7);
            otherwise you apply yourself. Pathfinder never signs in to job sites and never asks for their passwords.
          </p>
          <p>
            This notice explains what personal data Pathfinder keeps, why, where, who else receives it, how long it&apos;s
            kept, and your rights under India&apos;s Digital Personal Data Protection Act, 2023. If you live outside
            India, the data protection law where you live may give you further rights; write to us to use them.
          </p>
        </header>

        <Section title="1. Who we are">
          <p>
            Pathfinder is run by <strong><Contact field="organisation" /></strong> (&ldquo;we&rdquo;), the{" "}
            <em>Data Fiduciary</em> for your personal data.
          </p>
          <p>
            Questions and requests about your data: <Contact field="email" />. Complaints go to our grievance officer:{" "}
            <Contact field="grievance" />.
          </p>
          <p>
            Pathfinder is built on Dossier, open-source software published under the AGPL-3.0 licence. Its source code,
            including our changes, is public.
          </p>
        </Section>

        <Section title="2. Who can use Pathfinder">
          <p>Pathfinder is for people aged 18 or over. If you are under 18, please don&apos;t use it.</p>
        </Section>

        <Section title="3. What we keep, and why">
          <Rows
            head={["Data", "Why"]}
            rows={[
              [
                "Your name, email address and Google account ID, from Google when you sign in",
                "To create your account and know it's you. We don't receive your Google password or profile picture.",
              ],
              [
                "Your profile: contact details, a photo if you add one, links, experience, education, projects, skills, languages, publications, references and other facts about you",
                "To draft resumes and letters from your own facts, and to match you with jobs",
              ],
              [
                "Resumes you import, and the resumes, cover letters, emails and PDFs drafted for each application",
                "So you can edit, download and send them",
              ],
              [
                "Applications: company, role, the job description, status, dates, notes, and your chats with the AI about them",
                "To keep track of your applications",
              ],
              [
                "Job searches and the postings they found, and what the job agent suggests, if you turn it on",
                "To find and score jobs for you",
              ],
              [
                "Email, only if you connect Gmail (section 6)",
                "To match replies to your applications, read them and draft answers",
              ],
              [
                "Auto-apply, only if you set it up: what you're looking for, your limits, your answers to questions forms often ask (such as notice period or expected salary), and when you agreed to it",
                "To apply for you only where and how you allowed",
              ],
              [
                "For each application auto-apply works on: the job, how well it matched, the answers it gave the form, and what the job site showed afterwards (the confirmation's words and the page's address) or why it stopped",
                "So you can see exactly what was sent, and so an application is never sent twice or reported as sent when it wasn't",
              ],
              [
                "Browsers connected to auto-apply: a name such as “Chrome on Windows”, and when each was connected and last used",
                "So you can see and disconnect them. The extension's key is kept only as a fingerprint (a hash), never as the key itself.",
              ],
              [
                "Your settings, including any API keys you enter (stored encrypted)",
                "So the app works the way you set it up",
              ],
              [
                "Feedback you send with Send feedback, with the page you sent it from",
                "To fix problems and improve Pathfinder",
              ],
              [
                "Background tasks: what an AI task was given and wrote, for a short time (section 8)",
                "So a task's result is there when you come back to it",
              ],
            ]}
          />
          <p>
            We don&apos;t collect job-site passwords, government ID numbers or payment details. We don&apos;t sell your
            data, show you advertising, or use your data to train AI models. Each account is private: no other student
            can see or change your data.
          </p>
        </Section>

        <Section title="4. Consent">
          <p>
            We process your personal data with your consent, which you give by signing in after reading this notice. You
            can withdraw it at any time (section 9). Withdrawing stops the processing from then on; it doesn&apos;t
            undo what happened before.
          </p>
          <p>
            Auto-apply asks for its own consent, on the Auto-apply page, before it submits anything for you. It starts in
            dry run, which fills in forms but stops before Submit, until you switch that off.
          </p>
        </Section>

        <Section title="5. Where your data is stored">
          <p>
            Pathfinder runs on one server rented from <strong>Amazon Web Services (AWS Lightsail)</strong> in its{" "}
            <strong>Sydney, Australia</strong> region. Your data, its files and its backups are kept on that server, so
            unless you live in Australia, your data is stored outside your country. AWS provides the machine; it
            doesn&apos;t use your data. Everything between your browser and the server is encrypted (HTTPS).
          </p>
        </Section>

        <Section title="6. Who else receives your data">
          <p>Some features send data to other services. Each one gets only what that feature needs:</p>
          <Rows
            head={["Service", "What it receives, and when"]}
            rows={[
              [
                "Google sign-in",
                "Google tells us your name, email address and account ID when you sign in.",
              ],
              [
                "The AI provider you choose",
                <>
                  To read a resume or job post, draft documents, answer in a chat, or read and answer replies, the text
                  involved is sent to the AI provider set in <strong>Settings → AI provider</strong>: for example OpenAI,
                  Anthropic, Mistral AI, or a model on your own computer. With your own key, that provider&apos;s terms
                  between you and them apply.
                  {sharedAi ? <> If you don&apos;t add your own, this server uses {sharedAi}.</> : null} The provider may
                  process the text in other countries.
                </>,
              ],
              [
                "Job search services",
                "When you search in Find jobs, or the job agent searches for you, your search words and place go to the job search service chosen in Settings → Job search (such as JSearch or Adzuna). Your profile doesn't.",
              ],
              [
                "TypeSafe (Jev), only if you choose it",
                "If you pick Jev in Settings → Scoring, parts of your profile and the job post are sent to TypeSafe to score how well they match.",
              ],
              [
                "Employers, through their job sites, only with auto-apply",
                "When auto-apply applies for you, the employer's form (on Greenhouse, Lever or Ashby) receives what any application gives it: your answers, your resume and your cover letter. The employer and the job site then handle it under their own privacy notices.",
              ],
              [
                "Gmail and Google Calendar, only if you connect them",
                <>
                  In <strong>Settings → Google</strong> you can let Pathfinder send the emails you approve, read your
                  inbox for replies to your applications, see when you&apos;re free, and add interviews you agree to. It
                  keeps mail that matches one of your applications (or, if you choose, any mail in your main inbox tab)
                  for up to the first 20,000 characters, and your AI provider reads it. For other mail it keeps only
                  Gmail&apos;s message ID and date. Disconnecting in Settings → Google stops this and withdraws the
                  permission at Google.
                </>,
              ],
            ]}
          />
          <p>
            This server never sends a usage ping. It checks for a newer version of the software only if you press{" "}
            <em>Check for updates</em> or turn on the daily check in Settings → About; it then asks GitHub for the latest
            version and sends nothing about you.
          </p>
        </Section>

        <Section title="7. The Pathfinder extension for Chrome">
          <p>
            Auto-apply submits applications through Pathfinder&apos;s extension, which you add to Chrome and connect to
            your account on <em>Auto-apply → Connect the extension</em>. Its use of data follows the Chrome Web Store
            User Data Policy, including its Limited Use requirements.
          </p>
          <ul className="flex list-disc flex-col gap-2 pl-5">
            <li>
              <strong>What it does:</strong> about once a minute it asks Pathfinder for the next application that&apos;s
              ready, opens the job&apos;s form in a background tab, fills it in with the answers Pathfinder prepared and
              your resume and cover letter, and submits it. It stops and leaves the form open for you instead when dry
              run is on, or when the form needs something only you can give: a check that you&apos;re a person, a code
              sent to your email, a sign-in, or an answer Pathfinder doesn&apos;t have. It never gets round those checks
              and never makes up an answer. To questions about gender, race, caste, disability or similar, it picks the
              option that declines to answer, or leaves the question to you.
            </li>
            <li>
              <strong>Where it works:</strong> only on Pathfinder&apos;s own site and on the application pages of
              Greenhouse (job-boards.greenhouse.io, boards.greenhouse.io), Lever (jobs.lever.co, jobs.eu.lever.co) and
              Ashby (jobs.ashbyhq.com), and only in the tab it opened for the application. It can&apos;t read other
              sites, your other tabs, your browsing history, cookies or saved passwords.
            </li>
            <li>
              <strong>What it keeps in your browser:</strong> the key that connects it to your account, your name (to
              show whose account it applies for), whether you paused it, and the application it&apos;s working on until
              it&apos;s done. Removing the extension, or disconnecting the browser in Pathfinder, ends this.
            </li>
            <li>
              <strong>What it sends to Pathfinder:</strong> the questions on a form that Pathfinder&apos;s copy of it
              lacked (their wording and choices), and what happened: that it&apos;s about to press Submit, that the job
              site confirmed the application (with the confirmation&apos;s first 500 characters and the page&apos;s
              address), or why it stopped. It sends nothing about other pages.
            </li>
            <li>
              <strong>You stay in charge:</strong> <em>Pause in this browser</em>, behind the extension&apos;s icon, stops
              it starting new applications; the <em>Apply for me</em> switch on the Auto-apply page stops auto-apply
              everywhere; <em>Disconnect</em> on Auto-apply → Connect the extension cuts a browser off for good. A
              browser&apos;s key also stops working after 90 days.
            </li>
          </ul>
          <p>
            We don&apos;t sell what the extension handles, use it for advertising or credit decisions, or let anyone read
            it except as this notice says.
          </p>
        </Section>

        <Section title="8. How long we keep it">
          <Rows
            head={["Data", "Kept for"]}
            rows={[
              ["Your profile, documents, applications, searches and settings", "Until you delete them, or delete everything (section 9)"],
              ["Auto-apply's settings, matches and record of each application, and the browsers connected to it", "Until you delete everything or your account (section 9)"],
              [
                "What a background AI task was given and wrote",
                "24 hours, or what you choose in Settings → Your data → Keep task data for (1 hour to 30 days)",
              ],
              [
                "Nightly copies of your own data (Settings → Your data → Nightly backups, on unless you turn it off)",
                `${backupDays} days`,
              ],
              [
                "The server's nightly copy of the whole database",
                `${SERVER_BACKUP_DAYS} days. Data you delete is gone from these copies within ${SERVER_BACKUP_DAYS} days.`,
              ],
              [
                "Your account (name, email, Google ID), feedback you sent and a record of your AI use",
                "Until you delete your account (section 9)",
              ],
              ["Failed attempts to sign in with an access code, by IP address (trial servers only)", "1 day"],
            ]}
          />
          <p>The server&apos;s logs record errors, but never the text of your profile, resumes, documents or AI requests.</p>
        </Section>

        <Section title="9. Your rights">
          <ul className="flex list-disc flex-col gap-2 pl-5">
            <li>
              <strong>See your data:</strong> <em>Settings → Your data → Export everything</em> downloads everything
              Pathfinder holds about you in one file.
            </li>
            <li>
              <strong>Correct it:</strong> edit your profile, documents and applications at any time.
            </li>
            <li>
              <strong>Erase it:</strong> <em>Settings → Privacy and data → Delete my account</em> deletes your
              account and everything in it straight away: your profile, analyses, applications, documents, searches,
              mail, auto-apply and its connected browsers, settings, feedback, the record of your AI use and your files. It disconnects Google and signs you out
              on every device. To start over but keep your account, use <em>Delete everything</em> instead, which keeps
              only your account and any feedback you sent. Either way, what you delete is gone from the server&apos;s
              nightly copies within {SERVER_BACKUP_DAYS} days (section 8).
            </li>
            <li>
              <strong>Withdraw consent:</strong> delete your account. To stop only the Gmail and Calendar connection,
              disconnect it in Settings → Google. To stop only auto-apply, switch off <em>Apply for me</em> on the
              Auto-apply page and disconnect its browsers.
            </li>
            <li>
              <strong>Nominate someone</strong> to exercise these rights for you if you die or can no longer act: write
              to <Contact field="email" />.
            </li>
            <li>
              <strong>Have a grievance addressed:</strong> write to our grievance officer, <Contact field="grievance" />.
              If you&apos;re not satisfied with the answer, you can complain to the Data Protection Board of India, or to
              the data protection authority where you live.
            </li>
          </ul>
        </Section>

        <Section title="10. How we protect it">
          <ul className="flex list-disc flex-col gap-2 pl-5">
            <li>You sign in with Google; Pathfinder stores no passwords.</li>
            <li>
              Every account is private: the app reads and writes only your own data, the database refuses changes that
              skip that check, and both are tested automatically.
            </li>
            <li>API keys and the Gmail connection are stored encrypted.</li>
            <li>
              The extension&apos;s key is kept only as a fingerprint, so the database can&apos;t give it away, and the
              extension accepts a key only from Pathfinder&apos;s own pages.
            </li>
            <li>
              Auto-apply presses Submit at most once for each application, and marks it applied only when the job site
              confirms it.
            </li>
            <li>Job descriptions and resumes are treated as untrusted text, so instructions hidden in them can&apos;t direct the AI.</li>
            <li>The AI drafts only from facts in your profile, and you review every draft before using it.</li>
          </ul>
          <p>If a breach affects your personal data, we will tell you and the Data Protection Board as the law requires.</p>
        </Section>

        <Section title="11. Changes to this notice">
          <p>
            If we change how we use your data, we will update this page and tell you in the app before the change takes
            effect, and ask for your consent again where the law requires.
          </p>
        </Section>
      </article>
    </main>
  );
}
