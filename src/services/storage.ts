// 存储层：只负责快照的序列化读写，不包含任何业务规则。

import type { Dock, DockEvent, Reservation } from "../domain/types";

const STORAGE_KEY = "dfwlfront-3-dock-reservation-v1";

export interface AppSnapshot {
  docks: Dock[];
  reservations: Reservation[];
  events: DockEvent[];
}

export function loadSnapshot(): AppSnapshot | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<AppSnapshot>;
    if (!Array.isArray(parsed.reservations) || !Array.isArray(parsed.events)) {
      return null;
    }
    return {
      docks: Array.isArray(parsed.docks) ? parsed.docks : [],
      reservations: parsed.reservations,
      events: parsed.events
    };
  } catch {
    return null;
  }
}

export function saveSnapshot(snapshot: AppSnapshot): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
}

export function clearSnapshot(): void {
  localStorage.removeItem(STORAGE_KEY);
}
