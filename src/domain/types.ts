// 园区装卸位预约——领域模型层
// 纯数据结构与状态字典，不依赖 Vue / 存储 / UI。

/** 温区：冷链（冷藏/冷冻）车辆只能预约冷藏位 */
export type TempZone = "frozen" | "chilled" | "normal";

/** 装卸位类型：冷藏位与普通位 */
export type DockKind = "cold" | "standard";

/** 预约状态机：
 * reserved（已预约，可入场/改约/取消）
 * checkedIn（已入场，预约锁定）
 * loading（装卸中，可完成或终止）
 * released（已放行，终态）
 * cancelled（预约取消，终态）
 * noShow（超时未入场，系统释放，终态）
 */
export type ReservationStatus =
  | "reserved"
  | "checkedIn"
  | "loading"
  | "released"
  | "cancelled"
  | "noShow";

export interface Dock {
  id: string;
  name: string;
  kind: DockKind;
}

export interface Reservation {
  id: string;
  plate: string;
  tempZone: TempZone;
  dockId: string;
  startAt: string; // ISO 时间
  endAt: string; // ISO 时间
  status: ReservationStatus;
  notes: string;
  // 入场后锁定
  checkedInAt: string | null;
  // 装卸完成放行信息
  sealNo: string | null;
  netWeight: number | null;
  releaseNotes: string | null;
  releasedAt: string | null;
  // 终态原因（取消原因 / 超时释放说明）
  endReason: string | null;
  // 关联：改约来源、装卸中取消后生成的新预约
  rescheduledFrom: string | null;
  rebookedTo: string | null;
  createdAt: string;
}

/** 操作 / 放行历史事件，由状态变更派生式写入，刷新后与预约一致 */
export interface DockEvent {
  id: string;
  at: string;
  type: "book" | "checkIn" | "loading" | "release" | "cancel" | "rebook" | "noShow";
  reservationId: string;
  plate: string;
  dockId: string;
  message: string;
}

/** 规则编码：冲突清单与规则提示共用 */
export type RuleCode =
  | "REQUIRED"
  | "TIME_RANGE"
  | "TIME_PAST"
  | "COLD_DOCK"
  | "DOCK_OVERLAP"
  | "STATE_LOCKED"
  | "RELEASE_FIELDS"
  | "CANCEL_REASON";

/** 一条预约冲突：车牌、装卸位、时段、命中规则全部列清 */
export interface BookingConflict {
  rule: RuleCode;
  ruleLabel: string;
  plate: string;
  dockId: string;
  dockLabel: string;
  startAt: string;
  endAt: string;
  detail: string;
}

export const tempZoneMeta: Record<TempZone, { label: string; cold: boolean }> = {
  frozen: { label: "冷冻", cold: true },
  chilled: { label: "冷藏", cold: true },
  normal: { label: "常温", cold: false }
};

export const tempZoneOptions: TempZone[] = ["frozen", "chilled", "normal"];

export const dockKindMeta: Record<DockKind, { label: string }> = {
  cold: { label: "冷藏位" },
  standard: { label: "普通位" }
};

export const statusMeta: Record<
  ReservationStatus,
  { label: string; tone: "green" | "blue" | "amber" | "purple" | "gray" | "red" }
> = {
  reserved: { label: "待入场", tone: "blue" },
  checkedIn: { label: "已入场", tone: "amber" },
  loading: { label: "装卸中", tone: "purple" },
  released: { label: "已放行", tone: "green" },
  cancelled: { label: "已取消", tone: "gray" },
  noShow: { label: "超时释放", tone: "red" }
};

/** 占用装卸位的活跃状态 */
export const HOLDING_STATUSES: ReservationStatus[] = [
  "reserved",
  "checkedIn",
  "loading"
];

/** 入场后锁定，不允许改约 / 删除 */
export const LOCKED_STATUSES: ReservationStatus[] = ["checkedIn", "loading"];

/** 终态 */
export const TERMINAL_STATUSES: ReservationStatus[] = [
  "released",
  "cancelled",
  "noShow"
];
