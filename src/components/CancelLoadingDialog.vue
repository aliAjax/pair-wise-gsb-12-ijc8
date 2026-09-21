<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import {
  type BookingConflict,
  type Dock,
  type Reservation
} from "../domain/types";
import {
  defaultSlotEnd,
  defaultSlotStart,
  formatRange,
  fromLocalInput,
  toLocalInput
} from "../domain/time";
import ModalBase from "./ModalBase.vue";

const props = defineProps<{
  open: boolean;
  reservation: Reservation | null;
  docks: Dock[];
  conflicts: BookingConflict[];
  onValidate: (
    input: { plate: string; tempZone: string; dockId: string; startAt: string | null; endAt: string | null },
    excludeId?: string
  ) => BookingConflict[];
}>();

const emit = defineEmits<{
  close: [];
  confirm: [payload: { reason: string; startAt: string; endAt: string }];
}>();

const form = reactive({ reason: "", startInput: "", endInput: "" });

watch(
  () => props.open,
  (open) => {
    if (open && props.reservation) {
      const start = defaultSlotStart();
      form.reason = "";
      form.startInput = toLocalInput(start);
      form.endInput = toLocalInput(defaultSlotEnd(start));
    }
  }
);

const reasonMissing = computed(() => form.reason.trim() === "");

const liveConflicts = computed(() => {
  if (!props.reservation) return [];
  return props
    .onValidate(
      {
        plate: props.reservation.plate,
        tempZone: props.reservation.tempZone,
        dockId: props.reservation.dockId,
        startAt: fromLocalInput(form.startInput),
        endAt: fromLocalInput(form.endInput)
      },
      props.reservation.id
    )
    .filter((item) => item.rule !== "REQUIRED");
});

const shownConflicts = computed(() => {
  const merged = [...props.conflicts, ...liveConflicts.value];
  const seen = new Set<string>();
  return merged.filter((item) => {
    const key = `${item.rule}-${item.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
});

function confirm() {
  const startAt = fromLocalInput(form.startInput);
  const endAt = fromLocalInput(form.endInput);
  if (!startAt || !endAt) return;
  emit("confirm", { reason: form.reason, startAt, endAt });
}
</script>

<template>
  <ModalBase :open="open" title="装卸中终止（须填原因并重新预约）" @close="emit('close')">
    <div v-if="reservation" class="modal-body">
      <p class="muted">
        {{ reservation.plate }} ·
        {{ docks.find((d) => d.id === reservation.dockId)?.name ?? reservation.dockId }}
        （{{ formatRange(reservation.startAt, reservation.endAt) }}）
      </p>
      <p class="rule-hint">
        规则：装卸中取消必须填写原因；原预约置为已取消，并在同一装卸位生成一张待入场新预约。
      </p>
      <form class="form-grid" @submit.prevent="confirm">
        <label>
          终止原因（必填）
          <textarea v-model="form.reason" placeholder="如：货物破损需退回、单据不符暂停作业" required />
        </label>
        <p v-if="reasonMissing" class="inline-hint">未填原因时无法提交。</p>
        <div class="time-row">
          <label>
            新预约开始
            <input v-model="form.startInput" type="datetime-local" required />
          </label>
          <label>
            新预约结束
            <input v-model="form.endInput" type="datetime-local" required />
          </label>
        </div>
        <ul v-if="shownConflicts.length" class="live-conflicts">
          <li v-for="(item, index) in shownConflicts" :key="index">
            ⚠ {{ item.detail || item.ruleLabel }}
          </li>
        </ul>
        <div class="actions">
          <button type="submit" class="danger" :disabled="reasonMissing || shownConflicts.length > 0">
            终止并生成新预约
          </button>
          <button type="button" class="secondary" @click="emit('close')">返回继续装卸</button>
        </div>
      </form>
    </div>
  </ModalBase>
</template>
