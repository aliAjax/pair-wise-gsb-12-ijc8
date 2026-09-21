// 校验引擎：纯函数，不读写存储，不依赖框架。
// 规则：
//  R1 预约信息完整（车牌/温区/装卸位/时段）
//  R2 时段开始必须早于结束
//  R3 冷链车（冷藏/冷冻）只能使用冷藏位
//  R4 同一装卸位时段不得重叠（半开区间 [start, end)，首尾相接不算冲突）
//  R5 入场后预约锁定
//  R6 铅封号、净重缺项不得放行
//  R7 装卸中取消必须填写原因

import {
  DOCKS,
  RULE_LABELS,
  dockById,
  isColdZone,
} from "./constants";
import type {
  BookingDraft,
  Conflict,
  Reservation,
  ValidationResult,
} from "./types";
import { formatRange } from "./time";

const ACTIVE_STATUSES = new Set(["booked", "loading"]);

function baseConflict(
  draft: Pick<BookingDraft, "plate" | "dockId" | "startAt" | "endAt">,
  ruleCode: Conflict["ruleCode"],
  message: string,
  extra?: Partial<Conflict>,
): Conflict {
  const dock = draft.dockId ? dockById(draft.dockId) : undefined;
  return {
    plate: draft.plate.trim() || "（未填车牌）",
    dockName: dock ? dock.name : draft.dockId || "（未选装卸位）",
    startAt: draft.startAt,
    endAt: draft.endAt,
    ruleCode,
    ruleLabel: RULE_LABELS[ruleCode],
    message,
    ...extra,
  };
}

/** 半开区间重叠：aStart < bEnd && bStart < aEnd */
export function slotsOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  const as = new Date(aStart).getTime();
  const ae = new Date(aEnd).getTime();
  const bs = new Date(bStart).getTime();
  const be = new Date(bEnd).getTime();
  return as < be && bs < ae;
}

/**
 * 校验预约 / 改约草稿。
 * @param reservations 库内全部预约
 * @param ignoreId 改约 / 编辑时忽略自身
 */
export function validateDraft(
  draft: BookingDraft,
  reservations: Reservation[],
  ignoreId?: string,
): ValidationResult {
  const conflicts: Conflict[] = [];

  // R1 必填项
  const missing: string[] = [];
  if (!draft.plate.trim()) missing.push("车牌");
  if (!draft.zone) missing.push("温区");
  if (!draft.dockId) missing.push("装卸位");
  if (!draft.startAt) missing.push("开始时间");
  if (!draft.endAt) missing.push("结束时间");
  if (missing.length > 0) {
    conflicts.push(
      baseConflict(draft, "R1_FIELD_REQUIRED", `缺少必填项：${missing.join("、")}`),
    );
  }

  const dock = draft.dockId ? dockById(draft.dockId) : undefined;
  const timesPresent = Boolean(draft.startAt && draft.endAt);

  // R2 时间顺序
  if (
    timesPresent &&
    new Date(draft.startAt).getTime() >= new Date(draft.endAt).getTime()
  ) {
    conflicts.push(
      baseConflict(
        draft,
        "R2_TIME_ORDER",
        `时段非法：${formatRange(draft.startAt, draft.endAt)}，开始时间必须早于结束时间`,
      ),
    );
  }

  // R3 冷链车只能用冷藏位
  if (draft.zone && dock && isColdZone(draft.zone) && dock.kind !== "refrigerated") {
    conflicts.push(
      baseConflict(
        draft,
        "R3_COLD_CHAIN_DOCK",
        `冷链车（${draft.plate.trim() || "未填车牌"}）预约${draft.zone === "chilled" ? "冷藏" : "冷冻"}温区，只能使用冷藏位；${dock.name}为普通位`,
      ),
    );
  }

  // R4 装卸位时段重叠（只与仍占用泊位的预约比较：已预约 / 装卸中）
  if (timesPresent && dock && (!conflicts.some((c) => c.ruleCode === "R2_TIME_ORDER"))) {
    for (const other of reservations) {
      if (other.id === ignoreId) continue;
      if (!ACTIVE_STATUSES.has(other.status)) continue;
      if (other.dockId !== draft.dockId) continue;
      if (slotsOverlap(draft.startAt, draft.endAt, other.startAt, other.endAt)) {
        conflicts.push(
          baseConflict(draft, "R4_SLOT_OVERLAP", "时段与同泊位预约冲突", {
            againstPlate: other.plate,
            againstStartAt: other.startAt,
            againstEndAt: other.endAt,
            message: `与 ${other.plate} 在 ${dock.name} 的 ${formatRange(other.startAt, other.endAt)} 时段重叠`,
          }),
        );
      }
    }
  }

  return { valid: conflicts.length === 0, conflicts };
}

/** R6 放行闸口校验：铅封号、净重缺一不可，净重必须为正数 */
export function validateGateCheck(reservation: Reservation): ValidationResult {
  const missing: string[] = [];
  if (!reservation.sealNo?.trim()) missing.push("铅封号");
  if (
    reservation.netWeightKg === undefined ||
    Number.isNaN(reservation.netWeightKg) ||
    reservation.netWeightKg <= 0
  ) {
    missing.push("净重");
  }
  if (missing.length === 0) return { valid: true, conflicts: [] };

  const dock = dockById(reservation.dockId);
  return {
    valid: false,
    conflicts: [
      {
        plate: reservation.plate,
        dockName: dock?.name ?? reservation.dockId,
        startAt: reservation.startAt,
        endAt: reservation.endAt,
        ruleCode: "R6_GATE_FIELD_MISSING",
        ruleLabel: RULE_LABELS.R6_GATE_FIELD_MISSING,
        message: `${reservation.plate} 缺少 ${missing.join("、")}，补齐前不得放行`,
      },
    ],
  };
}

/** R7 装卸中取消必须填写原因 */
export function validateCancelReason(reason: string): ValidationResult {
  if (reason.trim()) return { valid: true, conflicts: [] };
  return {
    valid: false,
    conflicts: [
      {
        plate: "",
        dockName: "",
        startAt: "",
        endAt: "",
        ruleCode: "R7_CANCEL_REASON_REQUIRED",
        ruleLabel: RULE_LABELS.R7_CANCEL_REASON_REQUIRED,
        message: "装卸中取消必须填写取消原因，系统将据此生成新预约",
      },
    ],
  };
}

/** 供页面过滤可选装卸位：按温区收窄 */
export function docksForZone(zone: BookingDraft["zone"]) {
  if (!zone) return DOCKS;
  if (isColdZone(zone)) return DOCKS.filter((d) => d.kind === "refrigerated");
  return DOCKS.filter((d) => d.zones.includes(zone));
}
