import { randomUUID } from "node:crypto";
import { AiError, resumeParseTask, type AiClient } from "@pathfinder/ai";
import type { ScopedDb } from "@pathfinder/db";
import { recordAudit } from "../audit";
import { UserFacingError } from "../errors";
import { getLogger } from "../logger";
import { draftToProfileInput } from "../profile/normalize";
import type { ProfileInput } from "../profile/schema";
import type { FileStorage } from "../storage";
import { createAiRecorder } from "../usage";
import { extractResumeText, MAX_RESUME_BYTES, RESUME_MIME, sniffResumeKind } from "./extract";

export interface ImportResumeDeps {
  db: ScopedDb;
  storage: FileStorage;
  ai: AiClient;
}

export interface ImportResumeResult {
  resumeFileId: string;
  /** A draft for the student to review. Nothing is saved to the profile yet. */
  draft: ProfileInput;
}

const MIN_TEXT_CHARS = 100;

/**
 * Upload → store the original → extract text → AI turns it into profile JSON → draft for review.
 * The student confirms (and can edit) the draft on the next screen; only then is it saved.
 */
export async function importResume(
  { db, storage, ai }: ImportResumeDeps,
  bytes: Uint8Array,
): Promise<ImportResumeResult> {
  const log = getLogger().child({ op: "resume.import" });

  if (bytes.byteLength === 0) throw new UserFacingError("FILE_EMPTY", "That file is empty. Choose your resume file and try again.");
  if (bytes.byteLength > MAX_RESUME_BYTES) {
    throw new UserFacingError("FILE_TOO_LARGE", "That file is bigger than 5 MB. Save a smaller PDF or Word file and try again.", 413);
  }
  const kind = sniffResumeKind(bytes);
  if (!kind) {
    throw new UserFacingError("FILE_TYPE", "Upload your resume as a PDF or a Word (.docx) file.", 415);
  }

  const storageKey = `users/${db.userId}/resumes/${randomUUID()}.${kind}`;
  await storage.put(storageKey, bytes, RESUME_MIME[kind]);
  const resumeFile = await db.resumeFile.create({
    data: { userId: db.userId, storageKey, mime: RESUME_MIME[kind], size: bytes.byteLength },
  });

  let text: string;
  try {
    text = await extractResumeText(bytes, kind);
  } catch (error) {
    log.warn({ kind, err: (error as Error).name }, "text extraction failed");
    throw new UserFacingError("FILE_UNREADABLE", "We couldn't open that file. It may be damaged or password-protected. Try saving it again, or start with a blank profile.", 422);
  }
  if (text.length < MIN_TEXT_CHARS) {
    throw new UserFacingError(
      "FILE_NO_TEXT",
      "We couldn't find much text in that file. If it's a scanned photo of your resume, upload the Word version instead, or start with a blank profile.",
      422,
    );
  }

  let draft: ProfileInput;
  try {
    const parsed = await ai.run(resumeParseTask, { resumeText: text }, { recorder: createAiRecorder(db) });
    draft = draftToProfileInput(parsed);
  } catch (error) {
    if (error instanceof AiError) {
      log.warn({ kind: error.kind }, "resume parse failed");
      throw new UserFacingError(
        "AI_UNAVAILABLE",
        "We couldn't read your resume automatically just now. Try again in a minute, or start with a blank profile.",
        503,
      );
    }
    throw error;
  }

  await db.resumeFile.update({ where: { id: resumeFile.id }, data: { parsedAt: new Date() } });
  await recordAudit(db, "RESUME_IMPORT");
  log.info({ kind, chars: text.length, provider: ai.providerName }, "resume parsed");
  return { resumeFileId: resumeFile.id, draft };
}
