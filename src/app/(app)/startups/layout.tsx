import { requireStartups } from "@/lib/startups/enabled";

/**
 * Pathfinder: Startups answers 404 unless PATHFINDER_STARTUPS=on. Checked
 * here, above the screen's loading state, so the answer is a real 404.
 */
export default function StartupsLayout({ children }: LayoutProps<"/startups">) {
  requireStartups();
  return children;
}
