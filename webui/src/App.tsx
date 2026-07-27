import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  Settings2,
  Crosshair,
  ScanLine,
  Sparkles,
  Ticket,
  MessageSquare,
  X,
  LogOut,
  Loader2,
} from "lucide-react";
import type { Coupon, Fix, NativeState } from "@/lib/native";
import {
  getState,
  listCoupons,
  locate,
  login,
  logout,
  on,
  saveSettings,
  haptic,
  deleteCoupon,
  saveCoupon,
  setBridgeErrorHandler,
} from "@/lib/native";
import { distanceM, expiryState, match, daysLeft } from "@/lib/search";
import { useKeyboard } from "@/lib/viewport";
import { cn } from "@/lib/utils";
import {
  Button,
  Chip,
  Input,
  Sheet,
  SheetContent,
  SheetHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Label,
} from "@/components/ui";
import { TicketCard } from "@/components/TicketCard";
import { ScanFlow } from "@/components/ScanFlow";
import { CouponSheet } from "@/components/CouponSheet";
import { ChatPanel } from "@/components/ChatPanel";
import { CardActions } from "@/components/CardActions";
import { Toast } from "@/components/Toast";

type Filter = "all" | "usable" | "soon" | "near" | "used";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "すべて" },
  { key: "usable", label: "使える" },
  { key: "soon", label: "まもなく" },
  { key: "near", label: "近く" },
  { key: "used", label: "使用済み・期限切れ" },
];

