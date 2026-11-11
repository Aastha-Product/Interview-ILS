import { EMPTY_ANSWERS, type SavedAnswers } from "@/lib/apply/answers";

/**
 * Every answer Set up job search requires (missingAnswers in src/lib/apply/answers.ts), as a
 * fresher would give them: auto-apply only runs once they're all there. With `cities` given too.
 */
export const COMPLETE_ANSWERS: SavedAnswers = {
  ...EMPTY_ANSWERS,
  workAuthorized: true,
  needsSponsorship: false,
  relativesAtCompany: false,
  backgroundCheckConsent: true,
  acceptPrivacyNotices: true,
  outsideActivities: false,
  willingToRelocate: true,
  onsiteOk: true,
  adult: true,
  employmentRestrictions: false,
  governmentOfficial: false,
  relativeOfGovernmentOfficial: false,
  referredByEmployee: false,
  noticePeriod: "immediate",
  noCurrentSalary: true,
  expectedSalary: "6 LPA",
  graduationYear: "2026",
};
