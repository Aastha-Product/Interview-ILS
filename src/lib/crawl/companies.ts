import type { BoardSystem } from "@/generated/prisma/enums";

// Pathfinder (auto-apply step 2): the companies the crawler starts with. Added once when the
// crawler starts, never changed or removed from here: deactivate a company in the database.
//
// Every board below was checked on 10 November 2026 to exist and to have open jobs in India
// (the count then is in the comment). Add companies your students target the same way: find the
// board's name in its careers page address (job-boards.greenhouse.io/<name>, jobs.lever.co/<name>,
// jobs.ashbyhq.com/<name>, jobs.smartrecruiters.com/<CompanyId>).

export type StarterCompany = { name: string; system: BoardSystem; boardToken: string; countries?: string[] };

export const STARTER_COMPANIES: readonly StarterCompany[] = [
  // Greenhouse
  { name: "Okta", system: "GREENHOUSE", boardToken: "okta" }, // 105
  { name: "Databricks", system: "GREENHOUSE", boardToken: "databricks" }, // 88
  { name: "Zscaler", system: "GREENHOUSE", boardToken: "zscaler" }, // 81
  { name: "MongoDB", system: "GREENHOUSE", boardToken: "mongodb" }, // 76
  { name: "HighRadius", system: "GREENHOUSE", boardToken: "highradius" }, // 46
  { name: "InMobi", system: "GREENHOUSE", boardToken: "inmobi" }, // 46
  { name: "Stripe", system: "GREENHOUSE", boardToken: "stripe" }, // 44
  { name: "GitLab", system: "GREENHOUSE", boardToken: "gitlab" }, // 33
  { name: "Rubrik", system: "GREENHOUSE", boardToken: "rubrik" }, // 30
  { name: "Glance", system: "GREENHOUSE", boardToken: "glance" }, // 22
  { name: "Elastic", system: "GREENHOUSE", boardToken: "elastic" }, // 17
  { name: "HackerRank", system: "GREENHOUSE", boardToken: "hackerrank" }, // 17
  { name: "Twilio", system: "GREENHOUSE", boardToken: "twilio" }, // 15
  { name: "Coinbase", system: "GREENHOUSE", boardToken: "coinbase" }, // 11
  { name: "Druva", system: "GREENHOUSE", boardToken: "druva" }, // 10
  { name: "Groww", system: "GREENHOUSE", boardToken: "groww" }, // 9
  { name: "Airbnb", system: "GREENHOUSE", boardToken: "airbnb" }, // 9
  { name: "Figma", system: "GREENHOUSE", boardToken: "figma" }, // 4
  // Lever
  { name: "Paytm", system: "LEVER", boardToken: "paytm" }, // 190
  { name: "Meesho", system: "LEVER", boardToken: "meesho" }, // 52
  { name: "Zeta", system: "LEVER", boardToken: "zeta" }, // 23
  { name: "Mindtickle", system: "LEVER", boardToken: "mindtickle" }, // 19
  { name: "FamPay", system: "LEVER", boardToken: "fampay" }, // 17
  { name: "CRED", system: "LEVER", boardToken: "cred" }, // 14
  // Ashby
  { name: "Tekion", system: "ASHBY", boardToken: "tekion" }, // 67
  { name: "Atlan", system: "ASHBY", boardToken: "atlan" }, // 4
  { name: "Notion", system: "ASHBY", boardToken: "notion" }, // 2
  { name: "Sardine", system: "ASHBY", boardToken: "sardine" }, // 1
  // SmartRecruiters (company ids are case-sensitive)
  { name: "Bosch Group", system: "SMARTRECRUITERS", boardToken: "BoschGroup" }, // 592
  { name: "ServiceNow", system: "SMARTRECRUITERS", boardToken: "ServiceNow" }, // 80
  { name: "Freshworks", system: "SMARTRECRUITERS", boardToken: "Freshworks" }, // 32
  { name: "Ubisoft", system: "SMARTRECRUITERS", boardToken: "Ubisoft2" }, // 7
  { name: "Western Digital", system: "SMARTRECRUITERS", boardToken: "WesternDigital" }, // 2
];
