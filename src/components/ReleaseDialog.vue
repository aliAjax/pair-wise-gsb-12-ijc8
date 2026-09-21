<script setup lang="ts">
import { reactive, watch } from "vue";
import type { Reservation } from "../domain/types";
import { formatRange } from "../domain/time";
import ModalBase from "./ModalBase.vue";

const props = defineProps<{
  open: boolean;
  reservation: Reservation | null;
  /** 校验结论：放行资料缺项清单的说明文本 */
  errorDetail: string | null;
}>();

const emit = defineEmits<{
  close: [];
  confirm: [payload: { sealNo: string; netWeight: number | null; releaseNotes: string }];
}>();

const form = reactive({ sealNo: "", netWeightText: "", releaseNotes: "" });

watch(
  () => props.open,
  (open) => {
    if (open) {
      form.sealNo = "";
      form.netWeightText = "";
      form.releaseNotes = "";
    }
  }
);

function confirm() {
  const parsed = Number(form.netWeightText);
  emit("confirm", {
    sealNo: form.sealNo,
    netWeight: form.netWeightText.trim() === "" ? null : parsed,
    releaseNotes: form.releaseNotes
  });
}
</script>

<template>
  <ModalBase :open="open" title="装卸完成 · 录入放行资料" @close="emit('close')">
    <div v-if="reservation" class="modal-body">
      <p class="muted">
        {{ reservation.plate }} · {{ formatRange(reservation.startAt, reservation.endAt) }}
      </p>
      <p class="rule-hint">规则：铅封号、净重、备注缺一项均不得放行。</p>
      <form class="form-grid" @submit.prevent="confirm">
        <label>
          铅封号
          <input v-model="form.sealNo" placeholder="如 SL2026092101" required />
        </label>
        <label>
          净重（吨）
          <input v-model="form.netWeightText" type="number" min="0.01" step="0.01" placeholder="如 12.4" required />
        </label>
        <label>
          放行备注
          <textarea v-model="form.releaseNotes" placeholder="铅封状态、单据核对结论等" required />
        </label>
        <p v-if="errorDetail" class="inline-error">⛔ {{ errorDetail }}</p>
        <div class="actions">
          <button type="submit">确认放行</button>
          <button type="button" class="secondary" @click="emit('close')">取消</button>
        </div>
      </form>
    </div>
  </ModalBase>
</template>
