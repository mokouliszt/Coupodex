// ネイティブ(MainActivity.Bridge)との橋渡し。
// JS → Native.*  /  Native → window.__native(type, payload)

export interface Coupon {
  id: string;
  store: string;
  branch?: string | null;
  service: string;
  place: string;
  expiry: string | null; // YYYY-MM-DD
  expiryText?: string | null;
  notes: string;
  category?: string | null;
  discount?: string | null;
  conditions?: string[];
  code?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  chain?: boolean;
  photo?: string | null;
  used?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Settings {
  model: string;
  effort: string;
  radius: number;
  defaultPlace: string;
}

export interface NativeState {
  loggedIn: boolean;
  models: string[];
  efforts: string[];
  settings: Settings;
  places: string[];
  hasLocation: boolean;
}

export interface Fix {
  lat: number;
  lng: number;
  accuracy: number;
  time: number;
}

interface NativeBridge {
  state(): string;
  login(): void;
  logout(): void;
  coupons(): string;
  saveCoupon(json: string): string;
  deleteCoupon(id: string): string;
  saveSettings(json: string): void;
  pickPhoto(mode: "camera" | "gallery"): void;
  analyze(reqId: string, photoId: string): void;
  chat(reqId: string, payload: string): void;
  cancel(reqId: string): void;
  locate(): void;
  openGeo(lat: number, lng: number, label: string): void;
  search(query: string): void;
  openUrl(url: string): void;
  share(text: string): void;
  haptic(): void;
}

declare global {
  interface Window {
    Native?: NativeBridge;
    __native?: (type: string, payload: any) => void;
  }
}

const N = () => window.Native;
export const isNative = () => !!window.Native;

/**
 * ネイティブ呼び出しの失敗を握りつぶさないための通知口。
 * 以前は try/catch で localStorage にフォールバックしていたため、
 * 端末側の保存が失敗しても画面上は成功したように見えてしまっていた。
 */
let reportError: ((message: string) => void) | null = null;
export function setBridgeErrorHandler(fn: ((message: string) => void) | null) {
  reportError = fn;
}
function fail(message: string, detail?: unknown) {
  console.error("[bridge]", message, detail);
  reportError?.(message);
}

/** ブリッジの戻り値をパースする。{error} が返ってきたら失敗として扱う。 */
function parseList(raw: string, what: string): Coupon[] | null {
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return v as Coupon[];
    if (v && typeof v === "object" && "error" in v) {
      fail(`${what}に失敗しました: ${(v as any).error}`);
      return null;
    }
    fail(`${what}に失敗しました`, v);
    return null;
  } catch (e) {
    fail(`${what}に失敗しました`, e);
    return null;
  }
}

type Handler = (payload: any) => void;
const handlers = new Map<string, Set<Handler>>();

export function on(type: string, fn: Handler): () => void {
  if (!handlers.has(type)) handlers.set(type, new Set());
  handlers.get(type)!.add(fn);
  return () => handlers.get(type)!.delete(fn);
}

window.__native = (type, payload) => {
  handlers.get(type)?.forEach((h) => {
    try {
      h(payload);
    } catch (e) {
      console.error(e);
    }
  });
};

// ---- 同期API ----

const DEV_STATE: NativeState = {
  loggedIn: false,
  models: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.5"],
  efforts: ["minimal", "low", "medium", "high", "xhigh", "max"],
  settings: { model: "gpt-5.6-sol", effort: "high", radius: 500, defaultPlace: "" },
  places: [],
  hasLocation: false,
};

export function getState(): NativeState {
  try {
    return JSON.parse(N()!.state());
  } catch {
    return DEV_STATE;
  }
}

// --- ブラウザで動かしたときだけ使う保存先（端末では絶対に通らない） ---
const devRead = (): Coupon[] => {
  try {
    return JSON.parse(localStorage.getItem("dev:coupons") || "[]");
  } catch {
    return [];
  }
};
const devWrite = (list: Coupon[]) => localStorage.setItem("dev:coupons", JSON.stringify(list));

export function listCoupons(): Coupon[] {
  const n = N();
  if (!n) return devRead();
  return parseList(n.coupons(), "クーポンの読み込み") ?? [];
}

/** 失敗したら null。呼び出し側は画面を書き換えずにエラーを出すこと。 */
export function saveCoupon(c: Coupon): Coupon[] | null {
  const n = N();
  if (!n) {
    const next = [c, ...devRead().filter((x) => x.id !== c.id)];
    devWrite(next);
    return next;
  }
  return parseList(n.saveCoupon(JSON.stringify(c)), "保存");
}

/** 失敗したら null。 */
export function deleteCoupon(id: string): Coupon[] | null {
  const n = N();
  if (!n) {
    const next = devRead().filter((x) => x.id !== id);
    devWrite(next);
    return next;
  }
  return parseList(n.deleteCoupon(id), "削除");
}

export const login = () => N()?.login();
export const logout = () => N()?.logout();
export const saveSettings = (s: Settings) => N()?.saveSettings(JSON.stringify(s));
export const pickPhoto = (mode: "camera" | "gallery") => N()?.pickPhoto(mode);
export const locate = () => N()?.locate();
export const openGeo = (lat: number, lng: number, label: string) => N()?.openGeo(lat, lng, label);
export const searchMap = (q: string) => N()?.search(q);
export const openUrl = (url: string) => N()?.openUrl(url);
export const share = (t: string) => N()?.share(t);
export const haptic = () => N()?.haptic();
export const cancel = (id: string) => N()?.cancel(id);

export const newReqId = () => Math.random().toString(36).slice(2, 10);

// ---- ストリーミング ----

export interface StreamHandlers {
  onDelta?: (t: string) => void;
  onTool?: (label: string) => void;
  onDone?: () => void;
  onError?: (m: string) => void;
  onAnalyzed?: (data: any, photo: string, url: string) => void;
}

/** reqId 単位でイベントを振り分ける。戻り値でキャンセル。 */
export function stream(reqId: string, h: StreamHandlers): () => void {
  const offs = [
    on("delta", (p) => p.reqId === reqId && h.onDelta?.(p.text)),
    on("tool", (p) => p.reqId === reqId && h.onTool?.(p.label)),
    on("done", (p) => {
      if (p.reqId !== reqId) return;
      h.onDone?.();
      dispose();
    }),
    on("error", (p) => {
      if (p.reqId !== reqId) return;
      h.onError?.(p.message);
      dispose();
    }),
    on("analyzed", (p) => {
      if (p.reqId !== reqId) return;
      h.onAnalyzed?.(p.data, p.photo, p.url);
      dispose();
    }),
  ];
  const dispose = () => offs.forEach((o) => o());
  return () => {
    cancel(reqId);
    dispose();
  };
}

export function analyze(photoId: string, h: StreamHandlers): () => void {
  const id = newReqId();
  const off = stream(id, h);
  if (!N()) {
    setTimeout(() => h.onError?.("(dev) ネイティブ未接続"), 400);
    return off;
  }
  N()!.analyze(id, photoId);
  return off;
}

export function chat(messages: { role: string; content: string }[], h: StreamHandlers): () => void {
  const id = newReqId();
  const off = stream(id, h);
  if (!N()) {
    setTimeout(() => {
      h.onDelta?.("(dev) ネイティブ未接続");
      h.onDone?.();
    }, 300);
    return off;
  }
  N()!.chat(id, JSON.stringify({ messages }));
  return off;
}
