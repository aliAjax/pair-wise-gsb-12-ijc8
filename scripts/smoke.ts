/* 领域规则 + store 闭环冒烟测试，Node 下运行（esbuild 转译） */
import { createPinia, setActivePinia } from "pinia";
import { useDockStore } from "../src/stores/dockStore";
import { validateBooking } from "../src/domain/rules";
import { buildSeedSnapshot } from "../src/services/seed";
import type { AppSnapshot } from "../src/services/storage";

let passed = 0;
let failed = 0;

function assert(cond: boolean, message: string) {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error("✗ " + message);
  }
}

// localStorage 内存桩
const memory = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => memory.set(key, value),
  removeItem: (key: string) => memory.delete(key)
};
Object.defineProperty(globalThis, "crypto", {
  value: { randomUUID: () => "u-" + Math.random().toString(36).slice(2) },
  configurable: true
});

const HOUR = 3600_000;
const now = Date.now();
const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();

// ---------- 纯规则 ----------
const { docks, reservations: seedRes } = buildSeedSnapshot();

// 同一位时段重叠 → 冲突
const overlap = validateBooking(
  { plate: "沪Z·0001", tempZone: "normal", dockId: "D-01", startAt: iso(2 * HOUR + 10 * 60000), endAt: iso(2 * HOUR + 40 * 60000) },
  { docks, reservations: seedRes }
);
assert(overlap.some((c) => c.rule === "DOCK_OVERLAP"), "同装卸位重叠时段应报 DOCK_OVERLAP");
assert(overlap[0].plate === "沪Z·0001" && !!overlap[0].dockLabel && !!overlap[0].ruleLabel, "冲突须列出车牌/装卸位/规则");

// 相邻不重叠（前一个结束 = 后一个开始）→ 无冲突
const adjacent = validateBooking(
  { plate: "沪Z·0002", tempZone: "normal", dockId: "D-01", startAt: iso(3 * HOUR), endAt: iso(4 * HOUR) },
  { docks, reservations: seedRes }
);
assert(!adjacent.some((c) => c.rule === "DOCK_OVERLAP"), "首尾相接时段不算重叠");

// 冷链车选普通位 → 冲突；选冷藏位 → 无冲突
assert(
  validateBooking({ plate: "沪Z·0003", tempZone: "chilled", dockId: "D-03", startAt: iso(5 * HOUR), endAt: iso(6 * HOUR) }, { docks, reservations: seedRes }).some((c) => c.rule === "COLD_DOCK"),
  "冷链车不能预约普通位"
);
assert(
  !validateBooking({ plate: "沪Z·0003", tempZone: "chilled", dockId: "D-02", startAt: iso(5 * HOUR), endAt: iso(6 * HOUR) }, { docks, reservations: seedRes }).some((c) => c.rule === "COLD_DOCK"),
  "冷链车可以预约冷藏位"
);

// 常温车上冷藏位不禁止
assert(
  !validateBooking({ plate: "沪Z·0004", tempZone: "normal", dockId: "D-01", startAt: iso(9 * HOUR), endAt: iso(10 * HOUR) }, { docks, reservations: seedRes }).some((c) => c.rule === "COLD_DOCK"),
  "常温车可以使用冷藏位"
);

// 过去时段
assert(
  validateBooking({ plate: "沪Z·0005", tempZone: "normal", dockId: "D-03", startAt: iso(-HOUR), endAt: iso(30 * 60000) }, { docks, reservations: seedRes }).some((c) => c.rule === "TIME_PAST"),
  "不能预约过去开始的时段"
);

// 必填缺失
const missing = validateBooking({ plate: "  ", tempZone: "", dockId: "", startAt: null, endAt: null }, { docks, reservations: seedRes });
assert(missing.some((c) => c.rule === "REQUIRED"), "缺项须报 REQUIRED");

// ---------- store 闭环 ----------
setActivePinia(createPinia());
memory.clear();
const store = useDockStore();
store.tick(new Date(now).toISOString());

// seed-3 是 26 小时前的待入场预约 → 自动超时释放
const noShowOne = store.reservations.find((r) => r.id === "seed-3");
assert(noShowOne?.status === "noShow", "超时未入场应自动释放为 noShow");
assert(store.events.some((e) => e.type === "noShow" && e.reservationId === "seed-3"), "超时释放须写入历史");

// 完整预约成功
const r1 = store.book({ plate: "沪E·1001", tempZone: "normal", dockId: "D-03", startAt: iso(6 * HOUR), endAt: iso(7 * HOUR), notes: "测试单" });
assert(!!r1 && r1?.status === "reserved", "合法预约应创建成功");
assert(store.events[0].type === "book", "预约应写入历史");

// 重叠预约被拒
const blocked = store.book({ plate: "沪E·1002", tempZone: "normal", dockId: "D-03", startAt: iso(6 * HOUR + 15 * 60000), endAt: iso(7 * HOUR) });
assert(blocked === null && store.conflicts.some((c) => c.rule === "DOCK_OVERLAP"), "重叠预约必须被拒绝");

