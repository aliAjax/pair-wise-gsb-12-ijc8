// 应用状态层（Pinia）：编排领域规则与存储，页面只调用这里暴露的动作。
// 每次成功变更立即整体持久化，保证刷新后预约、占用、放行历史一致。

import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  LOCKED_STATUSES,
  TERMINAL_STATUSES,
  type BookingConflict,
  type Dock,
  type DockEvent,
  type Reservation
} from "../domain/types";
import {
  canReschedule,
  isNoShow,
  validateBooking,
  validateCancelLoading,
  validateRelease,
  type BookingInput,
  type ReleaseInput
} from "../domain/rules";
import { defaultSlotEnd, defaultSlotStart, formatRange } from "../domain/time";
import { loadSnapshot, saveSnapshot, type AppSnapshot } from "../services/storage";
import { buildSeedSnapshot } from "../services/seed";

function uid(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

export const useDockStore = defineStore("dockReservation", () => {
  const initial = loadSnapshot() ?? buildSeedSnapshot();

  const docks = ref<Dock[]>(initial.docks);
  const reservations = ref<Reservation[]>(initial.reservations);
  const events = ref<DockEvent[]>(initial.events);
  /** 最近一次校验失败的冲突清单，供页面弹出 */
  const conflicts = ref<BookingConflict[]>([]);
  const now = ref<string>(new Date().toISOString());

  function persist() {
    const snapshot: AppSnapshot = {
      docks: docks.value,
      reservations: reservations.value,
      events: events.value
    };
    saveSnapshot(snapshot);
  }

  function logEvent(
    event: Omit<DockEvent, "id" | "at"> & { at?: string }
  ): void {
    events.value = [
      { ...event, id: uid("evt"), at: event.at ?? now.value },
      ...events.value
    ];
  }

  function tick(current: string = new Date().toISOString()): void {
    now.value = current;
    // 超时未入场自动释放：待入场预约超过开始后宽限期仍未入场
    const expired = reservations.value.filter((item) => isNoShow(item, current));
    if (expired.length === 0) return;
    const expiredIds = new Set(expired.map((item) => item.id));
    reservations.value = reservations.value.map((item) =>
      expiredIds.has(item.id)
        ? { ...item, status: "noShow", endReason: "超时未入场，系统自动释放装卸位" }
        : item
    );
    for (const item of expired) {
      logEvent({
        type: "noShow",
        reservationId: item.id,
        plate: item.plate,
        dockId: item.dockId,
        message: `超时未入场（${formatRange(item.startAt, item.endAt)}），装卸位自动释放`
      });
    }
    persist();
  }

  // ---------- 查询 ----------

  function dockById(id: string): Dock | undefined {
    return docks.value.find((dock) => dock.id === id);
  }

  const activeReservations = computed(() =>
    reservations.value.filter((item) => !TERMINAL_STATUSES.includes(item.status))
  );

  /** 装卸位实时占用：仅活跃状态占位 */
  const occupiedDockIds = computed(() => {
    const ids = new Set<string>();
    for (const item of activeReservations.value) ids.add(item.dockId);
    return ids;
  });

  /** 按时间排序的放行历史 */
  const releaseHistory = computed(() =>
    [...events.value].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
  );

  // ---------- 预约 ----------

  /** 校验预约/改约输入，返回冲突清单（页面也可先调用预览） */
  function checkBooking(input: BookingInput, excludeId?: string): BookingConflict[] {
    return validateBooking(input, {
      docks: docks.value,
      reservations: reservations.value,
      excludeReservationId: excludeId,
      now: now.value
    });
  }

  function book(
    input: BookingInput & { notes?: string }
  ): Reservation | null {
    const found = checkBooking(input);
    conflicts.value = found;
    if (found.length > 0) return null;

    const reservation: Reservation = {
      id: uid("res"),
      plate: input.plate.trim().toUpperCase(),
      tempZone: input.tempZone as Reservation["tempZone"],
      dockId: input.dockId,
      startAt: input.startAt!,
      endAt: input.endAt!,
      status: "reserved",
      notes: input.notes ?? "",
      checkedInAt: null,
      sealNo: null,
      netWeight: null,
      releaseNotes: null,
      releasedAt: null,
      endReason: null,
      rescheduledFrom: null,
      rebookedTo: null,
      createdAt: now.value
    };
    reservations.value = [reservation, ...reservations.value];
    logEvent({
      type: "book",
      reservationId: reservation.id,
      plate: reservation.plate,
      dockId: reservation.dockId,
      message: `预约 ${dockById(reservation.dockId)?.name}，时段 ${formatRange(
        reservation.startAt,
        reservation.endAt
      )}`
    });
    persist();
    return reservation;
  }

  // ---------- 入场 / 装卸 ----------

  function checkIn(id: string): boolean {
    const target = reservations.value.find((item) => item.id === id);
    if (!target || target.status !== "reserved") return false;
    // 入场瞬间再跑一次超时规则，过期的预约不能入场
    if (isNoShow(target, now.value)) {
      tick(now.value);
      return false;
    }
    reservations.value = reservations.value.map((item) =>
      item.id === id
        ? { ...item, status: "checkedIn", checkedInAt: now.value }
        : item
    );
    logEvent({
      type: "checkIn",
      reservationId: id,
      plate: target.plate,
      dockId: target.dockId,
      message: "车辆入场，预约锁定，禁止改约/删除"
    });
    persist();
    return true;
  }

  function startLoading(id: string): boolean {
    const target = reservations.value.find((item) => item.id === id);
    if (!target || target.status !== "checkedIn") return false;
    reservations.value = reservations.value.map((item) =>
      item.id === id ? { ...item, status: "loading" } : item
    );
    logEvent({
      type: "loading",
      reservationId: id,
      plate: target.plate,
      dockId: target.dockId,
      message: "开始装卸作业"
    });
    persist();
    return true;
  }

  // ---------- 放行（缺项不得放行） ----------

  function completeRelease(id: string, input: ReleaseInput): boolean {
    const target = reservations.value.find((item) => item.id === id);
    if (!target || target.status !== "loading") return false;
    const found = validateRelease(target, input);
    conflicts.value = found;
    if (found.length > 0) return false;

    reservations.value = reservations.value.map((item) =>
      item.id === id
        ? {
            ...item,
            status: "released",
            sealNo: input.sealNo.trim(),
            netWeight: input.netWeight,
            releaseNotes: input.releaseNotes.trim(),
            releasedAt: now.value
          }
        : item
    );
    logEvent({
      type: "release",
      reservationId: id,
      plate: target.plate,
      dockId: target.dockId,
      message: `放行：铅封 ${input.sealNo.trim()}，净重 ${input.netWeight} 吨`
    });
    persist();
    return true;
  }

  // ---------- 改约：先释放原位，再按规则生成新预约 ----------

  function reschedule(id: string, input: BookingInput): Reservation | null {
    const target = reservations.value.find((item) => item.id === id);
    if (!target || !canReschedule(target.status)) {
      conflicts.value = [
        {
          rule: "STATE_LOCKED",
          ruleLabel: "车辆入场后预约已锁定，不能改约或删除",
          plate: target?.plate ?? "",
          dockId: target?.dockId ?? "",
          dockLabel: "",
          startAt: target?.startAt ?? "",
          endAt: target?.endAt ?? "",
          detail: "请先取消入场锁定状态"
        }
      ];
      return null;
    }

    // 校验新时段（排除旧预约自身）
    const found = checkBooking(input, id);
    conflicts.value = found;
    if (found.length > 0) return null;

    // 第一步：释放原位（旧预约置为取消，记录改约原因）
    // 第二步：生成新预约并与旧预约双向关联
    const newReservation: Reservation = {
      id: uid("res"),
      plate: input.plate.trim().toUpperCase(),
      tempZone: input.tempZone as Reservation["tempZone"],
      dockId: input.dockId,
      startAt: input.startAt!,
      endAt: input.endAt!,
      status: "reserved",
      notes: target.notes,
      checkedInAt: null,
      sealNo: null,
      netWeight: null,
      releaseNotes: null,
      releasedAt: null,
      endReason: `改约：原 ${dockById(target.dockId)?.name} ${formatRange(
        target.startAt,
        target.endAt
      )}`,
      rescheduledFrom: target.id,
      rebookedTo: null,
      createdAt: now.value
    };

    reservations.value = [
      newReservation,
      ...reservations.value.map((item) =>
        item.id === id
          ? {
              ...item,
              status: "cancelled" as const,
              endReason: `改约至 ${dockById(input.dockId)?.name} ${formatRange(
                input.startAt!,
                input.endAt!
              )}`,
              rebookedTo: newReservation.id
            }
          : item
      )
    ];
    logEvent({
      type: "rebook",
      reservationId: newReservation.id,
      plate: newReservation.plate,
      dockId: newReservation.dockId,
      message: `改约：释放 ${dockById(target.dockId)?.name}（${formatRange(
        target.startAt,
        target.endAt
      )}），改约至 ${dockById(input.dockId)?.name}（${formatRange(
        input.startAt!,
        input.endAt!
      )}）`
    });
    persist();
    return newReservation;
  }

  // ---------- 取消 ----------

  /** 待入场可直接取消；装卸中取消必须填原因，并据此生成一张新预约（回退到待入场） */
  function cancelLoadingWithRebook(
    id: string,
    reason: string,
    next: Pick<BookingInput, "startAt" | "endAt">
  ): Reservation | null {
    const target = reservations.value.find((item) => item.id === id);
    if (!target || target.status !== "loading") return null;

    const reasonConflicts = validateCancelLoading(reason);
    if (reasonConflicts.length > 0 || !next.startAt || !next.endAt) {
      conflicts.value =
        reasonConflicts.length > 0
          ? reasonConflicts
          : [
              {
                rule: "CANCEL_REASON",
                ruleLabel: "装卸中终止必须填写取消原因，并据此生成新预约",
                plate: target.plate,
                dockId: target.dockId,
                dockLabel: "",
                startAt: next.startAt ?? "",
                endAt: next.endAt ?? "",
                detail: "新预约时段不完整"
              }
            ];
      return null;
    }

    // 新预约沿用同一车牌、温区、装卸位；时段可改，需重新过冲突校验
    const newInput: BookingInput = {
      plate: target.plate,
      tempZone: target.tempZone,
      dockId: target.dockId,
      startAt: next.startAt,
      endAt: next.endAt
    };
    const found = checkBooking(newInput, id);
    conflicts.value = found;
    if (found.length > 0) return null;

    const newReservation: Reservation = {
      id: uid("res"),
      plate: target.plate,
      tempZone: target.tempZone,
      dockId: target.dockId,
      startAt: next.startAt,
      endAt: next.endAt,
      status: "reserved",
      notes: target.notes,
      checkedInAt: null,
      sealNo: null,
      netWeight: null,
      releaseNotes: null,
      releasedAt: null,
      endReason: null,
      rescheduledFrom: target.id,
      rebookedTo: null,
      createdAt: now.value
    };

    reservations.value = [
      newReservation,
      ...reservations.value.map((item) =>
        item.id === id
          ? {
              ...item,
              status: "cancelled" as const,
              endReason: `装卸中终止：${reason.trim()}`,
              rebookedTo: newReservation.id
            }
          : item
      )
    ];
    logEvent({
      type: "cancel",
      reservationId: id,
      plate: target.plate,
      dockId: target.dockId,
      message: `装卸中终止，原因：${reason.trim()}；已生成新预约 ${formatRange(
        next.startAt,
        next.endAt
      )}`
    });
    logEvent({
      type: "book",
      reservationId: newReservation.id,
      plate: newReservation.plate,
      dockId: newReservation.dockId,
      message: `终止后重新预约 ${dockById(target.dockId)?.name}，时段 ${formatRange(
        next.startAt,
        next.endAt
      )}`
    });
    persist();
    return newReservation;
  }

  function cancelReserved(id: string): boolean {
    const target = reservations.value.find((item) => item.id === id);
    if (!target || target.status !== "reserved") return false;
    reservations.value = reservations.value.map((item) =>
      item.id === id ? { ...item, status: "cancelled", endReason: "待入场阶段取消预约" } : item
    );
    logEvent({
      type: "cancel",
      reservationId: id,
      plate: target.plate,
      dockId: target.dockId,
      message: "取消预约，装卸位释放"
    });
    persist();
    return true;
  }

  function isLocked(item: Reservation): boolean {
    return LOCKED_STATUSES.includes(item.status);
  }

  function clearConflicts(): void {
    conflicts.value = [];
  }

  function resetDemo(): void {
    const seed = buildSeedSnapshot();
    docks.value = seed.docks;
    reservations.value = seed.reservations;
    events.value = seed.events;
    persist();
  }

  return {
    // state
    docks,
    reservations,
    events,
    conflicts,
    now,
    // getters
    activeReservations,
    occupiedDockIds,
    releaseHistory,
    // actions
    tick,
    dockById,
    checkBooking,
    book,
    checkIn,
    startLoading,
    completeRelease,
    reschedule,
    cancelLoadingWithRebook,
    cancelReserved,
    isLocked,
    clearConflicts,
    resetDemo
  };
});

export function newSlot(startOffsetHours = 1): { startAt: string; endAt: string } {
  const startAt = defaultSlotStart(new Date(Date.now() + startOffsetHours * 60 * 60 * 1000));
  return { startAt, endAt: defaultSlotEnd(startAt) };
}
