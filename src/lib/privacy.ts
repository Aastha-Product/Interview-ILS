// Pathfinder's privacy notice (/privacy, India's DPDP Act 2023): who runs
// this server and how to reach them. Fill these in before students sign up;
// until then the notice shows a marked placeholder in their place.

export type PrivacyContacts = {
  /** The organisation that runs this server: the Data Fiduciary. */
  organisation: string | null;
  /** Where students write with questions and requests about their data. */
  email: string | null;
  /** The grievance officer: a name or role, and how to reach them. */
  grievance: string | null;
};

export const PRIVACY_CONTACTS: PrivacyContacts = {
  organisation: null,
  email: null,
  grievance: null,
};

/** When the notice last changed; shown at its top. */
export const PRIVACY_UPDATED = "11 November 2026";

/** The placeholder shown for a contact that isn't filled in yet. */
export const PRIVACY_PLACEHOLDERS: Record<keyof PrivacyContacts, string> = {
  organisation: "[organisation name]",
  email: "[contact email]",
  grievance: "[grievance officer and contact]",
};

/** The contacts still missing, for the warning on the page. */
export function missingPrivacyContacts(contacts: PrivacyContacts = PRIVACY_CONTACTS): (keyof PrivacyContacts)[] {
  return (Object.keys(PRIVACY_PLACEHOLDERS) as (keyof PrivacyContacts)[]).filter((key) => !contacts[key]?.trim());
}
