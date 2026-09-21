<script setup lang="ts">
import { computed, ref } from "vue";

import { dockById } from "../domain/constants";
import type { HistoryEvent } from "../domain/types";
import { formatDateTime, formatRange } from "../domain/time";
import { EVENT_BADGE, EVENT_LABELS } from "../ui/labels";

const props = defineProps<{
  events: HistoryEvent[];
}>();

type Mode = "release" | "all";
const mode = ref<Mode>("release");

const shown = computed(() =>
  mode.value === "release"
    ? props.events.filter((e) => e.type === "released")
    : props.events,
);

const summary = computed(() => {
  const totalNet = props.events
    .filter((e) => e.type === "released" && typeof e.netWeightKg === "number")
    .reduce((acc, e) => acc + (e.netWeightKg ?? 0), 0);
  return {
    releaseCount: props.events.filter((e) => e.type === "released").length,
    totalNet,
  };
});
</script>

<template>
  <div class="history-wrap">
    <div class="toolbar">
      <div class="seg">
        <button
          type="button"
          :class="mode === 'release' ? 'seg-on' : 'secondary'"
          @click="mode = 'release'"
        >
          放行历史（{{ summary.releaseCount }}）
        </button>
        <button
          type="button"
          :class="mode === 'all' ? 'seg-on' : 'secondary'"
          @click="mode = 'all'"
        >
          全部流转流水
        </button>
      </div>
      <span class="history-summary">放行累计净重 {{ summary.totalNet.toLocaleString() }} kg</span>
    </div>

    <div v-if="shown.length === 0" class="empty">暂无记录</div>

    <table v-else class="history-table">
      <thead>
        <tr>
          <th>时间</th>
          <th>事件</th>
          <th>车牌</th>
          <th>装卸位</th>
          <th>预约时段</th>
          <th>铅封号</th>
          <th>净重(kg)</th>
          <th>备注 / 原因</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="e in shown" :key="e.id">
          <td class="nowrap">{{ formatDateTime(e.at) }}</td>
          <td><span :class="EVENT_BADGE[e.type]">{{ EVENT_LABELS[e.type] }}</span></td>
          <td class="plate">{{ e.plate }}</td>
          <td>{{ dockById(e.dockId)?.name ?? e.dockId }}</td>
          <td class="nowrap">{{ formatRange(e.startAt, e.endAt) }}</td>
          <td>{{ e.sealNo ?? "—" }}</td>
          <td>{{ e.netWeightKg ?? "—" }}</td>
          <td class="hist-detail">
            {{ e.detail ?? "" }}
            <template v-if="e.newReservationId">
              <br /><em>新预约：{{ e.newReservationId }}</em>
            </template>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
