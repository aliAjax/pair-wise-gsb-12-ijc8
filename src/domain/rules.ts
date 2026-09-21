// 领域规则层：预约 / 放行 / 改约 / 取消的全部业务校验都在这里，
// 页面与存储只能调用这里的结论，不自己实现规则。

import {
  HOLDING_STATUSES,
  tempZoneMeta,
  dockKindMeta,
  type BookingConflict,
  type Dock,
  type Reservation,
  type ReservationStatus,
  type RuleCode
} from "./types";
import { formatRange, rangesOverlap } from "./time";

/** 超时未入场宽限期：时段开始后超过该时长仍未入场，系统自动释放 */
export const NO_SHOW_GRACE_MS = 30 * 60 * 1000;

export interface BookingInput {
  plate: string;
  tempZone: string;
  dockId: string;
  startAt: string | null;
  endAt: string | null;
}

export interface RuleContext {
  docks: Dock[];
  reservations: Reservation[];
  /** 改约时排除自身 */
  excludeReservationId?: string;
  now?: string;
}

export const ruleLabels: Record<RuleCode, string> = {
  REQUIRED: "预约信息必须完整：车牌、温区、装卸位和时段均为必填",
  TIME_RANGE: "时段结束必须晚于开始",
  TIME_PAST: "预约开始时间不能早于当前时间",
  COLD_DOCK: "冷链车（冷藏/冷冻温区）只能预约冷藏位",
  DOCK_OVERLAP: "同一装卸位的预约时段不得重叠",
  STATE_LOCKED: "车辆入场后预约已锁定，不能改约或删除",
  RELEASE_FIELDS: "放行资料缺项：铅封号、净重（正数）、备注缺一不可",
  CANCEL_REASON: "装卸中终止必须填写取消原因，并据此生成新预约"
};

function dockLabel(dockId: string, docks: Dock[]): string {
  const dock = docks.find((item) => item.id === dockId);
  return dock ? `${dock.name}（${dockKindMeta[dock.kind].label}）` : dockId;
}

function conflict(
  partial: Omit<BookingConflict, "ruleLabel">
): BookingConflict {
  return { ...partial, ruleLabel: ruleLabels[partial.rule] };
}

/**
 * 校验一次预约 / 改约。
 * 返回冲突清单（空数组表示通过）。每条冲突列出车牌、装卸位、时段与命中规则。
 */
