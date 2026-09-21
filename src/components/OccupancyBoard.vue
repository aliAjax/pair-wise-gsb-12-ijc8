<script setup lang="ts">
import { ZONE_LABELS } from "../domain/constants";
import type { Dock, Reservation } from "../domain/types";
import { formatRange } from "../domain/time";
import { STATUS_BADGE, STATUS_LABELS } from "../ui/labels";

defineProps<{
  occupancy: { dock: Dock; items: Reservation[] }[];
  nowTick: number;
}>();

const emit = defineEmits<{
  select: [reservation: Reservation];
}>();

function isOngoing(r: Reservation, now: number): boolean {
  return +new Date(r.startAt) <= now && now <= +new Date(r.endAt);
}
</script>

<template>
  <div class="dock-grid">
    <article v-for="row in occupancy" :key="row.dock.id" class="dock-card">
      <header class="dock-head">
        <div>
          <p class="dock-name">{{ row.dock.name }}</p>
          <p class="dock-kind">{{ row.dock.kind === "refrigerated" ? "冷藏位（冷链专用）" : "普通位（常温）" }}</p>
        </div>
        <span :class="row.items.length ? 'dot dot-busy' : 'dot dot-free'">
          {{ row.items.length ? "占用中" : "空闲" }}
        </span>
      </header>

      <div v-if="row.items.length === 0" class="dock-empty">当前无预约占用</div>
      <button
        v-for="r in row.items"
        :key="r.id"
        type="button"
        class="dock-slot"
        :class="{ ongoing: isOngoing(r, nowTick) }"
        @click="emit('select', r)"
      >
        <div class="dock-slot-head">
          <strong>{{ r.plate }}</strong>
          <span :class="STATUS_BADGE[r.status]">{{ STATUS_LABELS[r.status] }}</span>
        </div>
        <p class="dock-slot-time">{{ formatRange(r.startAt, r.endAt) }}</p>
        <p class="dock-slot-zone">{{ ZONE_LABELS[r.zone] }}</p>
      </button>
    </article>
  </div>
</template>
