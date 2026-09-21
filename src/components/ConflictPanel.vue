<script setup lang="ts">
import type { BookingConflict } from "../domain/types";
import { formatDateTime } from "../domain/time";

defineProps<{ conflicts: BookingConflict[] }>();
const emit = defineEmits<{ dismiss: [] }>();
</script>

<template>
  <section v-if="conflicts.length" class="conflict-box">
    <header class="conflict-head">
      <strong>校验未通过（{{ conflicts.length }} 条冲突）</strong>
      <button type="button" class="secondary" @click="emit('dismiss')">知道了</button>
    </header>
    <ul class="conflict-list">
      <li v-for="(item, index) in conflicts" :key="index" class="conflict-item">
        <p class="conflict-rule">规则：{{ item.ruleLabel }}</p>
        <div class="conflict-grid">
          <span><b>车牌：</b>{{ item.plate || "—" }}</span>
          <span><b>装卸位：</b>{{ item.dockLabel || item.dockId || "—" }}</span>
          <span>
            <b>时段：</b
            >{{ item.startAt && item.endAt ? `${formatDateTime(item.startAt)} ~ ${formatDateTime(item.endAt)}` : "—" }}
          </span>
          <span class="conflict-detail"><b>说明：</b>{{ item.detail }}</span>
        </div>
      </li>
    </ul>
  </section>
</template>
