import { useEffect, useState } from "react";
import { MapPin, Pencil, Trash2, Check, Undo2, Store } from "lucide-react";
import type { Coupon } from "@/lib/native";
import { haptic, openGeo, saveCoupon, searchMap } from "@/lib/native";
import { expiryLabel, expiryState, fmtDate } from "@/lib/search";
import { Badge, Button, Sheet, SheetContent, SheetHeader } from "@/components/ui";
import { CouponForm } from "@/components/CouponForm";

export function CouponSheet({
  coupon,
  places,
  onClose,
  onChanged,
  onDelete,
  startEditing = false,
}: {
  coupon: Coupon | null;
  places: string[];
  onClose: () => void;
  onChanged: (list: Coupon[] | null) => void;
  onDelete: (c: Coupon) => void;
  /** 操作シートの「編集する」から開いたときは最初から編集モード */
  startEditing?: boolean;
}) {
  const [editing, setEditing] = useState(startEditing);
  const [draft, setDraft] = useState<Coupon | null>(coupon);

  useEffect(() => {
    setDraft(coupon);
    setEditing(startEditing);
  }, [coupon, startEditing]);

  if (!coupon || !draft) return null;
  const state = expiryState(coupon);

  const commit = (c: Coupon) => {
    onChanged(saveCoupon({ ...c, updatedAt: Date.now() }));
    haptic();
  };

  return (
    <Sheet open={!!coupon} onOpenChange={(v) => !v && onClose()}>
      <SheetContent title={coupon.store}>
        <SheetHeader eyebrow={coupon.category || "COUPON"} title={editing ? "編集" : coupon.store || "クーポン"} />

        <div className="flex-1 overflow-y-auto px-5 pb-4">
          {editing ? (
            <CouponForm value={draft} onChange={setDraft} places={places} />
          ) : (
            <div className="space-y-5">
              {coupon.photo && (
                <img
                  src={`https://appassets.androidplatform.net/photos/${coupon.photo}.jpg`}
                  alt=""
                  className="w-full rounded-xl border border-line object-contain"
                />
              )}

              <p className="text-[16px] leading-relaxed">{coupon.service}</p>

              <div className="flex flex-wrap gap-1.5">
                <Badge tone="ink">
                  {expiryLabel(coupon)}
                  {coupon.expiry ? ` ・ ${fmtDate(coupon.expiry)}` : ""}
                </Badge>
                {coupon.discount && <Badge tone="ink">{coupon.discount}</Badge>}
                {coupon.chain && <Badge tone="ink">チェーン共通</Badge>}
                {coupon.used && <Badge tone="ink">使用済み</Badge>}
              </div>

              <Row label="管理場所" value={coupon.place || "未設定"} />
              {coupon.notes && <Row label="メモ" value={coupon.notes} />}
              {coupon.conditions && coupon.conditions.length > 0 && (
                <Row label="条件" value={coupon.conditions.join(" / ")} />
              )}
              {coupon.code && <Row label="コード" value={coupon.code} mono />}
              {coupon.address && <Row label="住所" value={coupon.address} />}

              <div className="flex flex-wrap gap-2 pt-1">
                {coupon.lat != null && coupon.lng != null ? (
                  <Button variant="outline" size="sm" onClick={() => openGeo(coupon.lat!, coupon.lng!, coupon.store)}>
                    <MapPin size={14} />
                    地図で開く
                  </Button>
                ) : (
                  coupon.store && (
                    <Button variant="outline" size="sm" onClick={() => searchMap(coupon.store)}>
                      <Store size={14} />
                      店舗を地図で探す
                    </Button>
                  )
                )}
                <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                  <Pencil size={14} />
                  編集
                </Button>
                <Button variant="danger" size="sm" onClick={() => onDelete(coupon)}>
                  <Trash2 size={14} />
                  削除
                </Button>
              </div>
            </div>
          )}
        </div>

        <div
          className="border-t border-line px-5 pt-3"
          style={{ paddingBottom: "calc(var(--safe-bottom) + 12px)" }}
        >
          {editing ? (
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  setDraft(coupon);
                  setEditing(false);
                }}
              >
                取り消す
              </Button>
              <Button
                className="flex-1"
                onClick={() => {
                  commit(draft);
                  setEditing(false);
                }}
              >
                保存
              </Button>
            </div>
          ) : coupon.used ? (
            <Button variant="outline" className="w-full" onClick={() => commit({ ...coupon, used: false })}>
              <Undo2 size={16} />
              使用済みを取り消す
            </Button>
          ) : (
            <Button
              variant={state === "expired" ? "outline" : "default"}
              className="w-full"
              onClick={() => commit({ ...coupon, used: true })}
            >
              <Check size={16} />
              使ったことにする
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="eyebrow mb-1 text-orange/60">{label}</div>
      <p className={`whitespace-pre-wrap text-[14px] leading-relaxed ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}
