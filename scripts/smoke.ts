// 冒烟测试：直接跑领域规则 + Pinia store（mock localStorage），验证闭环。
// 运行：npx esbuild scripts/smoke.ts --bundle --platform=node --format=esm | node
import { setActivePinia, createPinia } from "pinia";
import { useYardStore } from "../src/stores/yard";
import type { BookingDraft } from "../src/domain/types";

const storeObj: Record<string, string> = {};
(globalThis as any).localStorage = {
  getItem: (k: string) => (k in storeObj ? storeObj[k] : null),
  setItem: (k: string, v: string) => { storeObj[k] = v; },
  removeItem: (k: string) => { delete storeObj[k]; },
};

let seq = 0;
Object.defineProperty(globalThis, "crypto", {
  value: { randomUUID: () => `test-uuid-${seq++}` },
  configurable: true,
  writable: true,
});

/** 今天 hh:mm（本地时区）的 ISO */
function atToday(hh: number, mm: string | number = 0): string {
  const d = new Date();
  d.setHours(hh, Number(mm), 0, 0);
  return d.toISOString();
}
/** 相对今天第 dayOffset 天 hh:mm 的 ISO */
function atDay(dayOffset: number, hh: number, mm: string | number = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hh, Number(mm), 0, 0);
  return d.toISOString();
}

