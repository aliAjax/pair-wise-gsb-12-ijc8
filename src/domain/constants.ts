import type {
  Dock,
  Reservation,
  RuleCode,
  TempZone,
  YardState,
} from "./types";

/** 温区标签 */
export const ZONE_LABELS: Record<TempZone, string> = {
  ambient: "常温",
  chilled: "冷藏 0~8℃",
  frozen: "冷冻 -18℃",
};

export const ZONE_OPTIONS: TempZone[] = ["ambient", "chilled", "frozen"];

/** 冷藏温区（冷链车）只能使用冷藏位 */
export const COLD_ZONES: TempZone[] = ["chilled", "frozen"];

export function isColdZone(zone: TempZone | ""): boolean {
  return zone !== "" && COLD_ZONES.includes(zone);
}

/** 装卸位目录：4 个普通位 + 3 个冷藏位 */
export const DOCKS: Dock[] = [
  { id: "A-01", name: "A-01 常温位", kind: "normal", zones: ["ambient"] },
  { id: "A-02", name: "A-02 常温位", kind: "normal", zones: ["ambient"] },
  { id: "B-01", name: "B-01 常温位", kind: "normal", zones: ["ambient"] },
  { id: "B-02", name: "B-02 常温位", kind: "normal", zones: ["ambient"] },
  { id: "C-01", name: "C-01 冷藏位", kind: "refrigerated", zones: ["chilled", "frozen"] },
  { id: "C-02", name: "C-02 冷藏位", kind: "refrigerated", zones: ["chilled", "frozen"] },
  { id: "C-03", name: "C-03 冷冻位", kind: "refrigerated", zones: ["chilled", "frozen"] },
];

export function dockById(id: string): Dock | undefined {
  return DOCKS.find((dock) => dock.id === id);
}

/** 规则编码 -> 中文说明（冲突列表与表单提示共用） */
export const RULE_LABELS: Record<RuleCode, string> = {
  R1_FIELD_REQUIRED: "预约信息不完整",
  R2_TIME_ORDER: "时段开始必须早于结束",
  R3_COLD_CHAIN_DOCK: "冷链车只能使用冷藏位",
  R4_SLOT_OVERLAP: "同一装卸位时段不得重叠",
  R5_LOCKED_STATE: "入场后预约已锁定",
  R6_GATE_FIELD_MISSING: "铅封号与净重缺项不得放行",
  R7_CANCEL_REASON_REQUIRED: "装卸中取消必须填写原因",
  R8_NOT_FOUND: "预约不存在或已被处理",
};

/** 允许入场的宽限分钟数：超过预约开始时间 15 分钟仍未入场，自动释放 */
export const ENTRY_GRACE_MINUTES = 15;

function at(base: Date, dayOffset: number, hh: number, mm: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
}

/** 从现在起 hourOffset 小时后的整点（保证演示数据在首次打开时仍处于待入场） */
function atRoundHour(now: Date, hourOffset: number): string {
  const d = new Date(now.getTime() + hourOffset * 3600000);
  d.setMinutes(0, 0, 0);
  return d.toISOString();
}

/** 在 ISO 时间上追加分钟 */
function plusMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60000).toISOString();
}

/** 种子数据：覆盖“今日待入场 / 装卸中待放行 / 已放行历史”三类初始场景 */
export function buildSeedState(now: Date = new Date()): YardState {
  const seed1Start = atRoundHour(now, 2);
  const reservations: Reservation[] = [
    {
      id: "seed-1",
      plate: "沪A-82L6",
      zone: "ambient",
      dockId: "A-01",
      startAt: seed1Start,
      endAt: plusMinutes(seed1Start, 90),
      notes: "商超补货，早到可排队",
      status: "booked",
      createdAt: at(now, -1, 16, 20),
    },
    {
      id: "seed-2",
      plate: "沪B-73K9",
      zone: "chilled",
      dockId: "C-01",
      startAt: new Date(now.getTime() - 30 * 60000).toISOString(),
      endAt: new Date(now.getTime() + 60 * 60000).toISOString(),
      notes: "医药冷链配送",
      status: "loading",
      createdAt: at(now, -1, 17, 5),
      enteredAt: new Date(now.getTime() - 32 * 60000).toISOString(),
    },
    {
      id: "seed-3",
      plate: "沪C-55T2",
      zone: "frozen",
      dockId: "C-03",
      startAt: at(now, -1, 14, 0),
      endAt: at(now, -1, 15, 0),
      notes: "冻品入库",
      status: "released",
      createdAt: at(now, -2, 10, 0),
      enteredAt: at(now, -1, 13, 55),
      sealNo: "SL2026092001",
      netWeightKg: 1280,
      completionNote: "温度记录正常，铅封完好",
      sealedAt: at(now, -1, 14, 50),
      releasedAt: at(now, -1, 15, 2),
    },
  ];

  const events = [
    {
      id: "seed-evt-1",
      at: reservations[2].releasedAt!,
      type: "released" as const,
      reservationId: "seed-3",
      plate: "沪C-55T2",
      dockId: "C-03",
      startAt: reservations[2].startAt,
      endAt: reservations[2].endAt,
      sealNo: "SL2026092001",
      netWeightKg: 1280,
      detail: "温度记录正常，铅封完好",
    },
  ];

  return { reservations, events };
}
