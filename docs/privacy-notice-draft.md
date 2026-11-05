# Pathfinder privacy notice: DRAFT

> **Status: draft for legal review. Not for publication as is.**
> Written against what the code does on the `phase-5` branch (November 2026). Items in **[[double brackets]]** need a decision or a fact from the team. India's Digital Personal Data Protection Act, 2023 (DPDP Act) and the DPDP Rules phase in over time; a qualified adviser should confirm what applies at launch, the exact wording of the consent request, and the complaint process. The short page at `/privacy` in the app should be replaced with the final version of this notice.

---

**Last updated:** [[date]]

Pathfinder helps students and recent graduates apply for jobs. You build one profile, add jobs you're interested in, and Pathfinder drafts a resume and short answers for each job using only what's in your profile. **You always submit applications yourself.** Pathfinder never logs in to job sites, never asks for their passwords, and never applies on your behalf.

This notice explains what personal data we collect, why, who processes it, how long we keep it, and your rights under the DPDP Act.

## 1. Who we are

Pathfinder is run by **[[legal name of the organisation, e.g. the company or institution]]**, **[[address]]** ("we"). We are the *Data Fiduciary* for your personal data.

Questions, requests and complaints: **[[privacy contact email]]**. Our grievance officer is **[[name, role]]**.

## 2. Who can use Pathfinder

Pathfinder is for people aged **18 or over**. If you are under 18, please don't use it. [[Decide how age is confirmed at sign-up; the app doesn't currently ask.]]

## 3. What we collect, and why

| Data | Where it comes from | Why we use it |
| --- | --- | --- |
| Name, email address, profile picture | Your Google account, when you sign in | To create and identify your account |
| Resume file you upload (PDF or Word) | You | To read it and pre-fill your profile, which you then check |
| Your profile: headline, summary, location, phone (optional), links, education, experience, projects, skills | You (and your resume) | To match you to jobs and draft resumes and answers from your own facts |
| Job preferences: roles, cities, remote, expected salary (optional), experience level | You | To suggest and score jobs |
| Jobs you add, and your searches | You (pasted links and text, searches) | To score jobs against your profile and keep your list |
| Applications: status, dates, notes, drafts and PDFs | You and Pathfinder | To track your applications and show your response rate |
| Usage records: number of AI drafts, PDFs and searches per day; timing and size of each AI request (never its content) | Pathfinder | To keep the free service within fair limits, find faults, and plan future limits or pricing |
| Security records: sign-ins, sign-outs, exports, deletions, with a scrambled (hashed) form of your IP address | Pathfinder | To protect your account and investigate misuse |

We **don't** collect job-site passwords, government ID numbers, payment details, or anything from your email or calendar.

We don't sell your data, and don't use it for advertising.

## 4. Consent

We process your personal data **with your consent**, which you give when you create an account and agree to this notice. [[Legal review: the exact consent wording and where it is shown at sign-up; the app currently shows a one-line notice with a link to this page on the sign-in screen.]]

You can **withdraw consent at any time** by deleting your account in **Settings → Delete your account**. It's as easy as signing up. Withdrawing consent stops all processing and deletes your data as described in section 7. It doesn't affect processing that happened before.

## 5. How AI is used

When you import a resume, add a job or draft an application, the relevant text is sent to our AI provider, **Google (Gemini API)**, to read or write it. [[If enabled: when Gemini is unavailable, a backup AI provider, [[name]], may be used instead.]]
- We use paid API terms under which the provider does not use your data to train its models. [[Confirm on the provider's current terms before launch.]]
- We don't keep the text we send. We record only its size, the time taken and a one-way fingerprint, to find faults.
- Job descriptions are treated as untrusted text, so instructions hidden in them can't change what the AI does.
- **The AI only works from facts in your profile.** Our software checks every line it writes against your profile and removes anything it can't support. You review and edit every draft before using it, and you decide what to send.

## 6. Who processes your data for us

We use these service providers (*Data Processors*). They act only on our instructions and under contracts that protect your data:

| Provider | Purpose | Data involved |
| --- | --- | --- |
| Google | Sign-in | Name, email, profile picture |
| Google (Gemini API) [[and backup AI provider]] | Reading resumes and job posts; drafting | Resume and profile text, job descriptions |
| [[Hosting provider]] | Running the app | All data, while processing it |
| [[Database provider]] | Storing your data | All data except files |
| [[File storage provider, e.g. Cloudflare R2]] | Storing your resume files and PDFs | Uploaded resumes, generated PDFs |
| [[JSearch (RapidAPI) / Adzuna]] | Job search results | Your search terms and city only, not your profile |

Some providers may process data outside India. The DPDP Act allows this except to countries the Government restricts; we will not use providers in restricted countries. [[List the actual regions once providers are chosen.]]

## 7. How long we keep your data

| Data | Kept for |
| --- | --- |
| Your account, profile, uploaded resumes, applications, drafts and PDFs | Until you delete them or your account |
| Detailed AI request records | 30 days (daily totals: 2 years) |
| Job match scores | 90 days, then recalculated when needed |
| Search history | 90 days |
| Security records (sign-ins etc.) | Until you delete your account |
| Server logs (no profile or resume content) | [[number]] days |
| Backups | Up to [[7–30]] days. A deleted account disappears from backups as they expire |

If your account is inactive for **[[period, e.g. 3 years]]**, we will email you and then delete it. [[Decide; not implemented yet.]]

## 8. Your rights

Under the DPDP Act you can:
- **Access your data:** *Settings → Download my data* gives you a file with everything we hold about you. To learn which providers process it, see section 6 or ask us.
- **Correct and update it:** edit your profile and applications at any time, or ask us.
- **Erase it:** *Settings → Delete your account* permanently deletes your account, your files and all your data straight away (backups expire as in section 7). To erase only part of your data, edit your profile, or write to us. [[Deleting a single application isn't in the app yet.]]
- **Withdraw consent:** see section 4.
- **Nominate someone** to exercise these rights if you die or can no longer act: write to **[[privacy contact email]]**.
- **Have your grievance addressed:** write to our grievance officer at **[[email]]**. We will reply within **[[number]] days**.
- **Complain to the Data Protection Board of India** if you're not satisfied with our response. [[Add the Board's contact details or complaint process.]]

## 9. How we protect your data

- Sign-in through Google only; we store no passwords.
- Every request is checked so that one student can never see another student's data, and this is tested automatically.
- Data is encrypted in transit (HTTPS) and at rest by our database and storage providers.
- Files are private and downloaded through links that expire after 5 minutes.
- Limits on requests and sign-in attempts, and a strict content security policy.
- Logs never contain resume or profile content or AI prompts.

If a breach affects your personal data, we will tell you and the Data Protection Board as the law requires.

## 10. Changes to this notice

If we change how we use your data, we will update this page and tell you in the app [[and by email]] before the change takes effect, and ask for your consent again where the law requires.
