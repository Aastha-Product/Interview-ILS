"use client";

import { Button } from "@/components/ui/button";

/** "Save as PDF": the browser's print dialog, where the results can be saved as a PDF or printed. */
export function PrintButton() {
  return (
    <Button variant="secondary" onClick={() => window.print()}>
      Save as PDF
    </Button>
  );
}
