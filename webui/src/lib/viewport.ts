import { useEffect, useState } from "react";
import { on } from "./native";

/**
 * WebView のキーボード対応。
 *
 * 端末・OSバージョンによって挙動が2通りに割れる:
 *   A) ウィンドウ自体が縮む（adjustResize が効く）→ innerHeight が減る
 *   B) ウィンドウは縮まず、IME インセットだけ通知される（edge-to-edge の既定）
 * どちらか一方を前提にすると片方で破綻するので、両方の情報から
 * 「実際にキーボードが覆っている高さ」を求めて CSS 変数に落とす。
 *
 *   --vh  : 実際に使える高さ（ルート要素の高さに使う）
 *   --kbh : キーボードがWebViewに覆いかぶさっている量（Bのときだけ >0）
 *           固定配置のシート類はこれを bottom に入れて持ち上げる
 */

let imeCss = 0; // ネイティブから来る IME インセット（CSS px）
let fullH = 0; // キーボードが無いときの高さ（基準）
let open = false;

const listeners = new Set<(open: boolean) => void>();

function apply() {
  const inner = window.innerHeight;
  const vv = window.visualViewport;
  const vvh = vv ? vv.height : inner;

  // キーボードが出ていないときの高さを基準として覚える
  if (imeCss < 1 && inner >= fullH) fullH = inner;
  if (fullH < 1) fullH = inner;

  // A/B どちらの経路で来ても最大値を取れば実際の被り量になる
  const kb = Math.max(0, imeCss, fullH - inner, fullH - vvh);
  const vh = Math.max(200, fullH - kb);
  const overlay = Math.max(0, inner - vh); // B のときだけ正

  const r = document.documentElement.style;
  r.setProperty("--vh", `${vh}px`);
  r.setProperty("--kbh", `${overlay}px`);

  const next = kb > 60;
  if (next !== open) {
    open = next;
    listeners.forEach((fn) => fn(open));
  }
}

export function initViewport() {
  on("insets", (i) => {
    const r = document.documentElement.style;
    r.setProperty("--safe-top", `${i.top}px`);
    r.setProperty("--safe-bottom", `${i.bottom}px`);
    imeCss = i.ime || 0;
    apply();
  });

  window.visualViewport?.addEventListener("resize", apply);
  window.visualViewport?.addEventListener("scroll", apply);
  window.addEventListener("resize", apply);
  apply();
}

/** キーボードが出ているか。出ている間はタブバーを畳んで入力欄を優先する。 */
export function useKeyboard(): boolean {
  const [v, setV] = useState(open);
  useEffect(() => {
    const fn = (o: boolean) => setV(o);
    listeners.add(fn);
    setV(open);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return v;
}
