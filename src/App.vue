<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";

import { useYardStore } from "./stores/yard";
import type { BookingDraft, Conflict, Reservation } from "./domain/types";
import { ZONE_LABELS, ZONE_OPTIONS } from "./domain/constants";
import BaseModal from "./components/BaseModal.vue";
import BookingForm from "./components/BookingForm.vue";
import CompletionForm from "./components/CompletionForm.vue";
import AbortModal from "./components/AbortModal.vue";
import ConflictList from "./components/ConflictList.vue";
import OccupancyBoard from "./components/OccupancyBoard.vue";
import ReservationList from "./components/ReservationList.vue";
import HistoryPanel from "./components/HistoryPanel.vue";
import { STATUS_BADGE, STATUS_LABELS } from "./ui/labels";

const yard = useYardStore();

// ---------- 时钟与超时扫描 ----------
const nowTick = ref(Date.now());
const toast = ref<{ kind: "ok" | "warn"; text: string } | null>(null);
let toastTimer: ReturnType<typeof setTimeout> | undefined;
let sweepTimer: ReturnType<typeof setInterval> | undefined;

function showToast(kind: "ok" | "warn", text: string) {
  toast.value = { kind, text };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = null), 4000);
}

function runSweep(silent = false) {
  const n = yard.sweepExpired(new Date());
  if (n > 0 && !silent) showToast("warn", `${n} 辆车超时未入场，泊位已自动释放`);
}

onMounted(() => {
  runSweep();
  sweepTimer = setInterval(() => {
    nowTick.value = Date.now();
    runSweep(true);
  }, 30000);
});
onUnmounted(() => clearInterval(sweepTimer));

// ---------- 标签页与筛选 ----------
type Tab = "reservations" | "occupancy" | "history";
const tab = ref<Tab>("reservations");
const statusFilter = ref("all");
const zoneFilter = ref("all");
const plateQuery = ref("");

const statusFilterOptions = [
  { value: "all", label: "全部状态" },
  { value: "active", label: "进行中（待入场+装卸中）" },
  { value: "booked", label: "待入场" },
  { value: "loading", label: "装卸中" },
  { value: "released", label: "已放行" },
  { value: "expired", label: "超时释放" },
  { value: "rescheduled", label: "已改约" },
  { value: "aborted", label: "装卸取消" },
];

const filteredReservations = computed(() => {
  const q = plateQuery.value.trim().toUpperCase();
  return yard.reservations
    .filter((r) => {
      if (statusFilter.value === "active") {
        if (r.status !== "booked" && r.status !== "loading") return false;
      } else if (statusFilter.value !== "all" && r.status !== statusFilter.value) {
        return false;
      }
      if (zoneFilter.value !== "all" && r.zone !== zoneFilter.value) return false;
      if (q && !r.plate.toUpperCase().includes(q)) return false;
      return true;
    })
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
});

// ---------- 弹窗状态 ----------
type ModalKind = "" | "create" | "reschedule" | "complete" | "abort";
const modal = ref<ModalKind>("");
const activeReservation = ref<Reservation | null>(null);
/** 仅属于当前弹窗的冲突（全局 yard.lastConflicts 展示在顶部） */
const modalConflicts = ref<Conflict[]>([]);
const formKey = ref(0);

function openCreate() {
  activeReservation.value = null;
  modalConflicts.value = [];
  formKey.value += 1;
  modal.value = "create";
}
function openReschedule(r: Reservation) {
  activeReservation.value = r;
  modalConflicts.value = [];
  formKey.value += 1;
  modal.value = "reschedule";
}
function openComplete(r: Reservation) {
  activeReservation.value = r;
  modalConflicts.value = [];
  modal.value = "complete";
}
function openAbort(r: Reservation) {
  activeReservation.value = r;
  modalConflicts.value = [];
  formKey.value += 1;
  modal.value = "abort";
}
function closeModal() {
  modal.value = "";
  activeReservation.value = null;
  modalConflicts.value = [];
  yard.dismissConflicts();
}

// ---------- 操作处理 ----------
function handleCreate(draft: BookingDraft) {
  const res = yard.createReservation(draft);
  if (res.ok) {
    showToast("ok", `预约成功：${draft.plate} · ${draft.dockId}`);
    closeModal();
  } else {
    modalConflicts.value = res.conflicts;
  }
}

function handleEnter(r: Reservation) {
  const res = yard.enter(r.id);
  if (res.ok) showToast("ok", `${r.plate} 已入场，预约锁定`);
  else showToast("warn", res.conflicts[0]?.message ?? "入场失败");
}

