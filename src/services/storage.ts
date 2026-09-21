// 存储层：只负责 YardState 的持久化读写与数据修复，不包含业务规则。
// 预约、占用、放行历史写在同一份状态同一个 key 里，保证刷新后三者一致。

import { buildSeedState } from "../domain/constants";
import { STORAGE_KEY } from "../domain/types";
import type { HistoryEvent, Reservation, YardState } from "../domain/types";

function normalizeState(raw: Partial<YardState> | null): YardState {
  const reservations = Array.isArray(raw?.reservations)
    ? (raw!.reservations as Reservation[]).filter((r) => r && r.id && r.plate)
    : [];
  const events = Array.isArray(raw?.events) ? (raw!.events as HistoryEvent[]) : [];
  return { reservations, events };
}

export function loadState(): YardState {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    // 隐私模式等场景下降级为内存态
    return buildSeedState();
  }

  if (!raw) {
    const seed = buildSeedState();
    saveState(seed);
    return seed;
  }

  try {
    return normalizeState(JSON.parse(raw) as Partial<YardState>);
  } catch {
    // 数据损坏时回退种子，避免页面白屏
    return buildSeedState();
  }
}

export function saveState(state: YardState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 写入失败（配额/隐私模式）时静默：当前会话状态仍可用
  }
}

export function clearState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