export default function App() {
  const [state, setState] = useState<NativeState>(() => getState());
  const [coupons, setCoupons] = useState<Coupon[]>(() => listCoupons());
  const [tab, setTab] = useState<"list" | "chat">("list");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [fix, setFix] = useState<Fix | null>(null);
  const [locating, setLocating] = useState(false);
  const [scan, setScan] = useState(false);
  const [selected, setSelected] = useState<Coupon | null>(null);
  const [editIntent, setEditIntent] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [menuFor, setMenuFor] = useState<Coupon | null>(null);
  const [notice, setNotice] = useState<{ text: string; undo?: () => void } | null>(null);
  // 削除は即座に画面から消し、取り消し期限が切れてから端末へ反映する（写真も戻せる）
  const [pendingDelete, setPendingDelete] = useState<Coupon | null>(null);
  const pendingRef = useRef<Coupon | null>(null);
  const keyboard = useKeyboard();

  useEffect(() => on("auth", () => setState(getState())), []);
  useEffect(() => {
    setBridgeErrorHandler((m) => setNotice({ text: m }));
    return () => setBridgeErrorHandler(null);
  }, []);
  useEffect(
    () =>
      on("location", (p) => {
        setLocating(false);
        if (typeof p.lat === "number") {
          setFix(p);
          return;
        }
        setNotice({
          text: p.denied ? "位置情報の利用が許可されていません" : "現在地を取得できませんでした",
        });
      }),
    [],
  );

  const refresh = (list: Coupon[] | null) => {
    if (!list) return; // 端末側で失敗。画面は書き換えず、エラーだけ出す
    setCoupons(list);
    setState(getState());
    setSelected((cur) => (cur ? list.find((c) => c.id === cur.id) || null : null));
  };

  /** 保留中の削除を端末へ確定させる */
  const commitDelete = useCallback(() => {
    const p = pendingRef.current;
    if (!p) return;
    pendingRef.current = null;
    setPendingDelete(null);
    const list = deleteCoupon(p.id);
    if (list) {
      setCoupons(list);
      setState(getState());
    }
  }, []);

  /** 画面から消して、取り消せる状態にする */
  const requestDelete = (c: Coupon) => {
    commitDelete(); // 直前の保留があれば先に確定
    pendingRef.current = c;
    setPendingDelete(c);
    setMenuFor(null);
    setSelected(null);
    haptic();
    setNotice({
      text: `「${c.store || "クーポン"}」を削除しました`,
      undo: () => {
        pendingRef.current = null;
        setPendingDelete(null);
        setNotice(null);
      },
    });
  };

  const toggleUsed = (c: Coupon) => {
    refresh(saveCoupon({ ...c, used: !c.used, updatedAt: Date.now() }));
    setMenuFor(null);
    haptic();
  };

  // 画面を離れるときは保留を確定させる
  useEffect(() => commitDelete, [commitDelete]);

  const askLocation = () => {
    setLocating(true);
    locate();
  };

  const visible = useMemo(() => {
    const radius = state.settings.radius || 500;
    let list = coupons.filter((c) => {
      if (pendingDelete && c.id === pendingDelete.id) return false;
      const st = expiryState(c);
      const dead = st === "expired" || c.used;
      if (filter === "used") return dead;
      if (filter === "all") return true; // 「すべて」は文字どおり全部（並びで後ろに送る）
      if (dead) return false;
      if (filter === "soon") {
        const d = daysLeft(c.expiry);
        return d !== null && d <= 14;
      }
      if (filter === "near") {
        const m = distanceM(fix, c);
        return m !== null ? m <= radius : !!c.chain;
      }
      return true;
    });
    if (query.trim()) {
      list = list
        .map((c) => ({ c, s: match(query, c) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .map((x) => x.c);
      return list;
    }
    if (filter === "near" && fix) {
      return [...list].sort((a, b) => (distanceM(fix, a) ?? 9e9) - (distanceM(fix, b) ?? 9e9));
    }
    const isDead = (c: Coupon) => c.used || expiryState(c) === "expired";
    return [...list].sort((a, b) => {
      // 使えないものは常に末尾へ
      if (isDead(a) !== isDead(b)) return isDead(a) ? 1 : -1;
      const da = daysLeft(a.expiry);
      const db = daysLeft(b.expiry);
      if (da === null && db === null) return b.createdAt - a.createdAt;
      if (da === null) return 1;
      if (db === null) return -1;
      return da - db;
    });
  }, [coupons, query, filter, fix, state.settings.radius, pendingDelete]);

  if (!state.loggedIn) return <Login />;

  const alive = coupons.filter((c) => c.id !== pendingDelete?.id);
  const live = alive.filter((c) => !c.used && expiryState(c) !== "expired").length;

  return (
    <div className="flex flex-col bg-paper" style={{ height: "var(--vh, 100%)" }}>
      <header style={{ paddingTop: "calc(var(--safe-top) + 10px)" }} className="px-5 pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-2.5">
            <span className="eyebrow text-orange">COUPODEX</span>
            <span className="font-mono text-[12px] text-[var(--muted)]">
              {live}
              <span className="opacity-50"> / {alive.length} 枚</span>
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={askLocation}
              aria-label="現在地を更新"
              className={`grid h-9 w-9 place-items-center rounded-full ${fix ? "text-orange" : "text-[var(--muted)]"}`}
            >
              {locating ? <Loader2 size={17} className="animate-spin" /> : <Crosshair size={17} />}
            </button>
            <button
              onClick={() => setSettingsOpen(true)}
              aria-label="設定"
              className="grid h-9 w-9 place-items-center rounded-full text-[var(--muted)]"
            >
              <Settings2 size={17} />
            </button>
          </div>
        </div>
      </header>

      {/* 両方マウントしたままにする。切り替えで会話とスクロール位置を失わないため */}
      <div className={cn("flex min-h-0 flex-1 flex-col", tab !== "list" && "hidden")}>
        <>
          <div className="px-5 pb-2 pt-1">
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 opacity-40" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="店名・サービス・しまい場所で探す"
                className="pl-10 pr-10"
                inputMode="search"
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  aria-label="検索を消す"
                  className="absolute right-2.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full bg-ink/[.06]"
                >
                  <X size={13} />
                </button>
              )}
            </div>
            <div className="mt-2.5 flex gap-1.5 overflow-x-auto pb-1">
              {FILTERS.map((f) => (
                <Chip
                  key={f.key}
                  active={filter === f.key}
                  onClick={() => {
                    setFilter(f.key);
                    if (f.key === "near" && !fix) askLocation();
                  }}
                >
                  {f.label}
                </Chip>
              ))}
            </div>
          </div>

          <div className="flex-1 space-y-3.5 overflow-y-auto px-5 pb-6 pt-2">
            {visible.length === 0 ? (
              <Empty
                query={query}
                filter={filter}
                hasFix={!!fix}
                total={alive.length}
                onScan={() => setScan(true)}
                onLocate={askLocation}
              />
            ) : (
              visible.map((c, i) => (
                <TicketCard
                  key={c.id}
                  coupon={c}
                  fix={fix}
                  index={i}
                  onClick={() => {
                    setEditIntent(false);
                    setSelected(c);
                  }}
                  onActions={setMenuFor}
                />
              ))
            )}
          </div>
        </>
      </div>
      <div className={cn("flex min-h-0 flex-1 flex-col", tab !== "chat" && "hidden")}>
        <ChatPanel
          coupons={alive}
          fix={fix}
          onOpenCoupon={(c) => {
            setEditIntent(false);
            setSelected(c);
          }}
          onNeedLocation={() => setLocating(true)}
        />
      </div>

      {/* 入力中はタブバーを畳んで、入力欄に高さを譲る */}
      {!keyboard && (
        <nav
          className="flex items-center justify-around border-t border-line bg-paper px-6 py-2"
          style={{ paddingBottom: "calc(var(--safe-bottom) + 8px)" }}
        >
          <TabButton icon={<Ticket size={19} />} label="クーポン" active={tab === "list"} onClick={() => setTab("list")} />
          <button
            onClick={() => {
              haptic();
              setScan(true);
            }}
            aria-label="クーポンをスキャン"
            className="relative grid h-[52px] w-[52px] shrink-0 place-items-center rounded-2xl bg-orange text-white shadow-[0_6px_18px_rgba(242,87,13,.34)] transition-transform active:scale-95"
          >
            <ScanLine size={23} strokeWidth={2.4} />
            <Sparkles size={12} className="absolute -right-1 -top-1 text-amber" fill="currentColor" />
          </button>
          <TabButton
            icon={<MessageSquare size={19} />}
            label="AIに聞く"
            active={tab === "chat"}
            onClick={() => setTab("chat")}
          />
        </nav>
      )}

      <ScanFlow
        open={scan}
        onOpenChange={setScan}
        places={state.places}
        defaultPlace={state.settings.defaultPlace}
        onSaved={refresh}
      />
      <CouponSheet
        coupon={selected}
        places={state.places}
        onClose={() => {
          setSelected(null);
          setEditIntent(false);
        }}
        onChanged={refresh}
        onDelete={requestDelete}
        startEditing={editIntent}
      />
      <CardActions
        coupon={menuFor}
        onClose={() => setMenuFor(null)}
        onEdit={(c) => {
          setMenuFor(null);
          setEditIntent(true);
          setSelected(c);
        }}
        onToggleUsed={toggleUsed}
        onDelete={requestDelete}
      />
      {notice && (
        <Toast
          message={notice.text}
          actionLabel={notice.undo ? "元に戻す" : undefined}
          onAction={notice.undo}
          onExpire={() => {
            setNotice(null);
            commitDelete();
          }}
          lifted={!keyboard}
        />
      )}
      <SettingsSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        state={state}
        onSaved={() => setState(getState())}
        count={coupons.length}
      />
    </div>
  );
}

function TabButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-24 flex-col items-center gap-1 py-1 transition-colors ${
        active ? "text-orange" : "text-[var(--faint)]"
      }`}
    >
      {icon}
      <span className="text-[10.5px] font-medium">{label}</span>
    </button>
  );
}

function Empty({
  query,
  filter,
  hasFix,
  total,
  onScan,
  onLocate,
}: {
  query: string;
  filter: Filter;
  hasFix: boolean;
  total: number;
  onScan: () => void;
  onLocate: () => void;
}) {
  if (total === 0)
    return (
      <div className="pt-16 text-center">
        <div className="reticle relative mx-auto mb-7 h-24 w-36">
          <span />
          <span />
          <span />
          <span />
          <div className="absolute inset-x-5 inset-y-4 rounded-md border border-line bg-card shadow-sm" />
        </div>
        <h2 className="text-[19px] font-bold tracking-tight">まだ1枚もありません</h2>
        <p className="mx-auto mt-2 max-w-[260px] text-[14px] leading-relaxed text-[var(--muted)]">
          グローブボックスや財布の中の紙クーポンを、下のボタンから撮ってみてください。
        </p>
        <Button className="mt-6" onClick={onScan}>
          <ScanLine size={17} />
          最初の1枚を読み取る
        </Button>
      </div>
    );

  if (query)
    return (
      <p className="pt-16 text-center text-[14px] text-[var(--muted)]">
        「{query}」に近いクーポンはありません。
        <br />
        AIタブなら言い回しを変えて探せます。
      </p>
    );

  if (filter === "near")
    return (
      <div className="pt-16 text-center">
        <p className="text-[14px] leading-relaxed text-[var(--muted)]">
          {hasFix ? "この距離では見つかりません。半径は設定で変えられます。" : "現在地がまだ取れていません。"}
        </p>
        {!hasFix && (
          <Button variant="outline" size="sm" className="mt-4" onClick={onLocate}>
            <Crosshair size={14} />
            現在地を取得
          </Button>
        )}
      </div>
    );

  return (
    <p className="pt-16 text-center text-[14px] text-[var(--muted)]">
      {filter === "soon" ? "2週間以内に切れるクーポンはありません。" : "該当するクーポンはありません。"}
    </p>
  );
}

function SettingsSheet({
  open,
  onOpenChange,
  state,
  onSaved,
  count,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  state: NativeState;
  onSaved: () => void;
  count: number;
}) {
  const [s, setS] = useState(state.settings);
  // 開いた時だけ現在値を取り込む。state.settings は毎回別オブジェクトなので、
  // 依存に入れると入力途中で値が巻き戻る。
  useEffect(() => {
    if (open) setS(state.settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const put = (patch: Partial<typeof s>) => {
    const next = { ...s, ...patch };
    setS(next);
    saveSettings(next);
    onSaved();
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title="設定">
        <SheetHeader eyebrow="SETTINGS" title="設定" />
        <div className="flex-1 space-y-5 overflow-y-auto px-5 pb-8">
          <div>
            <Label>読み取り・検索に使うモデル</Label>
            <div className="mt-1.5">
              <Select value={s.model} onValueChange={(v) => put({ model: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {state.models.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>思考の深さ</Label>
            <div className="mt-1.5">
              <Select value={s.effort} onValueChange={(v) => put({ effort: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {state.efforts.map((e) => (
                    <SelectItem key={e} value={e}>
                      {e}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--muted)]">
              xhigh・max は gpt-5.6 系のみ。低いほど速く、高いほど読み取り精度が上がります。
            </p>
          </div>

          <div>
            <Label>「近く」とみなす距離</Label>
            <div className="mt-2 flex gap-1.5">
              {[200, 500, 1000, 3000].map((r) => (
                <Chip key={r} active={s.radius === r} onClick={() => put({ radius: r })}>
                  {r < 1000 ? `${r}m` : `${r / 1000}km`}
                </Chip>
              ))}
            </div>
          </div>

          <div>
            <Label>既定の管理場所</Label>
            <div className="mt-1.5">
              <Input
                value={s.defaultPlace}
                onChange={(e) => setS({ ...s, defaultPlace: e.target.value })}
                onBlur={() => put({ defaultPlace: s.defaultPlace })}
                placeholder="例）車のグローブボックス"
              />
            </div>
            <p className="mt-1.5 text-[12px] text-[var(--muted)]">
              読み取り時、しまい場所の初期値として使います。
            </p>
          </div>

          <div className="rounded-xl border border-line p-4">
            <div className="eyebrow mb-2 text-orange/60">DATA</div>
            <p className="text-[13px] leading-relaxed text-[var(--muted)]">
              クーポン{count}枚と写真は、この端末の中だけに保存されています。
              解析と検索はあなたのChatGPTアカウントで実行されます。
            </p>
            <Button
              variant="danger"
              size="sm"
              className="mt-3"
              onClick={() => {
                logout();
                onOpenChange(false);
              }}
            >
              <LogOut size={14} />
              ChatGPTからログアウト
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Login() {
  const [busy, setBusy] = useState(false);
  return (
    <div
      className="relative flex flex-col justify-between overflow-hidden bg-paper px-7"
      style={{ height: "var(--vh, 100%)" }}
    >
      {/* 地の右上に淡いオレンジのにじみ。白の中にオレンジが一滴落ちた状態 */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full"
        style={{ background: "radial-gradient(closest-side, rgba(242,87,13,.16), transparent)" }}
      />
      <div style={{ height: "calc(var(--safe-top) + 8px)" }} />

      <div className="relative flex flex-1 flex-col justify-center">
        <div className="reticle relative mx-auto mb-10 h-[132px] w-[190px]">
          <span />
          <span />
          <span />
          <span />
          <div className="ticket absolute inset-x-5 inset-y-6" style={{ ["--notch" as any]: "34px" }}>
            <div className="flex h-full flex-col justify-between">
              <div className="space-y-1.5 p-3">
                <div className="h-1.5 w-14 rounded-full bg-orange" />
                <div className="h-1.5 w-20 rounded-full bg-ink/15" />
              </div>
              <div className="stub p-3">
                <div className="h-1.5 w-12 rounded-full bg-orange/40" />
              </div>
            </div>
          </div>
          <div className="sweep pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-orange shadow-[0_0_16px_4px_rgba(242,87,13,.4)]" />
          <Sparkles size={18} className="absolute -right-2 -top-2 text-amber" fill="currentColor" />
        </div>

        <h1 className="text-[27px] font-bold leading-[1.3] tracking-tight">
          紙のクーポン、
          <br />
          <span className="text-orange">全部ここに。</span>
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-[var(--muted)]">
          撮るだけで、店名・サービス内容・使用期限・しまい場所まで読み取ります。
          あとは「この辺で使えるやつある?」と聞くだけ。
        </p>
      </div>

      <div className="relative" style={{ paddingBottom: "calc(var(--safe-bottom) + 20px)" }}>
        <Button
          size="lg"
          className="w-full"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            login();
            setTimeout(() => setBusy(false), 4000);
          }}
        >
          {busy ? <Loader2 size={18} className="animate-spin" /> : null}
          ChatGPTでログイン
        </Button>
        <p className="mt-3.5 text-center text-[12px] leading-relaxed text-[var(--faint)]">
          読み取りと検索は、あなたのChatGPTサブスクリプションで動きます。
          <br />
          クーポンと写真は端末内だけに保存されます。
        </p>
      </div>
    </div>
  );
}