function handleReschedule(draft: BookingDraft) {
  if (!activeReservation.value) return;
  const res = yard.reschedule(activeReservation.value.id, draft);
  if (res.ok) {
    showToast("ok", `已释放原泊位并生成新预约：${draft.plate} · ${draft.dockId}`);
    closeModal();
  } else {
    modalConflicts.value = res.conflicts;
  }
}

function handleCancelBooking(r: Reservation) {
  if (!window.confirm(`确认取消 ${r.plate} 的预约？原泊位将立即释放。`)) return;
  const res = yard.cancelBooking(r.id);
  if (res.ok) showToast("ok", "预约已取消，泊位已释放");
  else showToast("warn", res.conflicts[0]?.message ?? "取消失败");
}

function handleSaveCompletion(payload: {
  sealNo: string;
  netWeightKg: number | undefined;
  completionNote: string;
}) {
  if (!activeReservation.value) return;
  const res = yard.saveCompletion(activeReservation.value.id, payload);
  if (res.ok) showToast("ok", "装卸信息已暂存（仍需校验通过后放行）");
  else modalConflicts.value = res.conflicts;
}

function handleRelease(payload: {
  sealNo: string;
  netWeightKg: number | undefined;
  completionNote: string;
}) {
  if (!activeReservation.value) return;
  const res = yard.release(activeReservation.value.id, payload);
  if (res.ok) {
    showToast("ok", `${payload.sealNo} 已登记，车辆放行完成`);
    closeModal();
  } else {
    modalConflicts.value = res.conflicts;
  }
}

function handleAbort(reason: string, draft: BookingDraft) {
  if (!activeReservation.value) return;
  const res = yard.abortLoading(activeReservation.value.id, reason, draft);
  if (res.ok) {
    showToast("ok", `已中断并释放泊位，新预约 ${draft.plate} 已生成`);
    closeModal();
  } else {
    modalConflicts.value = res.conflicts;
  }
}

/** 看板点击卡片：进行中直接打开对应操作，其它跳到预约列表 */
function selectFromBoard(r: Reservation) {
  if (r.status === "loading") openComplete(r);
  else if (r.status === "booked") {
    statusFilter.value = "active";
    tab.value = "reservations";
  }
}

