import { Fragment, type CSSProperties, type ReactNode } from "react";

import type { PaperSize } from "@/generated/prisma/enums";
import { cn } from "@/lib/cn";
import { hasRightToLeft, type TextDirection } from "@/lib/document-language";
import { CONTACT_SEPARATOR } from "@/lib/resume-content";
import { PAPER_SIZES, SIDEBAR, type ResolvedTheme } from "@/lib/themes";

import styles from "./document.module.css";

/**
 * The theme's numbers as the custom properties document.module.css reads. `scale` (Pathfinder,
 * 1 by default) compresses a resume toward fewer pages: it shrinks the vertical spacing and the
 * text while the page size, horizontal margins and line-height ratio stay put, so the layout keeps
 * its shape and only gets tighter. The paper and page-height stay full size, so the same content
 * fills fewer pages.
 */
function themeStyle(theme: ResolvedTheme, paper: PaperSize, scale = 1): CSSProperties {
  const { density, heading, name } = theme;
  return {
    "--page-height": PAPER_SIZES[paper].pageHeight,
    "--paper-width": PAPER_SIZES[paper].widthMm,
    "--paper-height": PAPER_SIZES[paper].heightMm,
    "--pad-y": density.paddingY * scale,
    "--pad-x": density.paddingX,
    "--gap": density.gap * scale,
    "--item-gap": density.itemGap * scale,
    "--font-size": density.fontSize * scale,
    "--line-height": density.lineHeight,
    "--head-font": theme.headFamily,
    "--body-font": theme.bodyFamily,
    "--accent": theme.accent,
    "--name-size": name.size * scale,
    "--name-weight": name.weight,
    "--heading-size": heading.size * scale,
    "--heading-weight": heading.weight,
    "--heading-transform": heading.uppercase ? "uppercase" : "none",
    "--heading-tracking": heading.tracking,
    "--heading-rule": heading.rule ? 1 : 0,
    "--heading-padding": heading.padding * scale,
    "--sidebar-width": SIDEBAR.width,
    "--sidebar-gap": SIDEBAR.gap,
    ...(theme.banner && { "--on-accent": theme.onAccent }),
  } as CSSProperties;
}

/** The theme's structure as classes on the page: layout, header, dates and section titles. */
function themeClasses(theme: ResolvedTheme) {
  return cn(
    theme.split && styles.split,
    theme.sidebarEnd && styles.sidebarEnd,
    theme.tintedSidebar && styles.tintedSidebar,
    theme.sideHeadings && styles.sideHeadings,
    theme.centered && styles.centered,
    theme.banner && styles.banner,
    theme.timeline && styles.timeline,
    theme.heading.marker === "bar" && styles.headingBar,
    theme.heading.marker === "band" && styles.headingBand,
  );
}

/**
 * One white page of a document at the theme's size and spacing. Needs a `--u`
 * from its container: the preview's scale or the print route's paper width.
 * Right-to-left documents mirror the whole layout, sidebar included.
 */
export function DocumentPage({
  theme,
  paper,
  scale,
  lang,
  dir,
  className,
  label,
  children,
}: {
  theme: ResolvedTheme;
  paper: PaperSize;
  /** How much to compress the spacing and text, to fit fewer pages (Pathfinder); 1 is full size. */
  scale?: number;
  /** The document's language tag, e.g. "fa"; picks Chinese, Japanese or Korean glyphs. */
  lang?: string;
  dir: TextDirection;
  className?: string;
  /** Accessible name, e.g. "Resume" or "Cover letter". */
  label: string;
  children: ReactNode;
}) {
  return (
    <article
      aria-label={label}
      lang={lang}
      dir={dir}
      className={cn(styles.page, themeClasses(theme), className)}
      style={themeStyle(theme, paper, scale)}
    >
      {children}
    </article>
  );
}

/**
 * Draws one unit of a tailored document (APP-4): the element that holds it,
 * with the class the document gives it. `head` is a role's or degree's title
 * line, which isn't the unit's text; `children` shows the text. The preview
 * passes its own renderer, which adds the unit's toolbar and editor (E8-3);
 * printing uses `plainUnit`.
 */
export type UnitRenderer = (unit: { id: string; className?: string; head?: ReactNode; children: ReactNode }) => ReactNode;

/** A unit as printed: a block with its id in `data-unit`. */
export const plainUnit: UnitRenderer = ({ id, className, head, children }) => (
  <div className={className} data-unit={id}>
    {head}
    {children}
  </div>
);

/** A section with a themed title. */
export function DocumentSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      {children}
    </section>
  );
}

/**
 * A contact detail, kept left to right when it has no right-to-left letters
 * (email, phone, web address), so it reads right inside a Persian document.
 */
export function Contact({ children }: { children: string }) {
  return <bdi dir={hasRightToLeft(children) ? undefined : "ltr"}>{children}</bdi>;
}

/** Contact details on one line, separated by "  ·  ". */
export function ContactLine({ items }: { items: string[] }) {
  return (
    <p className={styles.contactLine}>
      {items.map((item, index) => (
        <Fragment key={index}>
          {index > 0 && CONTACT_SEPARATOR}
          <Contact>{item}</Contact>
        </Fragment>
      ))}
    </p>
  );
}
