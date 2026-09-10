// Live ZKAS price, for showing holdings value in fiat the way Kaspium does.
// Pulled from the OTC desk (CORS-enabled). Cached in localStorage, refreshed on
// mount and every 60s, and degrades silently to the last cache (or nothing) when
// unreachable — a price is a nicety, never a blocker.
import { useEffect, useState } from "react";

const PRICE_URL = "https://mining-pool.zkas.info/api/otc/price";
const CACHE_KEY = "zkas_price_v1";

export type ZkasPrice = { usdPerZkas: number; kasPerZkas: number; asOf: number };

let mem: ZkasPrice | null = null;
const listeners = new Set<() => void>();

/// "$0.00215" | "0.00215" -> 0.00215 ; NaN if not a number.
function num(s: unknown): number {
  return s == null ? NaN : Number(String(s).replace(/[^0-9.]/g, ""));
}

export function cachedPrice(): ZkasPrice | null {
  if (mem) return mem;
  try {
    const r = localStorage.getItem(CACHE_KEY);
    if (r) mem = JSON.parse(r) as ZkasPrice;
  } catch {
    /* private mode / disabled storage — fall through to a live fetch */
  }
  return mem;
}

export async function refreshPrice(): Promise<ZkasPrice | null> {
  try {
    const r = await fetch(PRICE_URL, { cache: "no-store" });
    if (!r.ok) return mem;
    const j = (await r.json()) as {
      mid?: { usd?: string; kas?: string };
      last?: { usd?: string; kas?: string };
    };
    // `mid` is the fair market midpoint; `last` is the fallback if mid is absent.
    const usd = num(j?.mid?.usd) || num(j?.last?.usd);
    const kas = num(j?.mid?.kas) || num(j?.last?.kas);
    if (!Number.isFinite(usd) || usd <= 0) return mem;
    mem = { usdPerZkas: usd, kasPerZkas: Number.isFinite(kas) ? kas : 0, asOf: Date.now() };
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(mem));
    } catch {
      /* best-effort cache */
    }
    listeners.forEach((l) => l());
    return mem;
  } catch {
    return mem;
  }
}

/// The price, refreshed on mount and every 60s. Shared across all mounts so the
/// balance, history rows and detail sheet all read the same figure.
export function useZkasPrice(): ZkasPrice | null {
  const [p, setP] = useState<ZkasPrice | null>(() => cachedPrice());
  useEffect(() => {
    let live = true;
    const on = () => { if (live) setP(cachedPrice()); };
    listeners.add(on);
    void refreshPrice();
    const t = setInterval(() => void refreshPrice(), 60_000);
    return () => {
      live = false;
      listeners.delete(on);
      clearInterval(t);
    };
  }, []);
  return p;
}

/// Fiat string for a ZKAS amount, or null when there's no price yet. Adaptive
/// precision so a sub-cent holding still reads as a real number, not "$0.00".
export function fmtFiat(zkas: number, price: ZkasPrice | null): string | null {
  if (!price || !Number.isFinite(zkas)) return null;
  const v = zkas * price.usdPerZkas;
  if (v === 0) return "$0.00";
  if (v > 0 && v < 0.01) return "<$0.01";
  if (v < 1) return "$" + v.toFixed(3);
  return "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
