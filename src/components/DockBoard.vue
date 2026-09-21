<script setup lang="ts">
import { computed } from "vue";
import {
  dockKindMeta,
  type Dock,
  type Reservation
} from "../domain/types";
import { statusMeta, tempZoneMeta } from "../domain/types";
import { formatRange } from "../domain/time";

const props = defineProps<{
  docks: Dock[];
  reservations: Reservation[];
  now: string;
}>();

interface OccupancyRow {
  dock: Dock;
  active: Reservation[];
}

const rows = computed<OccupancyRow[]>(() =>
  props.docks.map((dock) => ({
    dock,
    active: props.reservations
      .filter((item) => item.dockId === dock.id && ["reserved", "checkedIn", "loading"].includes(item.status))
      .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
  }))
);

const freeCount = computed(() => rows.value.filter((row) => row.active.length === 0).length);
</script>

<template>
  <section class="panel dock-board">
    <div class="toolbar">
      <h2>装卸位实时占用</h2>
      <span class="muted">空闲 {{ freeCount }} / 共 {{ docks.length }}</span>
    </div>
    <div class="dock-grid">
      <article v-for="row in rows" :key="row.dock.id" class="dock-cell" :class="{ cold: row.dock.kind === 'cold', busy: row.active.length > 0 }">
        <header>
          <strong>{{ row.dock.name }}</strong>
          <span class="dock-kind">{{ dockKindMeta[row.dock.kind].label }}</span>
        </header>
        <p v-if="row.active.length === 0" class="dock-free">空闲</p>
        <ul v-else class="dock-tasks">
          <li v-for="task in row.active" :key="task.id">
            <span class="status" :data-tone="statusMeta[task.status].tone">{{ statusMeta[task.status].label }}</span>
            <b>{{ task.plate }}</b>
            <span class="muted">{{ tempZoneMeta[task.tempZone].label }} · {{ formatRange(task.startAt, task.endAt) }}</span>
          </li>
        </ul>
      </article>
    </div>
  </section>
</template>
