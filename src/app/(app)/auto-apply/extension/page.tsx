import type { Metadata } from "next";

import { listExtensionTokens } from "@/lib/extension/tokens";

import { ExtensionScreen } from "./extension-screen";

export const metadata: Metadata = { title: "Connect the extension" };

/** Connect the extension (auto-apply step 5). */
export default async function ExtensionPage() {
  return <ExtensionScreen tokens={await listExtensionTokens()} />;
}
