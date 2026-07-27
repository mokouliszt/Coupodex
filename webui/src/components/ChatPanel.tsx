import { useEffect, useRef, useState } from "react";
import { ArrowUp, Crosshair, Square, Sparkles, RotateCcw, AlertCircle } from "lucide-react";
import type { Coupon, Fix } from "@/lib/native";
import { chat, haptic, locate } from "@/lib/native";
import { Button, Chip, Textarea } from "@/components/ui";
import { TicketCard } from "@/components/TicketCard";
import { Markdown } from "@/components/Markdown";

interface Turn {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS = [
  "この辺で使えるやつある?",
  "今週で切れるのは?",
  "昼メシを安くしたい",
  "車まわりのクーポン見せて",
];

/** 応答末尾の ```coupons [...] ``` を取り出して本文と分離する。 */
function split(content: string): { text: string; ids: string[] } {
  const m = content.match(/```coupons\s*([\s\S]*?)```/);
  if (!m) return { text: content.replace(/```coupons[\s\S]*$/, "").trim(), ids: [] };
  let ids: string[] = [];
  try {
    ids = JSON.parse(m[1].trim());
  } catch {
    ids = [];
  }
  return { text: content.replace(m[0], "").trim(), ids: Array.isArray(ids) ? ids : [] };
}

export function ChatPanel({
  coupons,
  fix,
  onOpenCoupon,
  onNeedLocation,
}: {
  coupons: Coupon[];
  fix: Fix | null;
  onOpenCoupon: (c: Coupon) => void;
  onNeedLocation: () => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [tool, setTool] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const abort = useRef<(() => void) | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [turns, tool, failure]);

  // 画面から外れるときは実行中のストリームを止める
  useEffect(() => () => abort.current?.(), []);

  /** 直前のユーザー発話までを履歴として送り直す。再試行もここを通る。 */
  function ask(history: Turn[]) {
    const next: Turn[] = [...history, { role: "assistant", content: "" }];
    setTurns(next);
    setBusy(true);
    setTool(null);
    setFailure(null);

    abort.current = chat(
      history.map((t) => ({ role: t.role, content: t.content })),
      {
      onDelta: (d) =>
        setTurns((ts) => {
          const copy = [...ts];
          copy[copy.length - 1] = { role: "assistant", content: copy[copy.length - 1].content + d };
          return copy;
        }),
      onTool: (l) => setTool(l),
      onDone: () => {
        setBusy(false);
        setTool(null);
      },
      onError: (m) => {
        setBusy(false);
        setTool(null);
        setFailure(m);
      },
      },
    );
  }

  function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    haptic();
    setDraft("");
    ask([...turns, { role: "user", content: q }]);
  }

  /** 失敗したやり取りを捨てて、同じ質問をもう一度投げる。 */
  function retry() {
    if (busy) return;
    const history = [...turns];
    while (history.length && history[history.length - 1].role === "assistant") history.pop();
    if (!history.length) return;
    haptic();
    ask(history);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-5 pb-4">
        {turns.length === 0 && (
          <div className="pt-10">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-line px-3 py-1">
              <Sparkles size={13} className="text-amber" />
              <span className="eyebrow text-orange/70">AI SEARCH</span>
            </div>
            <h2 className="text-[22px] font-bold leading-snug tracking-tight">
              手持ち{coupons.length}枚から
              <br />
              話しかけて探す
            </h2>
            <p className="mt-2.5 text-[14px] leading-relaxed text-[var(--muted)]">
              「駐車場に着いたけど何か使える?」みたいな聞き方でOK。
              位置情報を入れると、歩ける距離の店だけに絞れます。
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <Chip key={s} onClick={() => send(s)}>
                  {s}
                </Chip>
              ))}
            </div>
            {!fix && (
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => {
                  locate();
                  onNeedLocation();
                }}
              >
                <Crosshair size={14} />
                現在地を使う
              </Button>
            )}
          </div>
        )}

        <div className="space-y-5 pt-4">
          {turns.map((t, i) => {
            if (t.role === "user")
              return (
                <div key={i} className="flex justify-end">
                  <div className="max-w-[86%] rounded-2xl rounded-br-md bg-orange px-3.5 py-2.5 text-[15px] leading-relaxed text-white">
                    {t.content}
                  </div>
                </div>
              );
            const { text, ids } = split(t.content);
            const hits = ids.map((id) => coupons.find((c) => c.id === id)).filter(Boolean) as Coupon[];
            return (
              <div key={i} className="space-y-3">
                {text ? <Markdown text={text} /> : busy && i === turns.length - 1 ? (
                  <span className="caret font-mono text-orange">▍</span>
                ) : null}
                {hits.length > 0 && (
                  <div className="space-y-3 pt-1">
                    {hits.map((c, j) => (
                      <TicketCard key={c.id} coupon={c} fix={fix} index={j} onClick={() => onOpenCoupon(c)} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {tool && <p className="breathe font-mono text-[12px] text-orange/70">{tool}</p>}
          {failure && (
            <div className="rise flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/[.06] px-3.5 py-3">
              <AlertCircle size={15} className="mt-[3px] shrink-0 text-danger" />
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] leading-relaxed text-danger">{failure}</p>
                <Button variant="outline" size="sm" className="mt-2.5" onClick={retry}>
                  <RotateCcw size={13} />
                  もう一度送る
                </Button>
              </div>
            </div>
          )}
        </div>
        <div ref={endRef} />
      </div>

      <div className="shrink-0 border-t border-line bg-paper/92 px-4 pb-3 pt-3 backdrop-blur">
        <div className="flex items-end gap-2">
          <Textarea
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(draft);
              }
            }}
            placeholder="手持ちのクーポンについて聞く"
            className="max-h-32 min-h-[46px] flex-1 py-3"
          />
          {busy ? (
            <Button
              size="icon"
              variant="outline"
              onClick={() => {
                abort.current?.();
                setBusy(false);
                setTool(null);
              }}
              aria-label="停止"
            >
              <Square size={15} />
            </Button>
          ) : (
            <Button size="icon" onClick={() => send(draft)} disabled={!draft.trim()} aria-label="送信">
              <ArrowUp size={18} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
