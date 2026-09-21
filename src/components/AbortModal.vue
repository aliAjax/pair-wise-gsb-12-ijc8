<script setup lang="ts">
import { ref } from "vue";

import type { BookingDraft, Conflict, Reservation } from "../domain/types";
import { validateCancelReason } from "../domain/validation";
import BaseModal from "./BaseModal.vue";
import BookingForm from "./BookingForm.vue";
import ConflictList from "./ConflictList.vue";

defineProps<{
  reservation: Reservation;
  reservations: Reservation[];
  conflicts: Conflict[];
}>();

const emit = defineEmits<{
  confirm: [reason: string, draft: BookingDraft];
  close: [];
}>();

const reason = ref("");
const reasonError = ref<Conflict[]>([]);

function onSubmit(d: BookingDraft) {
  const check = validateCancelReason(reason.value);
  if (!check.valid) {
    reasonError.value = check.conflicts;
    return;
  }
  reasonError.value = [];
  emit("confirm", reason.value.trim(), d);
}
</script>

<template>
  <BaseModal
    title="装卸中取消并重约"
    subtitle="原泊位立即释放；必须填写取消原因，并生成一条新预约"
    @close="emit('close')"
  >
    <div class="abort-head">
      <span class="abort-plate">{{ reservation.plate }}</span>
      <span>{{ reservation.dockId }}</span>
    </div>
    <label class="field">
      <span>取消原因 <i>*</i>（必填，将写入流水与新预约备注）</span>
      <textarea
        v-model="reason"
        rows="2"
        placeholder="如：车厢制冷故障，需返厂换车后重新预约"
        maxlength="200"
      />
    </label>
    <ConflictList v-if="reasonError.length" :conflicts="reasonError" title="取消原因校验未通过" />
    <ConflictList :conflicts="conflicts" title="新预约规则校验未通过" />

    <div class="abort-divider">新预约信息（默认沿用原车，可改泊位/时段）</div>
    <BookingForm
      :reservations="reservations"
      :ignore-id="reservation.id"
      :initial="{
        plate: reservation.plate,
        zone: reservation.zone,
        dockId: reservation.dockId,
        startAt: reservation.startAt,
        endAt: reservation.endAt,
        notes: reservation.notes,
      }"
      submit-text="确认取消并生成新预约"
      live-preview
      @submit="onSubmit"
      @cancel="emit('close')"
    />
  </BaseModal>
</template>
