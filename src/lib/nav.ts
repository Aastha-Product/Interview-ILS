import { Bot, BriefcaseBusiness, FileText, House, Inbox, LayoutDashboard, Rocket, Search, Settings, ShieldCheck, UserRound, Zap, type LucideIcon } from "lucide-react";

// The app's sections, shared by the sidebar and the page bar so they always agree.

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Whether the item is the current section; defaults to its own path and below. */
  isActive?: (pathname: string) => boolean;
};

const within = (pathname: string, base: string) =>
  pathname === base || pathname.startsWith(`${base}/`);

/** The sections in groups; the last group sits at the bottom. */
export const NAV: { label?: string; items: NavItem[] }[] = [
  // Pathfinder: the resume analysis is home; auto-apply, the main feature, comes next; the job tools
  // follow under More tools (PATHFINDER_TOOLS).
  {
    items: [
      { href: "/analyze", label: "Home", icon: House },
      { href: "/auto-apply", label: "Auto-apply", icon: Zap },
    ],
  },
  {
    label: "You",
    items: [
      { href: "/profile", label: "Profile", icon: UserRound },
      { href: "/resume", label: "Base resume", icon: FileText },
    ],
  },
  {
    label: "More tools",
    items: [
      { href: "/", label: "Job dashboard", icon: LayoutDashboard, isActive: (pathname) => pathname === "/" },
      { href: "/jobs", label: "Find jobs", icon: Search },
      { href: "/startups", label: "Startups", icon: Rocket },
      { href: "/agent", label: "Agent", icon: Bot },
      {
        href: "/applications",
        label: "Applications",
        icon: BriefcaseBusiness,
        // A new application becomes one, so the flow belongs to Applications.
        isActive: (pathname) => within(pathname, "/applications") || within(pathname, "/new"),
      },
      { href: "/inbox", label: "Inbox", icon: Inbox },
    ],
  },
  // Pathfinder: Admin shows only to the people in PATHFINDER_ADMIN_EMAILS (the layout hides it for everyone else).
  {
    items: [
      { href: "/admin", label: "Admin", icon: ShieldCheck },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export const isCurrent = ({ href, isActive = (path) => within(path, href) }: NavItem, pathname: string) => isActive(pathname);

/** The section a path belongs to, for the page bar's title; undefined outside them all. */
export function currentSection(pathname: string): NavItem | undefined {
  return NAV.flatMap((group) => group.items).find((item) => isCurrent(item, pathname));
}
