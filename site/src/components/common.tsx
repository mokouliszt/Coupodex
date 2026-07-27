import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const REPO = "https://github.com/mokouliszt/Coupodex";
export const APK = `${REPO}/releases/download/v1.0.3/Coupodex-1.0.3.apk`;
export const RELEASES = `${REPO}/releases`;
export const VERSION = "v1.0.3";

/** `/Coupodex/` 配下に置かれるので、画像はすべて BASE_URL 起点で解決する */
export const asset = (p: string) => `${import.meta.env.BASE_URL}${p}`;

export function Section({
  id,
  eyebrow,
  title,
  lead,
  children,
  className,
}: {
  id?: string;
  eyebrow?: string;
  title?: ReactNode;
  lead?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cn("px-5 py-20 md:py-28", className)}>
      <div className="mx-auto max-w-content">
        {(eyebrow || title) && (
          <header className="mb-12 md:mb-16">
            {eyebrow && <div className="eyebrow mb-3 text-orange">{eyebrow}</div>}
            {title && (
              <h2 className="text-[27px] font-black leading-[1.35] tracking-tight md:text-[36px]">{title}</h2>
            )}
            {lead && <p className="mt-4 max-w-2xl text-[15px] leading-[1.9] text-ink/60 md:text-[16px]">{lead}</p>}
          </header>
        )}
        {children}
      </div>
    </section>
  );
}

/** 端末の枠に入れたスクリーンショット */
export function Phone({
  src,
  alt,
  className,
  priority,
}: {
  src: string;
  alt: string;
  className?: string;
  priority?: boolean;
}) {
  return (
    <div className={cn("phone w-full max-w-[268px] sm:max-w-[290px]", className)}>
      <img
        src={asset(src)}
        alt={alt}
        width={720}
        height={1559}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        className="w-full"
      />
    </div>
  );
}
