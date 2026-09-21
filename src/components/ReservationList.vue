<script setup lang="ts">
import { computed } from "vue";

import { ENTRY_GRACE_MINUTES, ZONE_LABELS } from "../domain/constants";
import type { Reservation } from "../domain/types";
import { formatDateTime, formatRange } from "../domain/time";
import { STATUS_BADGE, STATUS_LABELS } from "../ui/labels";

const props = defineProps<{
  items: Reservation[];
  nowTick: number;
}>();

const emit = defineEmits<{
  enter: [r: Reservation];
  complete: [r: Reservation];
  reschedule: [r: Reservation];
  abort: [r: Reservation];
  cancel: [r: Reservation];
}>();

/** 超时倒计时：开始时间 + 宽限期 - 现在 */
const countdown = computed(() => {
  const map = new Map<string, number>();
  for (const r of props.items) {
    if (r.status !== "booked") continue;
    const due = +new Date(r.startAt) + ENTRY_GRACE_MINUTES * 60000;
    map.set(r.id, due - props.nowTick);
  }
  return map;
});

function fmtCountdown(ms: number): string {
  if (ms <= 0) return "即将释放…";
  const min = Math.ceil(ms / 60000);
  return `入场宽限剩余 ${min} 分钟`;
}

const gateReady = (r: Reservation) =>
  Boolean(r.sealNo?.trim()) && typeof r.netWeightKg === "number" && r.netWeightKg > 0;
</script>

<template>
  <div class="record-grid">
    <div v-if="items.length === 0" class="empty">暂无匹配预约</div>

    <article v-for="r in items" :key="r.id" class="record">
      <div class="record-head">
        <p class="record-title">{{ r.plate }} · {{ r.dockId }}</p>
        <span :class="STATUS_BADGE[r.status]">{{ STATUS_LABELS[r.status] }}</span>
      </div>

      <div class="details">
        <span>温区：{{ ZONE_LABELS[r.zone] }}</span>
        <span>时段：{{ formatRange(r.startAt, r.endAt) }}</span>
        <span v-if="r.enteredAt">入场：{{ formatDateTime(r.enteredAt) }}</span>
        <span v-if="r.releasedAt">放行：{{ formatDateTime(r.releasedAt) }}</span>
        <span v-if="r.sealNo">铅封号：{{ r.sealNo }}</span>
        <span v-if="r.netWeightKg !== undefined">净重：{{ r.netWeightKg }} kg</span>
      </div>

      <p v-if="r.notes" class="note">{{ r.notes }}</p>
      <p v-if="r.completionNote" class="note note-done">装卸备注：{{ r.completionNote }}</p>
      <p v-if="r.reason" class="note note-reason">原因：{{ r.reason }}</p>
      <p v-if="r.rebookedFromId" class="chain">↻ 由预约 {{ r.rebookedFromId }} 改约/重约生成</p>
      <p v-if="r.replacedById" class="chain">→ 已由新预约 {{ r.replacedById }} 替代</p>

      <!-- 待入场 -->
      <div v-if="r.status === 'booked'" class="actions">
        <button type="button" @click="emit('enter', r)">车辆入场（锁定）</button>
        <button type="button" class="secondary" @click="emit('reschedule', r)">改约</button>
        <button type="button" class="danger ghost" @click="emit('cancel', r)">取消预约</button>
        <span class="countdown" :class="{ urgent: (countdown.get(r.id) ?? 0) < 5 * 60000 }">
          {{ fmtCountdown(countdown.get(r.id) ?? 0) }}
        </span>
      </div>

      <!-- 装卸中：入场后锁定，只能补录/放行/中断 -->
      <div v-else-if="r.status === 'loading'" class="actions">
        <button type="button" @click="emit('complete', r)">
          {{ gateReady(r) ? "查看/修改放行信息" : "录入装卸结果并放行" }}
        </button>
        <button type="button" class="danger" @click="emit('abort', r)">装卸中断取消（重约）</button>
        <span class="locked-hint">🔒 预约已锁定，不可改泊位/时段</span>
      </div>

      <div v-else class="actions">
        <button type="button" class="secondary" disabled>流程已结束</button>
      </div>
    </article>
  </div>
</template>
