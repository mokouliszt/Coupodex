import { MapPin, Clock3, Archive, Sparkles, MoreHorizontal } from "lucide-react";
import type { Coupon, Fix } from "@/lib/native";
import { distanceLabel, distanceM, expiryLabel, expiryState, fmtDate } from "@/lib/search";
import { Badge } from "@/components/ui";
import { useLongPress } from "@/lib/useLongPress";
import { cn } from "@/lib/utils";

const TONE: Record<string, { badge: "neutral" | "orange" | "amber" | "danger"; dot: string }> = {
  none: { badge: "neutral", dot: "bg-ink/25" },
  ok: { badge: "orange", dot: "bg-orange" },
  month: { badge: "orange", dot: "bg-orange" },
  soon: { badge: "amber", dot: "bg-amber" },
  today: { badge: "amber", dot: "bg-amber" },
  expired: { badge: "danger", dot: "bg-spent" },
};

export function TicketCard({
  coupon,
  fix,
  onClick,
  onActions,
  index = 0,
}: {
  coupon: Coupon;
  fix: Fix | null;
  onClick: () => void;
  /** 長押し / ⋯ から操作シートを開く */
  onActions?: (c: Coupon) => void;
  index?: number;
}) {
  const { holding, handlers } = useLongPress(() => onActions?.(coupon), onClick);
  const state = expiryState(coupon);
  const dead = state === "expired" || coupon.used;
  const tone = TONE[state];
  const dist = distanceM(fix, coupon);

  return (
    <article
      {...(onActions ? handlers : { onClick })}
      style={{ animationDelay: `${Math.min(index, 8) * 28}ms` } as any}
      className={cn(
        "ticket rise cursor-pointer select-none transition-transform duration-150",
        holding ? "scale-[.975]" : "active:scale-[.985]",
        dead && "opacity-70 grayscale-[.55]",
      )}
    >
      <div className="flex gap-3 p-4 pb-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex items-center gap-2">
            <span className={cn("h-1.5 w-1.5 rounded-full", tone.dot)} />
            <span className="eyebrow text-ink/45">{coupon.category || "クーポン"}</span>
            {coupon.chain && <span className="eyebrow text-ink/30">CHAIN</span>}
          </div>
          <h3 className="truncate text-[17px] font-bold leading-tight tracking-tight">
            {coupon.store || "店舗名なし"}
            {coupon.branch ? <span className="ml-1 text-[13px] font-medium opacity-60">{coupon.branch}</span> : null}
          </h3>
          <p className="mt-1 line-clamp-2 text-[13.5px] leading-snug text-ink/72">{coupon.service}</p>
          {coupon.discount && (
            <div className="mt-2 inline-flex items-center gap-1 font-mono text-[13px] font-bold text-orange">
              <Sparkles size={12} className="text-[#fdbf1f]" />
              {coupon.discount}
            </div>
          )}
        </div>

        {coupon.photo && (
          <div className="relative h-[62px] w-[62px] shrink-0 overflow-hidden rounded-lg bg-ink/[.06]">
            <img
              src={`https://appassets.androidplatform.net/photos/${coupon.photo}.jpg`}
              alt=""
              className="h-full w-full object-cover"
              loading="lazy"
            />
          </div>
        )}
      </div>

      {/* 半券 */}
      <div className="stub flex items-center gap-2 px-4 py-2.5 text-[12px]">
        <Badge tone={tone.badge} className="gap-1">
          <Clock3 size={11} />
          {expiryLabel(coupon)}
        </Badge>
        {coupon.expiry && <span className="font-mono text-[11px] text-ink/40">{fmtDate(coupon.expiry)}</span>}
        <span className="flex-1" />
        {dist != null && (
          <span className="flex items-center gap-1 font-mono text-[11px] text-orange">
            <MapPin size={11} />
            {distanceLabel(dist)}
          </span>
        )}
        {coupon.place && (
          <span className="flex min-w-0 max-w-[38%] items-center gap-1 text-ink/55">
            <Archive size={11} className="shrink-0" />
            <span className="truncate">{coupon.place}</span>
          </span>
        )}
        {onActions && (
          <button
            aria-label="このクーポンの操作"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onActions(coupon);
            }}
            className="-mr-1.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-ink/40 active:bg-ink/[.06]"
          >
            <MoreHorizontal size={16} />
          </button>
        )}
      </div>

      {dead && (
        <div className="pointer-events-none absolute right-4 top-4 z-[3]">
          <span className="stamp text-[10px] text-spent">{coupon.used ? "USED" : "EXPIRED"}</span>
        </div>
      )}
    </article>
  );
}
