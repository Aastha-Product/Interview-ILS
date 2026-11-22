import { existsSync } from "node:fs";
import { join } from "node:path";

import type { Metadata } from "next";

import { listExtensionTokens } from "@/lib/extension/tokens";

import manifest from "../../../../../extension/manifest.json";

import { ExtensionScreen } from "./extension-screen";

export const metadata: Metadata = { title: "Connect the extension" };

/** The extension's package, built into the server's image (Dockerfile); absent in development. */
const PACKAGE = "pathfinder-extension.zip";

/** Connect the extension (auto-apply step 5). */
export default async function ExtensionPage() {
  const download = existsSync(join(process.cwd(), "public", PACKAGE)) ? { href: `/${PACKAGE}`, version: manifest.version } : null;
  return <ExtensionScreen tokens={await listExtensionTokens()} download={download} />;
}
