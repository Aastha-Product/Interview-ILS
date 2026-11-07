import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";

export type ButtonVariant =
  | "primary"
  | "secondary"
  | "text"
  | "danger-text"
  | "danger-outline"
  | "danger";
export type ButtonSize = "lg" | "md" | "sm";

// Pathfinder: the reference design's buttons (its .primary-button and .secondary-button): rounded-lg,
// medium weight, and on hover a navy fill (primary) or a blue fill (secondary) with a slight lift.
const base =
  "inline-flex items-center justify-center gap-2 rounded-control font-medium whitespace-nowrap motion-safe:transition-all motion-safe:duration-300 disabled:cursor-not-allowed aria-disabled:cursor-not-allowed";

/** The reference's hover: scale 1.05 and shadow-lg; not while disabled. */
const lift =
  "not-disabled:not-aria-disabled:motion-safe:hover:scale-105 not-disabled:not-aria-disabled:hover:shadow-page";

const variants: Record<ButtonVariant, string> = {
  primary: `bg-primary text-on-primary shadow-cta hover:bg-primary-hover hover:text-on-primary disabled:bg-faint aria-disabled:bg-faint ${lift}`,
  secondary: `border-2 border-line-control bg-transparent text-primary-text hover:bg-primary hover:text-on-primary disabled:border-line-field disabled:text-muted aria-disabled:text-muted ${lift}`,
  // Text buttons have no horizontal padding so they line up with the text around them.
  text: "px-0! text-muted hover:text-primary-text disabled:text-faint aria-disabled:text-faint",
  "danger-text": "px-0! font-normal text-danger hover:text-error-strong disabled:text-faint",
  "danger-outline":
    "border border-danger-control bg-input text-error-strong hover:border-error-strong disabled:text-faint",
  danger:
    "bg-danger-fill text-white hover:bg-danger-fill-hover disabled:bg-danger-disabled aria-disabled:bg-danger-disabled",
};

const sizes: Record<ButtonSize, string> = {
  // The reference's px-6 py-3 buttons; md and sm stay compact for the app's dense screens.
  lg: "min-h-11 px-6 py-2.5 text-[15px]",
  md: "min-h-[34px] px-3 py-1.5 text-sm",
  sm: "min-h-[30px] px-3 py-1 text-control",
};

/** Button styles, for links that look like buttons: `<Link className={buttonClassName()}>`. */
export function buttonClassName(
  variant: ButtonVariant = "primary",
  size: ButtonSize = "md",
  className?: string,
): string {
  return cn(base, variants[variant], sizes[size], className);
}

export type ButtonProps = ComponentProps<"button"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

/**
 * A button in one of the prototype's styles. Defaults to `type="button"`, so
 * it only submits a form when asked to. For a button that should look
 * disabled but still explain why when clicked (PRD NEW-1), use
 * `aria-disabled` instead of `disabled`.
 */
export function Button({
  variant = "primary",
  size = "md",
  type = "button",
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClassName(variant, size, className)}
      {...props}
    />
  );
}
