// 初始数据：装卸位台账与演示预约，时间相对当前时刻生成，保证首次打开即可演示完整闭环。

import type { Dock, DockEvent, Reservation } from "../domain/types";

export const SEED_DOCKS: Dock[] = [
  { id: "D-01", name: "冷藏位 A", kind: "cold" },
  { id: "D-02", name: "冷藏位 B", kind: "cold" },
  { id: "D-03", name: "普通位 1", kind: "standard" },
  { id: "D-04", name: "普通位 2", kind: "standard" }
];

const HOUR = 60 * 60 * 1000;

export function buildSeedSnapshot(now: Date = new Date()) {
  const iso = (offsetMs: number) => new Date(now.getTime() + offsetMs).toISOString();

  const reservations: Reservation[] = [
    {
      id: "seed-1",
      plate: "沪B·73K9",
      tempZone: "chilled",
      dockId: "D-02",
      startAt: iso(-40 * 60 * 1000),
      endAt: iso(20 * 60 * 1000),
      status: "loading",
      notes: "生鲜配送，到场后优先安排",
      checkedInAt: iso(-35 * 60 * 1000),
      sealNo: null,
      netWeight: null,
      releaseNotes: null,
      releasedAt: null,
      endReason: null,
      rescheduledFrom: null,
      rebookedTo: null,
      createdAt: iso(-3 * HOUR)
    },
    {
      id: "seed-2",
      plate: "沪A·82L6",
      tempZone: "frozen",
      dockId: "D-01",
      startAt: iso(2 * HOUR),
      endAt: iso(3 * HOUR),
      status: "reserved",
      notes: "冷冻肉丸入库",
      checkedInAt: null,
      sealNo: null,
      netWeight: null,
      releaseNotes: null,
      releasedAt: null,
      endReason: null,
      rescheduledFrom: null,
      rebookedTo: null,
      createdAt: iso(-2 * HOUR)
    },
    {
      id: "seed-3",
      plate: "沪C·55T2",
      tempZone: "normal",
      dockId: "D-04",
      startAt: iso(-26 * HOUR),
      endAt: iso(-25 * HOUR),
      status: "reserved",
      notes: "演示超时自动释放",
      checkedInAt: null,
      sealNo: null,
      netWeight: null,
      releaseNotes: null,
      releasedAt: null,
      endReason: null,
      rescheduledFrom: null,
      rebookedTo: null,
      createdAt: iso(-27 * HOUR)
    },
    {
      id: "seed-4",
      plate: "沪D·91M8",
      tempZone: "normal",
      dockId: "D-03",
      startAt: iso(-24 * HOUR),
      endAt: iso(-23 * HOUR),
      status: "released",
      notes: "日用品补货",
      checkedInAt: iso(-24 * HOUR + 5 * 60000),
      sealNo: "SL2026092001",
      netWeight: 12.4,
      releaseNotes: "铅封完好，单据齐全",
      releasedAt: iso(-23 * HOUR),
      endReason: null,
      rescheduledFrom: null,
      rebookedTo: null,
      createdAt: iso(-25 * HOUR)
    }
  ];

  const events: DockEvent[] = [
    {
      id: "evt-seed-1",
      at: reservations[1].createdAt,
      type: "book",
      reservationId: "seed-2",
      plate: "沪A·82L6",
      dockId: "D-01",
      message: "预约 冷藏位 A"
    },
    {
      id: "evt-seed-2",
      at: reservations[0].createdAt,
      type: "book",
      reservationId: "seed-1",
      plate: "沪B·73K9",
      dockId: "D-02",
      message: "预约 冷藏位 B"
    },
    {
      id: "evt-seed-3",
      at: reservations[0].checkedInAt!,
      type: "checkIn",
      reservationId: "seed-1",
      plate: "沪B·73K9",
      dockId: "D-02",
      message: "车辆入场，预约锁定"
    },
    {
      id: "evt-seed-4",
      at: reservations[0].checkedInAt!,
      type: "loading",
      reservationId: "seed-1",
      plate: "沪B·73K9",
      dockId: "D-02",
      message: "开始装卸作业"
    },
    {
      id: "evt-seed-5",
      at: reservations[3].releasedAt!,
      type: "release",
      reservationId: "seed-4",
      plate: "沪D·91M8",
      dockId: "D-03",
      message: "放行：铅封 SL2026092001，净重 12.4 吨"
    }
  ];

  return { docks: SEED_DOCKS, reservations, events };
}
