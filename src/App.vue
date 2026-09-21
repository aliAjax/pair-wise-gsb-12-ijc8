<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useDockStore } from "./stores/dockStore";
import {
  statusMeta,
  type Reservation,
  type ReservationStatus
} from "./domain/types";
import { formatDateTime } from "./domain/time";
import BookingForm from "./components/BookingForm.vue";
import ConflictPanel from "./components/ConflictPanel.vue";
import DockBoard from "./components/DockBoard.vue";
import HistoryPanel from "./components/HistoryPanel.vue";
import ReservationCard from "./components/ReservationCard.vue";
import ReleaseDialog from "./components/ReleaseDialog.vue";
import RescheduleDialog from "./components/RescheduleDialog.vue";
import CancelLoadingDialog from "./components/CancelLoadingDialog.vue";

const store = useDockStore();

const filterOptions: Array<{ key: ReservationStatus | "active" | "all"; label: string }> = [
  { key: "active", label: "进行中" },
  { key: "all", label: "全部" },
  { key: "reserved", label: statusMeta.reserved.label },
  { key: "checkedIn", label: statusMeta.checkedIn.label },
  { key: "loading", label: statusMeta.loading.label },
  { key: "released", label: statusMeta.released.label },
  { key: "cancelled", label: "已取消/超时" }
];
const filter = ref<(typeof filterOptions)[number]["key"]>("active");
const plateQuery = ref("");

const filtered = computed(() => {
  const list = store.reservations.filter((item) => {
    if (filter.value === "active" && ["released", "cancelled", "noShow"].includes(item.status)) {
      return false;
    }
    if (
      filter.value === "cancelled" &&
      !(item.status === "cancelled" || item.status === "noShow")
    ) {
      return false;
    }
    if (
      !["active", "all", "cancelled"].includes(filter.value) &&
      item.status !== filter.value
    ) {
      return false;
    }
    if (plateQuery.value.trim() && !item.plate.includes(plateQuery.value.trim().toUpperCase())) {
      return false;
    }
    return true;
  });
  return [...list].sort((a, b) => {
    const rank = (s: ReservationStatus) =>
      s === "loading" ? 0 : s === "checkedIn" ? 1 : s === "reserved" ? 2 : 3;
    const ra = rank(a.status);
    const rb = rank(b.status);
    if (ra !== rb) return ra - rb;
    return new Date(b.startAt).getTime() - new Date(a.startAt).getTime();
  });
});

const metrics = computed(() => [
  { label: "待入场", value: store.reservations.filter((r) => r.status === "reserved").length },
  {
    label: "场内占用",
    value: store.reservations.filter((r) => r.status === "checkedIn" || r.status === "loading")
      .length
  },
  { label: "累计放行", value: store.reservations.filter((r) => r.status === "released").length }
]);

function dockOf(id: string) {
  return store.dockById(id);
}

function rebookTargetOf(item: Reservation) {
  if (!item.rebookedTo) return null;
  return store.reservations.find((r) => r.id === item.rebookedTo) ?? null;
}

// ---------- 对话框状态 ----------
const releaseTarget = ref<Reservation | null>(null);
const releaseError = ref<string | null>(null);
const rescheduleTarget = ref<Reservation | null>(null);
const cancelLoadingTarget = ref<Reservation | null>(null);
const formVersion = ref(0);

// ---------- 动作 ----------
function handleBook(input: {
  plate: string;
  tempZone: string;
  dockId: string;
  startAt: string;
  endAt: string;
  notes: string;
}) {
  const created = store.book(input);
  if (created) {
    formVersion.value += 1;
  }
}

function openRelease(item: Reservation) {
  releaseTarget.value = item;
  releaseError.value = null;
}

function confirmRelease(payload: {
  sealNo: string;
  netWeight: number | null;
  releaseNotes: string;
}) {
  if (!releaseTarget.value) return;
  const ok = store.completeRelease(releaseTarget.value.id, payload);
  if (ok) {
    releaseTarget.value = null;
    releaseError.value = null;
  } else {
    releaseError.value = store.conflicts[0]?.detail ?? store.conflicts[0]?.ruleLabel ?? null;
  }
}

function openReschedule(item: Reservation) {
  rescheduleTarget.value = item;
  store.clearConflicts();
}

function confirmReschedule(payload: { dockId: string; startAt: string; endAt: string }) {
  if (!rescheduleTarget.value) return;
  const target = rescheduleTarget.value;
  const created = store.reschedule(target.id, {
    plate: target.plate,
    tempZone: target.tempZone,
    dockId: payload.dockId,
    startAt: payload.startAt,
    endAt: payload.endAt
  });
  if (created) rescheduleTarget.value = null;
}

