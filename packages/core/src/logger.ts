import pino, { type Logger } from "pino";

/**
 * Structured JSON logs. Rule: never pass resume text, profile content, prompts or AI answers to
 * the logger. The redaction list below is a safety net, not permission to log them.
 */
const REDACT = [
  "email",
  "*.email",
  "phone",
  "*.phone",
  "resumeText",
  "*.resumeText",
  "text",
  "*.text",
  "profile",
  "*.profile",
  "draft",
  "*.draft",
  "prompt",
  "*.prompt",
  "content",
  "*.content",
  "headers.cookie",
  "*.headers.cookie",
  "headers.authorization",
  "*.headers.authorization",
];

let root: Logger | undefined;

export function getLogger(): Logger {
  root ??= pino({
    level: process.env.LOG_LEVEL ?? "info",
    base: { service: process.env.PATHFINDER_SERVICE ?? "web" },
    redact: { paths: REDACT, censor: "[redacted]" },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
  return root;
}