// 入场 → 锁定 → 开始装卸
assert(store.checkIn(r1!.id), "待入场预约可以入场");
assert(store.checkIn(r1!.id) === false, "已入场不能重复入场");
assert(store.startLoading(r1!.id), "已入场可开始装卸");

// 入场后改约被拒
store.clearConflicts();
const lockedRebook = store.reschedule(r1!.id, {
  plate: r1!.plate,
  tempZone: r1!.tempZone,
  dockId: "D-04",
  startAt: iso(8 * HOUR),
  endAt: iso(9 * HOUR)
});
assert(lockedRebook === null && store.conflicts.some((c) => c.rule === "STATE_LOCKED"), "入场后改约必须被拒绝（锁定）");

// 放行缺项
store.clearConflicts();
assert(store.completeRelease(r1!.id, { sealNo: "", netWeight: null, releaseNotes: "" }) === false, "放行资料缺项不得放行");
assert(store.conflicts.some((c) => c.rule === "RELEASE_FIELDS"), "缺项放行应报 RELEASE_FIELDS");
assert(store.completeRelease(r1!.id, { sealNo: "SL1", netWeight: -3, releaseNotes: "x" }) === false, "净重非正数不得放行");

// 资料齐全 → 放行
assert(store.completeRelease(r1!.id, { sealNo: "SL-20260921", netWeight: 8.75, releaseNotes: "铅封完好" }), "资料齐全应放行成功");
const released = store.reservations.find((r) => r.id === r1!.id);
assert(released?.status === "released" && released.sealNo === "SL-20260921" && released.netWeight === 8.75, "放行后字段须落库");

// 待入场改约：原位释放、生成新预约
const r2 = store.book({ plate: "沪E·2002", tempZone: "normal", dockId: "D-04", startAt: iso(6 * HOUR), endAt: iso(7 * HOUR) });
const moved = store.reschedule(r2!.id, {
  plate: r2!.plate,
  tempZone: r2!.tempZone,
  dockId: "D-03",
  startAt: iso(8 * HOUR),
  endAt: iso(9 * HOUR)
});
assert(!!moved, "待入场预约可以改约");
const oldOne = store.reservations.find((r) => r.id === r2!.id);
assert(oldOne?.status === "cancelled" && oldOne.rebookedTo === moved!.id, "改约后旧预约取消并关联新预约");
assert(moved!.rescheduledFrom === r2!.id && moved.status === "reserved", "新预约须关联来源并处于待入场");

// 装卸中取消：不填原因拒绝；填原因生成新预约
const r3 = store.book({ plate: "沪E·3003", tempZone: "normal", dockId: "D-04", startAt: iso(6 * HOUR), endAt: iso(7 * HOUR) });
store.checkIn(r3!.id);
store.startLoading(r3!.id);
assert(store.cancelLoadingWithRebook(r3!.id, "   ", { startAt: iso(8 * HOUR), endAt: iso(9 * HOUR) }) === null, "装卸中取消不填原因必须拒绝");
const rebooked = store.cancelLoadingWithRebook(r3!.id, "货物破损退回", { startAt: iso(8 * HOUR), endAt: iso(9 * HOUR) });
assert(!!rebooked && rebooked!.status === "reserved" && rebooked.dockId === "D-04", "装卸中终止后须生成同装卸位新预约");
assert(store.reservations.find((r) => r.id === r3!.id)?.status === "cancelled", "终止后原预约须取消");
assert(store.reservations.find((r) => r.id === r3!.id)?.endReason?.includes("货物破损退回"), "取消原因须留痕");

// 装卸中取消时新时段与他人冲突 → 拒绝且原预约不变
const r4 = store.book({ plate: "沪E·4004", tempZone: "normal", dockId: "D-03", startAt: iso(10 * HOUR), endAt: iso(11 * HOUR) });
store.checkIn(r4!.id);
store.startLoading(r4!.id);
const badCancel = store.cancelLoadingWithRebook(r4!.id, "原因", { startAt: iso(8 * HOUR + 5 * 60000), endAt: iso(9 * HOUR) });
assert(badCancel === null && store.reservations.find((r) => r.id === r4!.id)?.status === "loading", "终止重约遇冲突时原预约须保持装卸中");

// ---------- 持久化一致性 ----------
const raw = memory.get("dfwlfront-3-dock-reservation-v1");
assert(!!raw, "变更后必须写入 localStorage");
const snapshot = JSON.parse(raw!) as AppSnapshot;
assert(
  snapshot.reservations.length === store.reservations.length && snapshot.events.length === store.events.length,
  "快照须包含全部预约与历史"
);
setActivePinia(createPinia());
const reopened = useDockStore();
assert(reopened.reservations.length === store.reservations.length, "刷新（重新加载）后预约一致");
assert(reopened.events.length === store.events.length, "刷新后放行/操作历史一致");
const occupied = new Set(
  reopened.reservations.filter((r) => ["reserved", "checkedIn", "loading"].includes(r.status)).map((r) => r.dockId)
);
assert(reopened.occupiedDockIds.size === occupied.size, "刷新后装卸位占用与预约一致");

console.log(`\n通过 ${passed} 项，失败 ${failed} 项`);
if (failed > 0) process.exit(1);
