import { getLatestResumePdf } from "@pathfinder/core";
import { NextResponse } from "next/server";
import { withUser } from "@/server/http";
import { getFileStorage } from "@/server/services";

export const runtime = "nodejs";

/** GET /api/applications/:id/pdf: a short-lived signed link to the latest resume PDF. */
export const GET = withUser<{ id: string }>(async ({ db, params }) => {
  const pdf = await getLatestResumePdf(db, params.id);
  const url = await getFileStorage().signedUrl(pdf.storageKey, { filename: pdf.filename, expiresInSeconds: 300 });
  return NextResponse.json({ url, filename: pdf.filename, version: pdf.version });
});