function openCancelLoading(item: Reservation) {
  cancelLoadingTarget.value = item;
  store.clearConflicts();
}

function confirmCancelLoading(payload: { reason: string; startAt: string; endAt: string }) {
  if (!cancelLoadingTarget.value) return;
  const created = store.cancelLoadingWithRebook(cancelLoadingTarget.value.id, payload.reason, {
    startAt: payload.startAt,
    endAt: payload.endAt
  });
  if (created) cancelLoadingTarget.value = null;
}

function confirmCancelReserved(item: Reservation) {
  if (window.confirm(`确认取消 ${item.plate} 的预约并释放装卸位？`)) {
    store.cancelReserved(item.id);
  }
}

// ---------- 超时自动释放轮询 ----------
let timer: number | undefined;
onMounted(() => {
  store.tick();
  timer = window.setInterval(() => store.tick(), 30 * 1000);
});
onBeforeUnmount(() => window.clearInterval(timer));
</script>

<template>
  <main class="app">
    <div class="shell">
      <header class="topbar">
        <div>
          <p class="eyebrow">物流园区 · 装卸位预约与放行闭环</p>
          <h1>园区装卸位预约与放行</h1>
          <p class="subtitle">
            预约车牌、温区、装卸位与时段；冷链车只能使用冷藏位，装卸位时段不得重叠，超时未入场自动释放。
            入场锁定预约，装卸完成录入铅封号、净重与备注后方可放行。
          </p>
        </div>
        <div class="stack">
          <span class="tag">Vue3</span>
          <span class="tag">TypeScript</span>
          <span class="tag">Pinia</span>
          <span class="tag">localStorage</span>
        </div>
      </header>

      <section class="metrics">
        <article v-for="item in metrics" :key="item.label" class="metric">
          <span>{{ item.label }}</span>
          <strong>{{ item.value }}</strong>
        </article>
      </section>

      <ConflictPanel :conflicts="store.conflicts" @dismiss="store.clearConflicts()" />

      <section class="workspace">
        <BookingForm
          :key="formVersion"
          :docks="store.docks"
          :on-validate="store.checkBooking"
          submit-label="提交预约"
          :submitting="false"
          @submit="handleBook"
          @cancel="formVersion += 1"
        />

        <section class="list-panel">
          <div class="toolbar">
            <h2>预约列表</h2>
            <div class="toolbar-controls">
              <input v-model="plateQuery" class="plate-search" placeholder="按车牌搜索" />
              <select v-model="filter">
                <option v-for="item in filterOptions" :key="item.key" :value="item.key">
                  {{ item.label }}
                </option>
              </select>
            </div>
          </div>
          <p class="clock-line">当前时间：{{ formatDateTime(store.now) }}（每 30 秒检查超时未入场）</p>

          <div class="record-grid">
            <div v-if="filtered.length === 0" class="empty">暂无匹配预约</div>
            <ReservationCard
              v-for="item in filtered"
              :key="item.id"
              :reservation="item"
              :dock="dockOf(item.dockId)"
              :rebook-target="rebookTargetOf(item)"
              @check-in="store.checkIn"
              @start-loading="store.startLoading"
              @release="openRelease"
              @reschedule="openReschedule"
              @cancel-loading="openCancelLoading"
              @cancel-reserved="confirmCancelReserved"
            />
          </div>
        </section>
      </section>

      <DockBoard :docks="store.docks" :reservations="store.reservations" :now="store.now" />

      <HistoryPanel :events="store.releaseHistory" />

      <footer class="page-foot">
        <button type="button" class="secondary" @click="store.resetDemo()">恢复演示数据</button>
        <span class="muted">数据保存在浏览器 localStorage，刷新后预约、占用与放行历史保持一致。</span>
      </footer>
    </div>

    <ReleaseDialog
      :open="releaseTarget !== null"
      :reservation="releaseTarget"
      :error-detail="releaseError"
      @close="releaseTarget = null"
      @confirm="confirmRelease"
    />
    <RescheduleDialog
      :open="rescheduleTarget !== null"
      :reservation="rescheduleTarget"
      :docks="store.docks"
      :conflicts="store.conflicts"
      :on-validate="store.checkBooking"
      @close="rescheduleTarget = null"
      @confirm="confirmReschedule"
    />
    <CancelLoadingDialog
      :open="cancelLoadingTarget !== null"
      :reservation="cancelLoadingTarget"
      :docks="store.docks"
      :conflicts="store.conflicts"
      :on-validate="store.checkBooking"
      @close="cancelLoadingTarget = null"
      @confirm="confirmCancelLoading"
    />
  </main>
</template>
