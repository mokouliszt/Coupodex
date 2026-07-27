import { useCallback, useEffect, useRef, useState } from "react";
import { haptic } from "./native";

/**
 * 長押し検出。スクロールと共存させるため、一定以上動いたら取り消す。
 * 長押しが成立したあとに続く click は握りつぶす（詳細シートが開いてしまうため）。
 */
export function useLongPress(onLongPress: () => void, onPress?: () => void, ms = 420) {
  const timer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const [holding, setHolding] = useState(false);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    origin.current = null;
    setHolding(false);
  }, []);

  useEffect(() => clear, [clear]);

  return {
    holding,
    handlers: {
      onPointerDown: (e: React.PointerEvent) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        fired.current = false;
        origin.current = { x: e.clientX, y: e.clientY };
        setHolding(true);
        timer.current = window.setTimeout(() => {
          fired.current = true;
          clear();
          haptic();
          onLongPress();
        }, ms);
      },
      onPointerMove: (e: React.PointerEvent) => {
        const o = origin.current;
        if (!o) return;
        if (Math.hypot(e.clientX - o.x, e.clientY - o.y) > 10) clear();
      },
      onPointerUp: clear,
      onPointerCancel: clear,
      onPointerLeave: clear,
      onClick: (e: React.MouseEvent) => {
        if (fired.current) {
          e.preventDefault();
          e.stopPropagation();
          fired.current = false;
          return;
        }
        onPress?.();
      },
      // WebView の長押しでテキスト選択メニューが出るのを抑える
      onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    },
  };
}
