"use client";

import { MessageSquare } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/cn";

import { useSidebarCollapsed } from "./sidebar-frame";

const LABEL = "Send feedback";

/** The sidebar's link to the feedback page, naming the page it was opened from (Pathfinder). */
export function FeedbackLink() {
  const collapsed = useSidebarCollapsed();
  const pathname = usePathname();
  const href = pathname && pathname !== "/feedback" ? `/feedback?from=${encodeURIComponent(pathname)}` : "/feedback";
  return (
    <Link
      href={href}
      title={collapsed ? LABEL : undefined}
      className={cn(
        "flex w-full items-center gap-1.5 rounded-control px-3 py-1.5 text-sm font-medium text-muted hover:bg-hover hover:text-ink motion-safe:transition-colors",
        collapsed && "justify-center px-1.5",
      )}
    >
      <MessageSquare size={16} aria-hidden="true" className="shrink-0" />
      <span className={cn(collapsed && "sr-only")}>{LABEL}</span>
    </Link>
  );
}
