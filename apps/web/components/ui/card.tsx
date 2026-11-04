import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("rounded-lg border border-slate-200 bg-white p-5 shadow-sm", className)} {...props} />;
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function Alert({
  tone = "info",
  className,
  ...props
}: ComponentProps<"div"> & { tone?: "info" | "error" | "success" }) {
  const tones = {
    info: "border-brand-100 bg-brand-50 text-brand-800",
    error: "border-red-200 bg-red-50 text-red-800",
    success: "border-green-200 bg-green-50 text-green-800",
  };
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("rounded-md border px-4 py-3 text-sm", tones[tone], className)}
      {...props}
    />
  );
}
