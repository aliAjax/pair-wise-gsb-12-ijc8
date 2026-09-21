<script setup lang="ts">
import { computed, reactive } from "vue";

import type { Conflict, Reservation } from "../domain/types";
import { validateGateCheck } from "../domain/validation";
import ConflictList from "./ConflictList.vue";

const props = defineProps<{
  reservation: Reservation;
  conflicts: Conflict[];
  busy?: boolean;
}>();

const emit = defineEmits<{
  save: [payload: { sealNo: string; netWeightKg: number | undefined; completionNote: string }];
  release: [payload: { sealNo: string; netWeightKg: number | undefined; completionNote: string }];
  close: [];
}>();

const form = reactive({
  sealNo: props.reservation.sealNo ?? "",
  netWeight: props.reservation.netWeightKg !== undefined ? String(props.reservation.netWeightKg) : "",
  note: props.reservation.completionNote ?? "",
});

const netWeightNum = computed(() => {
  if (form.netWeight.trim() === "") return undefined;
  const n = Number(form.netWeight);
  return Number.isFinite(n) ? n : Number.NaN;
});

const payload = computed(() => ({
  sealNo: form.sealNo,
  netWeightKg: netWeightNum.value,
  completionNote: form.note,
}));

// 实时缺项提示（R6），不阻断“暂存”，只阻断放行按钮可用性
const gateIssues = computed(() =>
  validateGateCheck({ ...props.reservation, ...payload.value }).conflicts,
);

const missingText = computed(() =>
  gateIssues.value.map((c) => c.message).join("；"),
);
</script>

<template>
  <div class="modal-form">
    <div class="gate-readonly">
      <span>{{ reservation.plate }}</span>
      <span>{{ reservation.dockId }}</span>
      <span>入场：{{ new Date(reservation.enteredAt!).toLocaleString("zh-CN", { hour12: false }) }}</span>
    </div>

    <label class="field">
      <span>铅封号 <i>*</i></span>
      <input v-model="form.sealNo" placeholder="如 SL2026092101" maxlength="32" />
    </label>

    <label class="field">
      <span>净重（kg） <i>*</i></span>
      <input v-model="form.netWeight" type="number" min="0" step="1" placeholder="如 1280" />
    </label>

    <label class="field">
      <span>装卸备注</span>
      <textarea v-model="form.note" rows="3" placeholder="温度记录、货损、交接情况" />
    </label>

    <p v-if="missingText" class="gate-warn">⛔ {{ missingText }}</p>
    <ConflictList :conflicts="conflicts" />

    <div class="modal-actions">
      <button type="button" class="secondary" @click="emit('close')">关闭</button>
      <button type="button" class="secondary" @click="emit('save', payload)">暂存录入</button>
      <button type="button" :disabled="gateIssues.length > 0" @click="emit('release', payload)">
        校验并放行
      </button>
    </div>
  </div>
</template>
