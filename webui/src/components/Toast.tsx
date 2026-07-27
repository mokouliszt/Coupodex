import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * 取り消し付きのスナックバー。
 * 削除は「確認ダイアログ」ではなく「すぐ消えて、戻せる」方式にしている。
 */
export function Toast({
  message,
  actionLabel,
  onAction,
  onExpire,
  duration = 5200,
  lifted,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onExpire: () => void;
  duration?: number;
  /** タブバーの上に浮かせるか */
  lifted?: boolean;
}) {
  const [progress, setProgress] = useState(1);
  const expire = useRef(onExpire);
  expire.current = onExpire;

  useEffect(() => {
    const started = Date.now();
    const tick = window.setInterval(() => {
      const left = 1 - (Date.now() - started) / duration;
      setProgress(left > 0 ? left : 0);
    }, 60);
    const end = window.setTimeout(() => expire.current(), duration);
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(end);
    };
  }, [duration]);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 z-[70] flex justify-center px-4"
      style={{ bottom: lifted ? "calc(var(--safe-bottom) + 84px)" : "calc(var(--safe-bottom) + 16px)" }}
    >
      <div
        className={cn(
          "pop pointer-events-auto relative flex w-full max-w-[440px] items-center gap-3 overflow-hidden rounded-2xl",
          "bg-ink px-4 py-3 text-white shadow-[0_10px_34px_rgba(43,22,8,.34)]",
        )}
      >
        <span className="min-w-0 flex-1 truncate text-[14px]">{message}</span>
        {actionLabel && (
          <button
            onClick={onAction}
            className="relative shrink-0 rounded-lg px-2.5 py-1 text-[14px] font-semibold text-amber active:scale-95"
          >
            {actionLabel}
          </button>
        )}
        {/* 残り時間 */}
        <span
          aria-hidden
          className="absolute bottom-0 left-0 h-[2px] bg-amber/70 transition-[width] duration-100 ease-linear"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
    </div>
  );
}