export function validateBooking(
  input: BookingInput,
  context: RuleContext
): BookingConflict[] {
  const conflicts: BookingConflict[] = [];
  const now = context.now ?? new Date().toISOString();
  const dock = context.docks.find((item) => item.id === input.dockId);
  const dockText = input.dockId ? dockLabel(input.dockId, context.docks) : "未选择装卸位";
  const rangeText =
    input.startAt && input.endAt ? formatRange(input.startAt, input.endAt) : "未选择时段";
  const plate = input.plate.trim() || "未填写车牌";

  // 规则 1：必填项
  const missing: string[] = [];
  if (!input.plate.trim()) missing.push("车牌");
  if (!input.tempZone) missing.push("温区");
  if (!input.dockId) missing.push("装卸位");
  if (!input.startAt || !input.endAt) missing.push("时段");
  if (missing.length > 0) {
    conflicts.push(
      conflict({
        rule: "REQUIRED",
        plate,
        dockId: input.dockId || "",
        dockLabel: dockText,
        startAt: input.startAt ?? "",
        endAt: input.endAt ?? "",
        detail: `缺少：${missing.join("、")}`
      })
    );
  }

  // 规则 2：时段合法
  if (input.startAt && input.endAt) {
    if (new Date(input.endAt) <= new Date(input.startAt)) {
      conflicts.push(
        conflict({
          rule: "TIME_RANGE",
          plate,
          dockId: input.dockId || "",
          dockLabel: dockText,
          startAt: input.startAt,
          endAt: input.endAt,
          detail: rangeText
        })
      );
    }

    // 规则 3：不得预约过去时段（改约同样适用）
    if (new Date(input.startAt).getTime() < new Date(now).getTime()) {
      conflicts.push(
        conflict({
          rule: "TIME_PAST",
          plate,
          dockId: input.dockId || "",
          dockLabel: dockText,
          startAt: input.startAt,
          endAt: input.endAt,
          detail: `当前 ${formatRange(now, now).split(" ~ ")[0]}，预约开始于 ${formatDateTimeSafe(
            input.startAt
          )}`
        })
      );
    }
  }

  // 规则 4：冷链车只能用冷藏位
  if (input.tempZone && dock) {
    const isColdCargo = tempZoneMeta[input.tempZone as keyof typeof tempZoneMeta]?.cold;
    if (isColdCargo && dock.kind !== "cold") {
      conflicts.push(
        conflict({
          rule: "COLD_DOCK",
          plate,
          dockId: dock.id,
          dockLabel: dockText,
          startAt: input.startAt ?? "",
          endAt: input.endAt ?? "",
          detail: `温区为${
            tempZoneMeta[input.tempZone as keyof typeof tempZoneMeta].label
          }，${dock.name} 是普通位`
        })
      );
    }
  }

  // 规则 5：同一装卸位时段不得重叠（仅与活跃预约比较；终态不占位）
  if (input.dockId && input.startAt && input.endAt) {
    for (const existing of context.reservations) {
      if (existing.id === context.excludeReservationId) continue;
      if (existing.dockId !== input.dockId) continue;
      if (!HOLDING_STATUSES.includes(existing.status)) continue;
      if (rangesOverlap(input.startAt, input.endAt, existing.startAt, existing.endAt)) {
        conflicts.push(
          conflict({
            rule: "DOCK_OVERLAP",
            plate,
            dockId: input.dockId,
            dockLabel: dockText,
            startAt: input.startAt,
            endAt: input.endAt,
            detail: `与车牌 ${existing.plate} 的预约 ${formatRange(
              existing.startAt,
              existing.endAt
            )} 冲突`
          })
        );
      }
    }
  }

  return conflicts;
}

export interface ReleaseInput {
  sealNo: string;
  netWeight: number | null;
  releaseNotes: string;
}

/** 规则 6：装卸完成放行资料必须齐全 */
export function validateRelease(
  reservation: Reservation,
  input: ReleaseInput
): BookingConflict[] {
  const missing: string[] = [];
  if (!input.sealNo.trim()) missing.push("铅封号");
  if (input.netWeight === null || !Number.isFinite(input.netWeight) || input.netWeight <= 0) {
    missing.push("净重");
  }
  if (!input.releaseNotes.trim()) missing.push("备注");

  if (missing.length === 0) return [];
  return [
    conflict({
      rule: "RELEASE_FIELDS",
      plate: reservation.plate,
      dockId: reservation.dockId,
      dockLabel: "",
      startAt: reservation.startAt,
      endAt: reservation.endAt,
      detail: `未填写：${missing.join("、")}`
    })
  ];
}

/** 规则 7：入场后锁定，不允许改约 */
export function canReschedule(status: ReservationStatus): boolean {
  return status === "reserved";
}

/** 装卸中终止必须填原因 */
export function validateCancelLoading(reason: string): BookingConflict[] {
  if (reason.trim()) return [];
  return [
    conflict({
      rule: "CANCEL_REASON",
      plate: "",
      dockId: "",
      dockLabel: "",
      startAt: "",
      endAt: "",
      detail: "原因未填写"
    })
  ];
}

/** 超时未入场：已过开始时间 + 宽限期，且仍停留在待入场 */
export function isNoShow(reservation: Reservation, nowIso: string): boolean {
  if (reservation.status !== "reserved") return false;
  const deadline = new Date(reservation.startAt).getTime() + NO_SHOW_GRACE_MS;
  return new Date(nowIso).getTime() > deadline;
}

export function formatDateTimeSafe(iso: string): string {
  return formatRange(iso, iso).split(" ~ ")[0];
}
