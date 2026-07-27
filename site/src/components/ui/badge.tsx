import * as React from "react";
import { cn } from "@/lib/utils";

export function Badge({
  className,
  tone = "orange",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: "orange" | "plain" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-medium",
        tone === "orange" ? "bg-orange/10 text-orange" : "border border-line bg-white text-ink/60",
        className,
      )}
      {...props}
    />
  );
}
