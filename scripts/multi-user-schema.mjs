#!/usr/bin/env node
// One-off conversion of prisma/schema.prisma from Dossier's single owner to many users.
// Adds a User model, an owner (userId) to every table that holds a student's data, and makes the
// single-owner keys per-owner (a setting key, a skill name, a Gmail message id are unique per user).
// Idempotent: does nothing if User already exists. Run: node scripts/multi-user-schema.mjs

import fs from "node:fs";

const FILE = "prisma/schema.prisma";
let schema = fs.readFileSync(FILE, "utf8").replace(/\r\n/g, "\n");
if (/^model User \{/m.test(schema)) {
  console.log("User model already present; nothing to do.");
  process.exit(0);
}

/** Tables that hold one student's data. Theme also has shared built-ins, so its owner is optional. */
const OWNED = [
  "ProfileField", "Skill", "Language", "Experience", "ExperienceSkill", "Project", "ProjectSkill",
  "Education", "Publication", "Reference", "Fact", "Theme", "Setting", "Application", "StatusEvent",
  "Document", "DocumentVersion", "ChatMessage", "Note", "Posting", "ClaudePaste", "AgentCandidate",
  "PostingScore", "PostingSearch", "Startup", "StartupBlock", "GoogleAccount", "EmailMessage", "Job",
];
const OPTIONAL_OWNER = new Set(["Theme"]);

/** Single-owner keys that become unique per owner. */
const KEY_CHANGES = {
  ProfileField: [[/^(\s+key\s+String)\s+@id\b/m, "$1"], "@@id([userId, key])"],
  Setting: [[/^(\s+key\s+String)\s+@id\b/m, "$1"], "@@id([userId, key])"],
  StartupBlock: [[/^(\s+hash\s+String)\s+@id\b/m, "$1"], "@@id([userId, hash])"],
  GoogleAccount: [[/^(\s+id\s+String)\s+@id\s+(@default\("google"\))/m, "$1 $2"], "@@id([userId, id])"],
  Skill: [[/^(\s+name\s+String)\s+@unique\s+(@db\.Citext)/m, "$1 $2"], "@@unique([userId, name])"],
  Language: [[/^(\s+name\s+String)\s+@unique\s+(@db\.Citext)/m, "$1 $2"], "@@unique([userId, name])"],
  AgentCandidate: [[/^(\s+dedupeKey\s+String)\s+@unique\b/m, "$1"], "@@unique([userId, dedupeKey])"],
  EmailMessage: [[/^(\s+gmailId\s+String)\s+@unique\b/m, "$1"], "@@unique([userId, gmailId])"],
};
/** Compound keys that gain the owner as their first column. */
const COMPOUND_CHANGES = {
  PostingScore: [["@@id([source, externalId])", "@@id([userId, source, externalId])"]],
  Posting: [["@@unique([source, externalId])", "@@unique([userId, source, externalId])"]],
  AgentCandidate: [["@@unique([source, externalId])", "@@unique([userId, source, externalId])"]],
  Startup: [["@@unique([source, externalId])", "@@unique([userId, source, externalId])"]],
};

const lowerFirst = (s) => s[0].toLowerCase() + s.slice(1);
const plural = (s) => (s.endsWith("s") ? `${s}es` : s.endsWith("y") ? `${s.slice(0, -1)}ies` : `${s}s`);

for (const model of OWNED) {
  const re = new RegExp(`^model ${model} \\{\\n([\\s\\S]*?)^\\}`, "m");
  const match = schema.match(re);
  if (!match) throw new Error(`model ${model} not found`);
  let body = match[1];
  const optional = OPTIONAL_OWNER.has(model);
  const ownerLines =
    `  /// The student this belongs to.${optional ? " Empty for the built-in ones everyone shares." : ""}\n` +
    `  userId String${optional ? "?" : ""}\n` +
    `  user   User${optional ? "?" : ""} @relation(fields: [userId], references: [id], onDelete: Cascade)\n`;
  body = ownerLines + body;

  const blockLines = [];
  if (KEY_CHANGES[model]) {
    const [[pattern, replacement], block] = KEY_CHANGES[model];
    if (!pattern.test(body)) throw new Error(`${model}: key line not found`);
    body = body.replace(pattern, replacement);
    blockLines.push(block);
  }
  for (const [from, to] of COMPOUND_CHANGES[model] ?? []) {
    if (!body.includes(from)) throw new Error(`${model}: ${from} not found`);
    body = body.replace(from, to);
  }
  const hasLeadingUserIndex = /@@(id|unique|index)\(\[userId\b/.test(body) || blockLines.some((b) => b.includes("[userId"));
  if (!hasLeadingUserIndex) blockLines.push("@@index([userId])");
  body = body.replace(/\n*$/, "\n") + blockLines.map((l) => `  ${l}\n`).join("");
  schema = schema.replace(re, `model ${model} {\n${body}}`);
}

const backRelations = OWNED.map((m) => `  ${plural(lowerFirst(m)).padEnd(18)} ${m}[]`).join("\n");
const userModel = `// ─── Users (Pathfinder) ──────────────────────────────────────────────────────

/// A student with a private account. Everything they store belongs to them and is deleted with them.
model User {
  id        String   @id @default(cuid())
  email     String   @unique @db.Citext
  name      String   @default("")
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

${backRelations}
}

`;
const firstModel = schema.search(/^model /m);
schema = schema.slice(0, firstModel) + userModel + schema.slice(firstModel);
fs.writeFileSync(FILE, schema);
console.log(`Added User and an owner to ${OWNED.length} tables.`);
