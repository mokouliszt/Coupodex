import { useState } from "react";
import { ChevronDown, MapPin, AlertCircle } from "lucide-react";
import type { Coupon } from "@/lib/native";
import { openGeo } from "@/lib/native";
import { addMonthsISO, endOfMonthISO } from "@/lib/search";
import { Input, Textarea, Label, Chip, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui";
import { cn } from "@/lib/utils";

const CATEGORIES = ["飲食", "小売", "美容", "レジャー", "カー用品", "交通", "医療", "その他"];

export function CouponForm({
  value,
  onChange,
  places,
  uncertain = [],
  stagger = false,
}: {
  value: Coupon;
  onChange: (c: Coupon) => void;
  places: string[];
  uncertain?: string[];
  stagger?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const set = (patch: Partial<Coupon>) => onChange({ ...value, ...patch });
  const flag = (k: string) => uncertain.includes(k);

  const rows: { key: string; node: React.ReactNode }[] = [
    {
      key: "store",
      node: (
        <Field label="店舗・企業名" flagged={flag("store")}>
          <Input
            value={value.store}
            onChange={(e) => set({ store: e.target.value })}
            placeholder="例）サイゼリヤ 名駅店"
          />
        </Field>
      ),
    },
    {
      key: "service",
      node: (
        <Field label="サービス内容" flagged={flag("service")}>
          <Textarea
            rows={2}
            value={value.service}
            onChange={(e) => set({ service: e.target.value })}
            placeholder="例）ドリンクバー1杯無料"
          />
        </Field>
      ),
    },
    {
      key: "place",
      node: (
        <Field label="管理場所" flagged={flag("place")}>
          <Input
            value={value.place}
            onChange={(e) => set({ place: e.target.value })}
            placeholder="例）車のグローブボックス"
          />
          {places.length > 0 && (
            <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5">
              {places.slice(0, 8).map((p) => (
                <Chip key={p} active={value.place === p} onClick={() => set({ place: p })}>
                  {p}
                </Chip>
              ))}
            </div>
          )}
        </Field>
      ),
    },
    {
      key: "expiry",
      node: (
        <Field label="使用期限" flagged={flag("expiry")}>
          <div className="flex gap-2">
            <Input
              type="date"
              value={value.expiry || ""}
              onChange={(e) => set({ expiry: e.target.value || null })}
              className="flex-1"
            />
          </div>
          <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5">
            <Chip onClick={() => set({ expiry: endOfMonthISO() })}>今月末</Chip>
            <Chip onClick={() => set({ expiry: addMonthsISO(1) })}>1ヶ月後</Chip>
            <Chip onClick={() => set({ expiry: addMonthsISO(3) })}>3ヶ月後</Chip>
            <Chip active={!value.expiry} onClick={() => set({ expiry: null })}>
              期限なし
            </Chip>
          </div>
          {value.expiryText && (
            <p className="mt-2 font-mono text-[11px] text-[var(--muted)]">券面表記: {value.expiryText}</p>
          )}
        </Field>
      ),
    },
    {
      key: "notes",
      node: (
        <Field label="その他メモ" flagged={flag("notes")}>
          <Textarea
            rows={3}
            value={value.notes}
            onChange={(e) => set({ notes: e.target.value })}
            placeholder="利用条件・注意書きなど"
          />
        </Field>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {rows.map((r, i) => (
        <div
          key={r.key}
          className={cn(stagger && "rise")}
          style={stagger ? ({ animationDelay: `${i * 90}ms` } as any) : undefined}
        >
          {r.node}
        </div>
      ))}

      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-xl border border-line px-3.5 py-3 text-[13px] text-[var(--muted)]"
      >
        詳細（カテゴリ・割引・店舗情報）
        <ChevronDown size={15} className={cn("transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="space-y-4 rise">
          <Field label="カテゴリ">
            <Select value={value.category || "その他"} onValueChange={(v) => set({ category: v })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="割引の要点">
            <Input
              value={value.discount || ""}
              onChange={(e) => set({ discount: e.target.value })}
              placeholder="例）10%OFF"
            />
          </Field>
          <Field label="支店名">
            <Input value={value.branch || ""} onChange={(e) => set({ branch: e.target.value })} />
          </Field>
          <Field label="クーポンコード">
            <Input value={value.code || ""} onChange={(e) => set({ code: e.target.value })} />
          </Field>
          <Field label="店舗住所">
            <Input
              value={value.address || ""}
              onChange={(e) => set({ address: e.target.value })}
              placeholder="近くの店を探すときに使います"
            />
            {value.lat != null && value.lng != null && (
              <button
                onClick={() => openGeo(value.lat!, value.lng!, value.store)}
                className="mt-2 inline-flex items-center gap-1 font-mono text-[12px] text-orange"
              >
                <MapPin size={12} />
                {value.lat.toFixed(5)}, {value.lng.toFixed(5)} を地図で開く
              </button>
            )}
          </Field>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  flagged,
  children,
}: {
  label: string;
  flagged?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <Label>{label}</Label>
        {flagged && (
          <span className="inline-flex items-center gap-1 rounded-md bg-amber/20 px-1.5 py-0.5 text-[10px] font-medium text-amber">
            <AlertCircle size={10} />
            要確認
          </span>
        )}
      </div>
      {children}
    </div>
  );
}
