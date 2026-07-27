import { useEffect, useRef, useState } from "react";
import { Camera, Images, RotateCcw, Check, Loader2 } from "lucide-react";
import type { Coupon } from "@/lib/native";
import { analyze, haptic, on, pickPhoto, saveCoupon } from "@/lib/native";
import { Button, Sheet, SheetContent, SheetHeader } from "@/components/ui";
import { CouponForm } from "@/components/CouponForm";

type Stage = "choose" | "shooting" | "analyzing" | "review";

const blank = (): Coupon => ({
  id: Math.random().toString(36).slice(2, 12),
  store: "",
  service: "",
  place: "",
  expiry: null,
  notes: "",
  category: "その他",
  conditions: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

export function ScanFlow({
  open,
  onOpenChange,
  places,
  defaultPlace,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  places: string[];
  defaultPlace: string;
  onSaved: (list: Coupon[] | null) => void;
}) {
  const [stage, setStage] = useState<Stage>("choose");
  const [photo, setPhoto] = useState<{ id: string; url: string } | null>(null);
  const [steps, setSteps] = useState<string[]>([]);
  const [draft, setDraft] = useState<Coupon>(blank());
  const [uncertain, setUncertain] = useState<string[]>([]);
  const [question, setQuestion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!open) {
      abort.current?.();
      abort.current = null;
      setStage("choose");
      setPhoto(null);
      setSteps([]);
      setUncertain([]);
      setQuestion(null);
      setError(null);
      setDraft(blank());
    }
  }, [open]);

  useEffect(
    () =>
      on("photo", (p) => {
        if (!open) return;
        if (p.cancelled) {
          setStage("choose");
          return;
        }
        if (p.error) {
          setError(p.error);
          setStage("choose");
          return;
        }
        setPhoto({ id: p.id, url: p.url });
        startAnalyze(p.id, p.url);
      }),
    [open],
  );

  function shoot(mode: "camera" | "gallery") {
    setError(null);
    setStage("shooting");
    pickPhoto(mode);
  }

  function startAnalyze(photoId: string, url: string) {
    setStage("analyzing");
    setSteps(["券面を読み取り中…"]);
    abort.current = analyze(photoId, {
      onTool: (label) => setSteps((s) => [...s.slice(-3), label]),
      onError: (m) => {
        setError(m);
        setDraft({ ...blank(), photo: photoId, place: defaultPlace });
        setStage("review");
      },
      onAnalyzed: (d) => {
        haptic();
        const c: Coupon = {
          ...blank(),
          store: d.store || "",
          branch: d.branch || null,
          service: d.service || "",
          place: d.place || defaultPlace || "",
          expiry: d.expiry || null,
          expiryText: d.expiryText || null,
          notes: d.notes || "",
          category: d.category || "その他",
          discount: d.discount || null,
          conditions: Array.isArray(d.conditions) ? d.conditions : [],
          code: d.code || null,
          address: d.address || null,
          lat: typeof d.lat === "number" ? d.lat : null,
          lng: typeof d.lng === "number" ? d.lng : null,
          chain: !!d.chain,
          photo: photoId,
        };
        setDraft(c);
        setUncertain(Array.isArray(d.uncertain) ? d.uncertain : []);
        setQuestion(d.question || null);
        if (!d.place && !defaultPlace) setUncertain((u) => (u.includes("place") ? u : [...u, "place"]));
        setStage("review");
      },
    });
  }

  function save() {
    const c = { ...draft, updatedAt: Date.now() };
    const list = saveCoupon(c);
    if (!list) return; // 端末側で保存に失敗。シートは閉じずエラーを見せる
    onSaved(list);
    haptic();
    onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent full title="クーポンを追加" className="bg-paper">
        <div style={{ height: "var(--safe-top)" }} />

        {stage === "choose" && (
          <div className="flex flex-1 flex-col px-5">
            <SheetHeader eyebrow="ADD" title="クーポンを取り込む" />
            <div className="mt-2 flex-1">
              {error && <p className="mb-4 text-[13px] text-danger">{error}</p>}
              <p className="mb-6 text-[14px] leading-relaxed text-[var(--muted)]">
                券面全体が入るように撮ってください。店名・サービス内容・期限をまとめて読み取ります。
              </p>
              <div className="space-y-3">
                <Button size="lg" className="w-full" onClick={() => shoot("camera")}>
                  <Camera size={18} />
                  カメラで撮る
                </Button>
                <Button size="lg" variant="outline" className="w-full" onClick={() => shoot("gallery")}>
                  <Images size={18} />
                  写真から選ぶ
                </Button>
                <Button
                  variant="ghost"
                  className="w-full"
                  onClick={() => {
                    setDraft({ ...blank(), place: defaultPlace });
                    setStage("review");
                  }}
                >
                  写真なしで手入力する
                </Button>
              </div>
            </div>
          </div>
        )}

        {stage === "shooting" && (
          <div className="grid flex-1 place-items-center">
            <Loader2 className="animate-spin text-orange/60" />
          </div>
        )}

        {stage === "analyzing" && photo && (
          <div className="flex flex-1 flex-col items-center justify-center px-6">
            <div className="relative w-full max-w-[320px] overflow-hidden rounded-2xl border border-line bg-card shadow-[0_8px_30px_rgba(43,22,8,.10)]">
              <img src={photo.url} alt="" className="w-full" />
              <div className="reticle absolute inset-3">
                <span />
                <span />
                <span />
                <span />
              </div>
              <div className="sweep pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-orange shadow-[0_0_18px_5px_rgba(242,87,13,.45)]" />
            </div>
            <div className="mt-8 h-24 w-full max-w-[320px] space-y-1.5">
              {steps.map((s, i) => (
                <p
                  key={i}
                  className={`rise font-mono text-[12px] ${
                    i === steps.length - 1 ? "breathe text-orange" : "text-[var(--muted)]"
                  }`}
                >
                  {s}
                </p>
              ))}
            </div>
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              中止する
            </Button>
          </div>
        )}

        {stage === "review" && (
          <>
            <SheetHeader eyebrow="CHECK" title="内容を確認" />
            <div className="flex-1 overflow-y-auto px-5 pb-4">
              {error && <p className="mb-3 text-[13px] text-danger">{error}（手入力してください）</p>}
              {question && (
                <div className="mb-4 rounded-xl border border-amber/30 bg-amber/10 px-3.5 py-3 text-[13px] leading-relaxed text-amber">
                  {question}
                </div>
              )}
              {photo && (
                <div className="mb-5 flex items-center gap-3">
                  <img src={photo.url} alt="" className="h-16 w-16 rounded-lg object-cover" />
                  <Button variant="ghost" size="sm" onClick={() => shoot("camera")}>
                    <RotateCcw size={14} />
                    撮り直す
                  </Button>
                </div>
              )}
              <CouponForm value={draft} onChange={setDraft} places={places} uncertain={uncertain} stagger />
            </div>
            <div
              className="border-t border-line bg-paper px-5 pt-3"
              style={{ paddingBottom: "calc(var(--safe-bottom) + 12px)" }}
            >
              <Button size="lg" className="w-full" disabled={!draft.store && !draft.service} onClick={save}>
                <Check size={18} />
                この内容で保存
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
