<script setup lang="ts">
// 冲突列表：统一展示“车牌、装卸位、时段、命中规则”，新建/改约/取消/放行共用。
import type { Conflict } from "../domain/types";
import { formatRange } from "../domain/time";

defineProps<{
  conflicts: Conflict[];
  title?: string;
}>();

function range(c: Conflict): string {
  if (!c.startAt && !c.endAt) return "—";
  return formatRange(c.startAt, c.endAt);
}
</script>

<template>
  <div v-if="conflicts.length" class="conflict-box" role="alert">
    <p class="conflict-title">
      <span class="conflict-icon">⚠</span>
      {{ title ?? `命中 ${conflicts.length} 条业务规则，操作被拦截` }}
    </p>
    <ul class="conflict-list">
      <li v-for="(c, i) in conflicts" :key="i" class="conflict-item">
        <div class="conflict-row">
          <span class="conflict-plate">{{ c.plate }}</span>
          <span class="conflict-dock">{{ c.dockName }}</span>
          <span class="conflict-time">{{ range(c) }}</span>
          <span class="conflict-rule">{{ c.ruleCode }} · {{ c.ruleLabel }}</span>
        </div>
        <p class="conflict-msg">{{ c.message }}</p>
        <p v-if="c.againstPlate" class="conflict-against">
          冲突对方：<strong>{{ c.againstPlate }}</strong> ·
          {{ c.dockName }} ·
          {{ formatRange(c.againstStartAt!, c.againstEndAt!) }}
        </p>
      </li>
    </ul>
  </div>
</template>