let pass = 0;
let fail = 0;
function assert(cond: boolean, msg: string) {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg}`); }
}

function draft(over: Partial<BookingDraft> = {}): BookingDraft {
  return {
    plate: "沪A-TEST",
    zone: "ambient",
    dockId: "A-02",
    startAt: atDay(1, 9),
    endAt: atDay(1, 10),
    notes: "",
    ...over,
  };
}

// ---- 空库起测（storage 已 mock 为空）----
setActivePinia(createPinia());
const yard = useYardStore();
yard.reservations = [];
yard.events = [];

console.log("R1 必填项");
{
  const r = yard.createReservation({ plate: "", zone: "", dockId: "", startAt: "", endAt: "", notes: "" });
  assert(!r.ok && r.conflicts.some((c) => c.ruleCode === "R1_FIELD_REQUIRED"), "空表单被 R1 拦截");
}

console.log("R2 时间顺序");
{
  const r = yard.createReservation(draft({ startAt: atDay(1, 11), endAt: atDay(1, 10) }));
  assert(!r.ok && r.conflicts.some((c) => c.ruleCode === "R2_TIME_ORDER"), "开始晚于结束被 R2 拦截");
}

console.log("R3 冷链车只能用冷藏位");
{
  const r = yard.createReservation(draft({ zone: "chilled", dockId: "A-01" }));
  assert(!r.ok && r.conflicts.some((c) => c.ruleCode === "R3_COLD_CHAIN_DOCK"), "冷藏车选普通位被 R3 拦截");
  const r2 = yard.createReservation(draft({ zone: "chilled", dockId: "C-02" }));
  assert(r2.ok, "冷藏车选冷藏位通过");
}

console.log("R4 时段重叠");
{
  const a = yard.createReservation(draft({ plate: "沪A-ONE", dockId: "B-01", startAt: atDay(2, 9), endAt: atDay(2, 10) }));
  assert(a.ok, "首条预约成功");
  const b = yard.createReservation(draft({ plate: "沪A-TWO", dockId: "B-01", startAt: atDay(2, 9, 30), endAt: atDay(2, 10, 30) }));
  assert(!b.ok && b.conflicts[0]?.ruleCode === "R4_SLOT_OVERLAP", "同泊位重叠被 R4 拦截");
  assert(b.conflicts[0]?.againstPlate === "沪A-ONE", "冲突列出对方车牌");
  const c = yard.createReservation(draft({ plate: "沪A-TWO", dockId: "B-01", startAt: atDay(2, 10), endAt: atDay(2, 11) }));
  assert(c.ok, "首尾相接不算重叠");
  const d = yard.createReservation(draft({ plate: "沪A-THREE", dockId: "B-02", startAt: atDay(2, 9, 30), endAt: atDay(2, 10, 30) }));
  assert(d.ok, "不同泊位同时段允许");
}

console.log("入场锁定 + R6 放行缺项");
{
  const created = yard.createReservation(draft({ plate: "沪G-LOCK", dockId: "A-01", startAt: atDay(3, 9), endAt: atDay(3, 10) }));
  const id = created.reservationId!;
  assert(yard.enter(id).ok, "入场成功");
  const blocked = yard.release(id, { sealNo: "", netWeightKg: undefined, completionNote: "" });
  assert(!blocked.ok && blocked.conflicts[0]?.ruleCode === "R6_GATE_FIELD_MISSING", "缺铅封号/净重被 R6 拦截");
  const blocked2 = yard.release(id, { sealNo: "SL1", netWeightKg: 0, completionNote: "" });
  assert(!blocked2.ok, "净重为 0 不放行");
  // 锁定后改约被 R5 拦截
  const rs = yard.reschedule(id, draft({ plate: "沪G-LOCK", dockId: "A-02" }));
  assert(!rs.ok && rs.conflicts[0]?.ruleCode === "R5_LOCKED_STATE", "装卸中改约被 R5 拦截");
  const ok = yard.release(id, { sealNo: "SL999", netWeightKg: 1500, completionNote: "正常" });
  assert(ok.ok, "资料齐全放行成功");
  const rec = yard.getReservation(id)!;
  assert(rec.status === "released" && rec.releasedAt !== undefined, "状态为已放行并记录时间");
  const hist = yard.releaseHistory.find((e) => e.reservationId === id);
  assert(hist?.sealNo === "SL999" && hist.netWeightKg === 1500, "放行历史含铅封号与净重");
}

console.log("超时未入场自动释放");
{
  const created = yard.createReservation(draft({
    plate: "沪T-EXP",
    dockId: "A-01",
    startAt: new Date(Date.now() - 20 * 60000).toISOString(),
    endAt: new Date(Date.now() + 10 * 60000).toISOString(),
  }));
  const id = created.reservationId!;
  const n = yard.sweepExpired(new Date());
  assert(n >= 1, "扫描释放超时预约");
  assert(yard.getReservation(id)!.status === "expired", "状态为超时释放");
  // 释放后同泊位同时段可再约（不参与 R4）
  const again = yard.createReservation(draft({
    plate: "沪T-NEW", dockId: "A-01",
    startAt: new Date(Date.now() - 5 * 60000).toISOString(),
    endAt: new Date(Date.now() + 5 * 60000).toISOString(),
  }));
  assert(again.ok, "释放后泊位可再预约");
}

console.log("改约：先释放原位，再建新约");
{
  const created = yard.createReservation(draft({ plate: "沪R-CHG", dockId: "A-01", startAt: atDay(4, 9), endAt: atDay(4, 10) }));
  const oldId = created.reservationId!;
  yard.createReservation(draft({ plate: "沪R-OCC", dockId: "A-02", startAt: atDay(4, 9), endAt: atDay(4, 10) }));
  const blocked = yard.reschedule(oldId, draft({ plate: "沪R-CHG", dockId: "A-02", startAt: atDay(4, 9), endAt: atDay(4, 10) }));
  assert(!blocked.ok, "改约新时段有冲突被拦截");
  assert(yard.getReservation(oldId)!.status === "booked", "冲突时原预约回滚不释放");
  const ok = yard.reschedule(oldId, draft({ plate: "沪R-CHG", dockId: "A-02", startAt: atDay(4, 10), endAt: atDay(4, 11) }));
  assert(ok.ok, "改约成功");
  assert(yard.getReservation(oldId)!.status === "rescheduled", "原预约已释放");
  const nr = yard.getReservation(ok.reservationId!)!;
  assert(nr.rebookedFromId === oldId && nr.dockId === "A-02", "新预约关联原预约且用新泊位");
  // 原位现在应可被同时间预约
  const refill = yard.createReservation(draft({ plate: "沪R-FILL", dockId: "A-01", startAt: atDay(4, 9), endAt: atDay(4, 10) }));
  assert(refill.ok, "原位释放后可被重新预约");
}

console.log("R7 装卸中取消：原因必填 + 生成新预约");
{
  const created = yard.createReservation(draft({ plate: "沪X-ABT", zone: "chilled", dockId: "C-01", startAt: atDay(5, 9), endAt: atDay(5, 10) }));
  const oldId = created.reservationId!;
  yard.enter(oldId);
  const noReason = yard.abortLoading(oldId, "", draft({ plate: "沪X-ABT", zone: "chilled", dockId: "C-01", startAt: atDay(5, 11), endAt: atDay(5, 12) }));
  assert(!noReason.ok && noReason.conflicts[0]?.ruleCode === "R7_CANCEL_REASON_REQUIRED", "无原因被 R7 拦截");
  assert(yard.getReservation(oldId)!.status === "loading", "拦截后仍为装卸中");
  const ok = yard.abortLoading(oldId, "制冷故障换车", draft({ plate: "沪X-ABT", zone: "chilled", dockId: "C-02", startAt: atDay(5, 11), endAt: atDay(5, 12) }));
  assert(ok.ok, "带原因取消成功并生成新预约");
  assert(yard.getReservation(oldId)!.status === "aborted", "原预约为装卸取消");
  assert(yard.getReservation(oldId)!.reason === "制冷故障换车", "原因已落库");
  const nr = yard.getReservation(ok.reservationId!)!;
  assert(nr.status === "booked" && nr.rebookedFromId === oldId, "新预约待入场并关联原单");
  assert(nr.notes.includes("制冷故障换车"), "新预约备注携带取消原因");
}

console.log("刷新一致性：持久化后重载");
{
  const raw = JSON.parse(storeObj["dfwlfront-3-yard-reservation-v1"]);
  assert(Array.isArray(raw.reservations) && Array.isArray(raw.events), "三类数据同一 key 持久化");
  // 模拟新会话
  setActivePinia(createPinia());
  const reloaded = useYardStore();
  assert(reloaded.reservations.length === yard.reservations.length, "刷新后预约数量一致");
  assert(reloaded.events.length === yard.events.length, "刷新后流水数量一致");
  assert(reloaded.occupancy.every((o) => o.items.every((r) => r.status === "booked" || r.status === "loading")), "占用看板只含在制预约");
  assert(reloaded.releaseHistory.length >= 1 && reloaded.releaseHistory.every((e) => e.sealNo && e.netWeightKg), "放行历史铅封/净重完整");
}

console.log(`\n结果：${pass} 通过，${fail} 失败`);
if (fail > 0) process.exit(1);
