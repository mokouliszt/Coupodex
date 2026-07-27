import { Check, Pencil, MapPin, Share2, Trash2, Undo2 } from "lucide-react";
import type { Coupon } from "@/lib/native";
import { openGeo, searchMap, share } from "@/lib/native";
import { expiryLabel } from "@/lib/search";
import { Sheet, SheetContent, SheetClose } from "@/components/ui";

/**
 * カードの長押し / ⋯ ボタンから開く操作シート。
 * 削除は確認を挟まず即座に消し、スナックバーから取り消せるようにしている。
 */
export function CardActions({
  coupon,
  onClose,
  onEdit,
  onToggleUsed,
  onDelete,
}: {
  coupon: Coupon | null;
  onClose: () => void;
  onEdit: (c: Coupon) => void;
  onToggleUsed: (c: Coupon) => void;
  onDelete: (c: Coupon) => void;
}) {
  if (!coupon) return null;
  const c = coupon;
  const hasCoords = c.lat != null && c.lng != null;

  return (
    <Sheet open onOpenChange={(v) => !v && onClose()}>
      <SheetContent title={c.store} className="pb-2">
        <header className="px-5 pb-3 pt-4">
          <div className="eyebrow mb-1 text-orange/70">{c.category || "COUPON"}</div>
          <h2 className="truncate text-[18px] font-semibold tracking-tight">{c.store || "クーポン"}</h2>
          <p className="mt-0.5 truncate text-[13px] text-[var(--muted)]">
            {c.service} ・ {expiryLabel(c)}
          </p>
        </header>

        <div
          className="border-t border-line pt-1"
          style={{ paddingBottom: "calc(var(--safe-bottom) + 8px)" }}
        >
          <Action
            icon={c.used ? <Undo2 size={18} /> : <Check size={18} />}
            label={c.used ? "使用済みを取り消す" : "使ったことにする"}
            onClick={() => onToggleUsed(c)}
          />
          <Action icon={<Pencil size={18} />} label="編集する" onClick={() => onEdit(c)} />
          <Action
            icon={<MapPin size={18} />}
            label={hasCoords ? "地図で開く" : "店舗を地図で探す"}
            disabled={!hasCoords && !c.store}
            onClick={() => {
              if (hasCoords) openGeo(c.lat!, c.lng!, c.store);
              else searchMap(c.store);
              onClose();
            }}
          />
          <Action
            icon={<Share2 size={18} />}
            label="共有する"
            onClick={() => {
              share(
                [c.store, c.service, c.expiry ? `期限 ${c.expiry}` : null, c.place ? `保管 ${c.place}` : null]
                  .filter(Boolean)
                  .join("\n"),
              );
              onClose();
            }}
          />
          <Action icon={<Trash2 size={18} />} label="削除する" danger onClick={() => onDelete(c)} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Action({
  icon,
  label,
  onClick,
  danger,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}) {
  return (
    <SheetClose asChild>
      <button
        disabled={disabled}
        onClick={onClick}
        className={`flex w-full items-center gap-3.5 px-5 py-3.5 text-left text-[15px] active:bg-orange/[.07] disabled:opacity-40 ${
          danger ? "text-danger" : "text-ink"
        }`}
      >
        <span className={danger ? "text-danger" : "text-orange"}>{icon}</span>
        {label}
      </button>
    </SheetClose>
  );
}