const activeCompletionTarget = computed(
  () =>
    activeReservation.value
      ? yard.getReservation(activeReservation.value.id) ?? activeReservation.value
      : null,
);
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">物流园区 · 预约入场闭环</p>
          <h1>园区装卸位预约与放行系统</h1>
          <p class="subtitle">
            预约（车牌 / 温区 / 装卸位 / 时段）→ 超时自动释放 → 入场锁定 → 录入铅封号、净重 → 缺项不放行 → 放行历史可溯。
            数据持久化在浏览器，刷新后预约、占用与历史保持一致。
          </p>
        </div>
        <div class="stack">
          <span class="tag">Vue3</span>
          <span class="tag">Pinia</span>
          <span class="tag">TypeScript</span>
          <span class="tag">领域规则引擎</span>
        </div>
      </header>

      <section class="metrics">
        <article class="metric">
          <span>待入场预约</span>
          <strong>{{ yard.metrics.booked }}</strong>
        </article>
        <article class="metric">
          <span>装卸中（泊位锁定）</span>
          <strong>{{ yard.metrics.loading }}</strong>
        </article>
        <article class="metric">
          <span>今日已放行</span>
          <strong>{{ yard.metrics.releasedToday }}</strong>
        </article>
        <article class="metric">
          <span>累计超时释放</span>
          <strong>{{ yard.metrics.expired }}</strong>
        </article>
      </section>

      <!-- 全局规则冲突区 -->
      <ConflictList
        :conflicts="yard.lastConflicts"
        title="最近一次操作命中业务规则"
      />

      <div v-if="toast" class="toast" :class="toast.kind">{{ toast.text }}</div>

      <nav class="tabs">
        <button type="button" :class="tab === 'reservations' ? 'tab-on' : 'secondary'" @click="tab = 'reservations'">
          预约与作业
        </button>
        <button type="button" :class="tab === 'occupancy' ? 'tab-on' : 'secondary'" @click="tab = 'occupancy'">
          泊位占用
        </button>
        <button type="button" :class="tab === 'history' ? 'tab-on' : 'secondary'" @click="tab = 'history'">
          放行历史 / 流水
        </button>
      </nav>

      <!-- 预约与作业 -->
      <section v-if="tab === 'reservations'" class="list-panel">
        <div class="toolbar">
          <h2>预约列表</h2>
          <div class="filters">
            <input v-model="plateQuery" class="plate-search" placeholder="搜索车牌" />
            <select v-model="zoneFilter">
              <option value="all">全部温区</option>
              <option v-for="z in ZONE_OPTIONS" :key="z" :value="z">{{ ZONE_LABELS[z] }}</option>
            </select>
            <select v-model="statusFilter">
              <option v-for="o in statusFilterOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
            <button type="button" @click="openCreate">+ 新建预约</button>
          </div>
        </div>

        <ReservationList
          :items="filteredReservations"
          :now-tick="nowTick"
          @enter="handleEnter"
          @complete="openComplete"
          @reschedule="openReschedule"
          @abort="openAbort"
          @cancel="handleCancelBooking"
        />

        <div v-if="statusFilter === 'all'" class="status-legend">
          <p class="legend-title">状态流转：</p>
          <span class="badge badge-booked">待入场</span>
          <span class="arrow">→</span>
          <span class="badge badge-loading">装卸中（锁定）</span>
          <span class="arrow">→</span>
          <span class="badge badge-released">已放行</span>
          <span class="arrow">／</span>
          <span class="badge badge-expired">超时释放</span>
          <span class="badge badge-rescheduled">改约释放</span>
          <span class="badge badge-aborted">装卸取消</span>
        </div>
      </section>

      <!-- 泊位占用 -->
      <section v-else-if="tab === 'occupancy'" class="list-panel">
        <div class="toolbar">
          <h2>泊位实时占用</h2>
          <p class="occ-tip">仅“待入场 / 装卸中”预约占用泊位；释放、超时、改约后立即腾位。点击卡片可处理作业。</p>
        </div>
        <OccupancyBoard :occupancy="yard.occupancy" :now-tick="nowTick" @select="selectFromBoard" />
      </section>

      <!-- 历史 -->
      <section v-else class="list-panel">
        <HistoryPanel :events="yard.historyEvents" />
      </section>

      <!-- 新建预约弹窗 -->
      <BaseModal
        v-if="modal === 'create'"
        title="新建装卸位预约"
        subtitle="冷链车只能选冷藏位；同一位时段重叠将被拦截"
        @close="closeModal"
      >
        <BookingForm
          :key="`create-${formKey}`"
          :reservations="yard.reservations"
          submit-text="提交预约"
          live-preview
          @submit="handleCreate"
          @cancel="closeModal"
        />
        <ConflictList :conflicts="modalConflicts" title="预约被规则拦截" />
      </BaseModal>

      <!-- 改约弹窗 -->
      <BaseModal
        v-if="modal === 'reschedule' && activeReservation"
        title="改约（先释放原泊位）"
        subtitle="原预约立即释放并写入流水，再按新信息校验生成预约"
        @close="closeModal"
      >
        <p class="rebook-from">
          原预约：{{ activeReservation.plate }} · {{ activeReservation.dockId }}
          · <span :class="STATUS_BADGE[activeReservation.status]">{{ STATUS_LABELS[activeReservation.status] }}</span>
        </p>
        <BookingForm
          :key="`rsv-${formKey}`"
          :reservations="yard.reservations"
          :ignore-id="activeReservation.id"
          :initial="{
            plate: activeReservation.plate,
            zone: activeReservation.zone,
            dockId: activeReservation.dockId,
            startAt: activeReservation.startAt,
            endAt: activeReservation.endAt,
            notes: activeReservation.notes,
          }"
          submit-text="释放原位并改约"
          live-preview
          @submit="handleReschedule"
          @cancel="closeModal"
        />
        <ConflictList :conflicts="modalConflicts" title="改约被规则拦截（原预约未释放）" />
      </BaseModal>

      <!-- 录入 / 放行弹窗 -->
      <BaseModal
        v-if="modal === 'complete' && activeCompletionTarget"
        title="装卸完成录入与放行"
        subtitle="铅封号、净重为放行必填项，缺项不得放行"
        @close="closeModal"
      >
        <CompletionForm
          :key="activeCompletionTarget.id"
          :reservation="activeCompletionTarget"
          :conflicts="modalConflicts"
          @save="handleSaveCompletion"
          @release="handleRelease"
          @close="closeModal"
        />
      </BaseModal>

      <!-- 装卸中取消弹窗 -->
      <AbortModal
        v-if="modal === 'abort' && activeReservation"
        :reservation="activeReservation"
        :reservations="yard.reservations"
        :conflicts="modalConflicts"
        @confirm="handleAbort"
        @close="closeModal"
      />
    </div>
  </main>
</template>
