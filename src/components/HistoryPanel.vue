<script setup lang="ts">
import { computed, ref } from "vue";
import type { DockEvent } from "../domain/types";
import { formatDateTime } from "../domain/time";

const props = defineProps<{ events: DockEvent[] }>();

const filters = [
  { key: "all", label: "全部" },
  { key: "release", label: "放行" },
  { key: "book", label: "预约" },
  { key: "rebook", label: "改约" },
  { key: "noShow", label: "超时释放" },
  { key: "cancel", label: "取消" }
] as const;

const eventTypeLabel: Record<DockEvent["type"], string> = {
  book: "预约",
  checkIn: "入场",
  loading: "装卸",
  release: "放行",
  cancel: "取消",
  rebook: "改约",
  noShow: "超时释放"
};

const filter = ref<(typeof filters)[number]["key"]>("all");

const shown = computed(() => {
  if (filter.value === "all") return props.events;
  return props.events.filter((event) => event.type === filter.value);
});
</script>

<template>
  <section class="panel history-panel">
    <div class="toolbar">
      <h2>放行 / 操作历史</h2>
      <div class="chip-row">
        <button
          v-for="item in filters"
          :key="item.key"
          type="button"
          class="chip"
          :class="{ active: filter === item.key }"
          @click="filter = item.key"
        >
          {{ item.label }}
        </button>
      </div>
    </div>
    <ul v-if="shown.length" class="timeline">
      <li v-for="event in shown" :key="event.id" class="timeline-item">
        <span class="timeline-dot" :data-type="event.type" />
        <div>
          <p class="timeline-msg">
            <span class="evt-tag" :data-type="event.type">{{ eventTypeLabel[event.type] }}</span>
            {{ event.message }}
          </p>
          <p class="muted">{{ event.plate }} · {{ formatDateTime(event.at) }}</p>
        </div>
      </li>
    </ul>
    <div v-else class="empty">暂无历史记录</div>
  </section>
</template>
