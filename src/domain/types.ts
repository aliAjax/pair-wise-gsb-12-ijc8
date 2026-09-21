// 领域模型：园区装卸位预约与放行
// 本文件只描述业务概念与规则常量，不依赖 Vue / localStorage / Pinia。

export const STORAGE_KEY = "dfwlfront-3-yard-reservation-v1";

/** 温区：常温 / 冷藏 / 冷冻 */
export type TempZone = "ambient" | "chilled" | "frozen";
/** 装卸位类型：普通位 / 冷藏位（冷藏位支持冷链车，普通位不支持） */
export type DockKind = "normal" | "refrigerated";
/** 预约状态：已预约 / 入场装卸中 / 已放行 / 超时释放 / 改约释放 / 装卸取消 */
export type ReservationStatus =
  | "booked"
  | "loading"
  | "released"
  | "expired"
  | "rescheduled"
  | "aborted";

/** 历史事件类型 */
export type EventType =
  | "created"
  | "entered"
  | "released"
  | "expired"
  | "rescheduled"
  | "aborted";

/** 冲突所属业务规则 */
export type RuleCode =
  | "R1_FIELD_REQUIRED"
  | "R2_TIME_ORDER"
  | "R3_COLD_CHAIN_DOCK"
  | "R4_SLOT_OVERLAP"
  | "R5_LOCKED_STATE"
  | "R6_GATE_FIELD_MISSING"
  | "R7_CANCEL_REASON_REQUIRED"
  | "R8_NOT_FOUND";

/** 装卸位 */
export interface Dock {
  id: string;
  name: string;
  kind: DockKind;
  /** 该位支持的温区说明（展示用） */
  zones: TempZone[];
}

/** 预约表单 / 改约草稿 */
export interface BookingDraft {
  plate: string;
  zone: TempZone | "";
  dockId: string;
  /** ISO 时间字符串 */
  startAt: string;
  endAt: string;
  notes: string;
}

/** 已落库的预约 */
export interface Reservation extends BookingDraft {
  id: string;
  status: ReservationStatus;
  createdAt: string;
  /** 入场时间（锁定预约） */
  enteredAt?: string;
  /** 铅封号 */
  sealNo?: string;
  /** 净重（kg） */
  netWeightKg?: number;
  /** 装卸完成备注 */
  completionNote?: string;
  sealedAt?: string;
  /** 放行时间 */
  releasedAt?: string;
  /** 超时 / 取消原因 */
  reason?: string;
  /** 改约链：本预约被哪条新预约替代 */
  replacedById?: string;
  /** 改约链：本预约替代了哪条旧预约 */
  rebookedFromId?: string;
}

/** 历史流水（放行记录 + 其它流转记录） */
export interface HistoryEvent {
  id: string;
  at: string;
  type: EventType;
  reservationId: string;
  plate: string;
  dockId: string;
  startAt: string;
  endAt: string;
  detail?: string;
  /** 放行专用：铅封号 / 净重 */
  sealNo?: string;
  netWeightKg?: number;
  /** 改约指向的新预约 */
  newReservationId?: string;
}

/** 冲突明细：车牌、装卸位、时段、规则 */
export interface Conflict {
  plate: string;
  dockName: string;
  startAt: string;
  endAt: string;
  ruleCode: RuleCode;
  ruleLabel: string;
  /** 冲突的对方车牌 / 时段（重叠时给出） */
  againstPlate?: string;
  againstStartAt?: string;
  againstEndAt?: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  conflicts: Conflict[];
}

/** 存储结构：预约、占用与放行历史共用同一份持久化状态 */
export interface YardState {
  reservations: Reservation[];
  events: HistoryEvent[];
}
