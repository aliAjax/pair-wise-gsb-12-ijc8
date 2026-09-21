import { computed, ref } from "vue";
import { defineStore } from "pinia";

import {
  DOCKS,
  ENTRY_GRACE_MINUTES,
  dockById,
} from "../domain/constants";
import type {
  BookingDraft,
  Conflict,
  HistoryEvent,
  Reservation,
  YardState,
} from "../domain/types";
import {
  validateCancelReason,
  validateDraft,
  validateGateCheck,
} from "../domain/validation";
import { loadState, saveState } from "../services/storage";

export interface ActionResult {
  ok: boolean;
  conflicts: Conflict[];
  reservationId?: string;
}

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function makeEvent(
  type: HistoryEvent["type"],
  r: Reservation,
  at: string,
  extra: Partial<HistoryEvent> = {},
): HistoryEvent {
  return {
    id: uid("evt"),
    at,
    type,
    reservationId: r.id,
    plate: r.plate,
    dockId: r.dockId,
    startAt: r.startAt,
    endAt: r.endAt,
    ...extra,
  };
}

export const useYardStore = defineStore("yard", () => {
  const initial = loadState();
  const reservations = ref<Reservation[]>(initial.reservations);
  const events = ref<HistoryEvent[]>(initial.events);
  /** 最近一次被规则拦下的冲突列表（供页面顶部冲突区展示） */
  const lastConflicts = ref<Conflict[]>([]);

  function persist() {
    const state: YardState = {
      reservations: reservations.value,
      events: events.value,
    };
    saveState(state);
  }

  function fail(conflicts: Conflict[]): ActionResult {
    lastConflicts.value = conflicts;
    return { ok: false, conflicts };
  }

  // ---------- 查询视图 ----------

  const activeReservations = computed(() =>
    reservations.value
      .filter((r) => r.status === "booked" || r.status === "loading")
      .sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt)),
  );

  const historyEvents = computed(() =>
    [...events.value].sort((a, b) => +new Date(b.at) - +new Date(a.at)),
  );

  /** 放行历史（页面“放行历史”标签页数据源） */
  const releaseHistory = computed(() =>
    historyEvents.value.filter((e) => e.type === "released"),
  );

  /** 泊位占用：仅含已预约/装卸中预约 */
  const occupancy = computed(() => {
    const map = new Map<string, Reservation[]>();
    for (const dock of DOCKS) map.set(dock.id, []);
    for (const r of activeReservations.value) {
      map.get(r.dockId)?.push(r);
    }
    return DOCKS.map((dock) => ({
      dock,
      items: (map.get(dock.id) ?? []).sort(
        (a, b) => +new Date(a.startAt) - +new Date(b.startAt),
      ),
    }));
  });

  const metrics = computed(() => ({
    booked: reservations.value.filter((r) => r.status === "booked").length,
    loading: reservations.value.filter((r) => r.status === "loading").length,
    releasedToday: releaseHistory.value.filter((e) => {
      const d = new Date(e.at);
      const now = new Date();
      return (
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate()
      );
    }).length,
    expired: reservations.value.filter((r) => r.status === "expired").length,
  }));

  function getReservation(id: string): Reservation | undefined {
    return reservations.value.find((r) => r.id === id);
  }

  // ---------- 超时释放（R 业务规则：过开始时间 + 宽限期未入场） ----------

  /**
   * 扫描超时未入场预约。已入场（loading）不受影响；
   * 只处理仍处于 booked 且 startAt + 15min <= now 的预约，置为 expired 并记流水。
   * 返回本次释放条数（供页面提示）。
   */
  function sweepExpired(now: Date = new Date()): number {
    let changed = 0;
    const deadline = now.getTime() - ENTRY_GRACE_MINUTES * 60000;
    for (const r of reservations.value) {
      if (r.status !== "booked") continue;
      if (+new Date(r.startAt) <= deadline) {
        r.status = "expired";
        r.reason = `超过预约开始 ${ENTRY_GRACE_MINUTES} 分钟未入场，系统自动释放泊位`;
        events.value.push(
          makeEvent("expired", r, now.toISOString(), { detail: r.reason }),
        );
        changed += 1;
      }
    }
    if (changed > 0) {
      persist();
      lastConflicts.value = [];
    }
    return changed;
  }

  // ---------- 新建预约 ----------

  function createReservation(draft: BookingDraft): ActionResult {
    const check = validateDraft(draft, reservations.value);
    if (!check.valid) return fail(check.conflicts);

    const now = new Date().toISOString();
    const r: Reservation = {
      ...draft,
      plate: draft.plate.trim(),
      id: uid("rsv"),
      status: "booked",
      createdAt: now,
    };
    reservations.value = [r, ...reservations.value];
    events.value.push(makeEvent("created", r, now));
    persist();
    lastConflicts.value = [];
    return { ok: true, conflicts: [], reservationId: r.id };
  }

  // ---------- 入场（锁定预约） ----------

  function enter(id: string): ActionResult {
    const r = getReservation(id);
    if (!r || r.status !== "booked") {
      return fail([
        {
          plate: r?.plate ?? "",
          dockName: r ? dockById(r.dockId)?.name ?? r.dockId : "",
          startAt: r?.startAt ?? "",
          endAt: r?.endAt ?? "",
          ruleCode: "R5_LOCKED_STATE",
          ruleLabel: "入场后预约已锁定",
          message: r
            ? `当前状态不可入场：${r.plate} 已入场或已结束，预约已锁定`
            : "预约不存在或已被处理",
        },
      ]);
    }
    r.status = "loading";
    r.enteredAt = new Date().toISOString();
    events.value.push(makeEvent("entered", r, r.enteredAt));
    persist();
    lastConflicts.value = [];
    return { ok: true, conflicts: [] };
  }

  // ---------- 录入装卸结果（不改变锁定状态，可反复补录） ----------

  function saveCompletion(
    id: string,
    payload: { sealNo: string; netWeightKg: number | undefined; completionNote: string },
  ): ActionResult {
    const r = getReservation(id);
    if (!r || r.status !== "loading") {
      return fail([
        {
          plate: r?.plate ?? "",
          dockName: r ? dockById(r.dockId)?.name ?? r.dockId : "",
          startAt: r?.startAt ?? "",
          endAt: r?.endAt ?? "",
          ruleCode: "R5_LOCKED_STATE",
          ruleLabel: "入场后预约已锁定",
          message: "仅装卸中的预约可以录入铅封号与净重",
        },
      ]);
    }
    r.sealNo = payload.sealNo.trim();
    r.netWeightKg =
      payload.netWeightKg === undefined || Number.isNaN(payload.netWeightKg)
        ? undefined
        : payload.netWeightKg;
    r.completionNote = payload.completionNote.trim();
    persist();
    lastConflicts.value = [];
    return { ok: true, conflicts: [] };
  }

  // ---------- 放行（R6：铅封号、净重缺项不得放行） ----------

  function release(
    id: string,
    payload: { sealNo: string; netWeightKg: number | undefined; completionNote: string },
  ): ActionResult {
    const r = getReservation(id);
    if (!r) {
      return fail([
        {
          plate: "",
          dockName: "",
          startAt: "",
          endAt: "",
          ruleCode: "R8_NOT_FOUND",
          ruleLabel: "预约不存在或已被处理",
          message: "预约不存在或已被处理",
        },
      ]);
    }
    if (r.status !== "loading") {
      return fail([
        {
          plate: r.plate,
          dockName: dockById(r.dockId)?.name ?? r.dockId,
          startAt: r.startAt,
          endAt: r.endAt,
          ruleCode: "R5_LOCKED_STATE",
          ruleLabel: "入场后预约已锁定",
          message: `仅装卸中的车辆可放行，当前状态：${r.status}`,
        },
      ]);
    }

    // 先把页面上的录入写回，再统一执行缺项校验
    const filled: Reservation = {
      ...r,
      sealNo: payload.sealNo.trim(),
      netWeightKg:
        payload.netWeightKg === undefined || Number.isNaN(payload.netWeightKg)
          ? undefined
          : payload.netWeightKg,
      completionNote: payload.completionNote.trim(),
    };
    const gate = validateGateCheck(filled);
    if (!gate.valid) return fail(gate.conflicts);

    const now = new Date().toISOString();
    r.sealNo = filled.sealNo;
    r.netWeightKg = filled.netWeightKg;
    r.completionNote = filled.completionNote;
    r.sealedAt = now;
    r.status = "released";
    r.releasedAt = now;
    events.value.push(
      makeEvent("released", r, now, {
        sealNo: r.sealNo,
        netWeightKg: r.netWeightKg,
        detail: r.completionNote || undefined,
      }),
    );
    persist();
    lastConflicts.value = [];
    return { ok: true, conflicts: [] };
  }

  // ---------- 改约：先释放原位（R4 冲突以释放后的状态重算） ----------

  function reschedule(id: string, draft: BookingDraft): ActionResult {
    const old = getReservation(id);
    if (!old) {
      return fail([
        {
          plate: draft.plate,
          dockName: dockById(draft.dockId)?.name ?? "",
          startAt: draft.startAt,
          endAt: draft.endAt,
          ruleCode: "R8_NOT_FOUND",
          ruleLabel: "预约不存在或已被处理",
          message: "原预约不存在，无法改约",
        },
      ]);
    }
    if (old.status === "loading") {
      return fail([
        {
          plate: old.plate,
          dockName: dockById(old.dockId)?.name ?? old.dockId,
          startAt: old.startAt,
          endAt: old.endAt,
          ruleCode: "R5_LOCKED_STATE",
          ruleLabel: "入场后预约已锁定",
          message: `${old.plate} 已入场装卸，预约已锁定，不能直接改约；如需中断请走“装卸中取消”`,
        },
      ]);
    }
    if (old.status !== "booked") {
      return fail([
        {
          plate: old.plate,
          dockName: dockById(old.dockId)?.name ?? old.dockId,
          startAt: old.startAt,
          endAt: old.endAt,
          ruleCode: "R5_LOCKED_STATE",
          ruleLabel: "入场后预约已锁定",
          message: "该预约已结束，不能改约",
        },
      ]);
    }

    // 1) 先释放原位：旧预约置 rescheduled，冲突检测时天然排除（非 booked/loading）
    const now = new Date().toISOString();
    old.status = "rescheduled";
    old.reason = "改约：泊位已释放";

    // 2) 用释放后的库状态校验新草稿（忽略旧 id 双保险）
    const check = validateDraft(draft, reservations.value, old.id);
    if (!check.valid) {
      // 校验失败：回滚旧预约，原位不释放
      old.status = "booked";
      old.reason = undefined;
      return fail(check.conflicts);
    }

    const nr: Reservation = {
      ...draft,
      plate: draft.plate.trim(),
      id: uid("rsv"),
      status: "booked",
      createdAt: now,
      rebookedFromId: old.id,
    };
    old.replacedById = nr.id;
    reservations.value = [nr, ...reservations.value];
    events.value.push(
      makeEvent("rescheduled", old, now, {
        newReservationId: nr.id,
        detail: `改约至 ${dockById(nr.dockId)?.name ?? nr.dockId} ${nr.startAt} ~ ${nr.endAt}`,
      }),
    );
    events.value.push(makeEvent("created", nr, now, { detail: "由改约生成的新预约" }));
    persist();
    lastConflicts.value = [];
    return { ok: true, conflicts: [], reservationId: nr.id };
  }

  // ---------- 装卸中取消：必须填原因（R7），并生成新预约 ----------

  /**
   * 装卸中断：原 loading 预约置 aborted（释放泊位，不再参与 R4 占用），
   * 必须填写取消原因；随后按草稿生成一条新的 booked 预约。
   */
  function abortLoading(id: string, reason: string, draft: BookingDraft): ActionResult {
    const old = getReservation(id);
    const reasonCheck = validateCancelReason(reason);
    if (!reasonCheck.valid) return fail(reasonCheck.conflicts);

    if (!old || old.status !== "loading") {
      return fail([
        {
          plate: old?.plate ?? draft.plate,
          dockName: old ? dockById(old.dockId)?.name ?? old.dockId : "",
          startAt: old?.startAt ?? draft.startAt,
          endAt: old?.endAt ?? draft.endAt,
          ruleCode: "R5_LOCKED_STATE",
          ruleLabel: "入场后预约已锁定",
          message: "仅装卸中的预约可执行装卸取消",
        },
      ]);
    }

    const now = new Date().toISOString();
    old.status = "aborted";
    old.reason = reason.trim();

    // 新预约基于释放后的状态校验
    const check = validateDraft(draft, reservations.value, old.id);
    if (!check.valid) {
      old.status = "loading";
      old.reason = undefined;
      return fail(check.conflicts);
    }

    const nr: Reservation = {
      ...draft,
      plate: draft.plate.trim(),
      id: uid("rsv"),
      status: "booked",
      createdAt: now,
      rebookedFromId: old.id,
      notes: draft.notes
        ? `${draft.notes}\n[装卸取消重约] ${reason.trim()}`
        : `[装卸取消重约] ${reason.trim()}`,
    };
    old.replacedById = nr.id;
    reservations.value = [nr, ...reservations.value];
    events.value.push(
      makeEvent("aborted", old, now, {
        newReservationId: nr.id,
        detail: `装卸中取消：${reason.trim()}；生成新预约 ${nr.id}`,
      }),
    );
    events.value.push(makeEvent("created", nr, now, { detail: "装卸取消后生成的新预约" }));
    persist();
    lastConflicts.value = [];
    return { ok: true, conflicts: [], reservationId: nr.id };
  }

  /** 待入场预约的普通取消（尚未入场，直接释放泊位） */
  function cancelBooking(id: string): ActionResult {
    const r = getReservation(id);
    if (!r || r.status !== "booked") {
      return fail([
        {
          plate: r?.plate ?? "",
          dockName: r ? dockById(r.dockId)?.name ?? r.dockId : "",
          startAt: r?.startAt ?? "",
          endAt: r?.endAt ?? "",
          ruleCode: "R5_LOCKED_STATE",
          ruleLabel: "入场后预约已锁定",
          message: "仅待入场的预约可以取消",
        },
      ]);
    }
    const now = new Date().toISOString();
    r.status = "rescheduled";
    r.reason = "入场前取消，泊位已释放";
    events.value.push(makeEvent("rescheduled", r, now, { detail: r.reason }));
    persist();
    lastConflicts.value = [];
    return { ok: true, conflicts: [] };
  }

  function dismissConflicts() {
    lastConflicts.value = [];
  }

  return {
    // state
    reservations,
    events,
    lastConflicts,
    // getters
    activeReservations,
    historyEvents,
    releaseHistory,
    occupancy,
    metrics,
    // actions
    sweepExpired,
    createReservation,
    enter,
    saveCompletion,
    release,
    reschedule,
    abortLoading,
    cancelBooking,
    getReservation,
    dismissConflicts,
  };
});
