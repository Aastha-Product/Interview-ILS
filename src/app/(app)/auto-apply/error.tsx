"use client";

import { ScreenError, type ErrorPageProps } from "@/components/screen-error";

export default function AutoApplyError(props: ErrorPageProps) {
  return <ScreenError {...props} title="Auto-apply didn't load" />;
}
