"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/Button";

/** Opens the browser's print dialog (docs/build/design/C05.md, Surface 3). */
export function PrintButton() {
  return (
    <Button
      variant="primary"
      icon={Printer}
      block
      className="justify-center"
      onClick={() => window.print()}
    >
      Print
    </Button>
  );
}
