<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import { dockKindMeta, tempZoneMeta, type BookingConflict, type Dock, type Reservation } from "../domain/types";
import { fromLocalInput, toLocalInput, defaultSlotStart, defaultSlotEnd, formatRange } from "../domain/time";
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
  confirm: [payload: { dockId: string; startAt: string; endAt: string }];
}>();

const form = reactive({ dockId: "", startInput: "", endInput: "" });

watch(
  () => props.open,
  (open) => {
    if (open && props.reservation) {
      const start = defaultSlotStart();
      form.dockId = props.reservation.dockId;
      form.startInput = toLocalInput(start);
      form.endInput = toLocalInput(defaultSlotEnd(start));
    }
  }
);

const isCold = computed(() =>
  props.reservation ? tempZoneMeta[props.reservation.tempZone].cold : false
);

const selectableDocks = computed(() =>
  props.docks.filter((dock) => (isCold.value ? dock.kind === "cold" : true))
);

const liveConflicts = computed(() => {
  if (!props.reservation) return [];
  return props.onValidate(
    {
      plate: props.reservation.plate,
      tempZone: props.reservation.tempZone,
      dockId: form.dockId,
      startAt: fromLocalInput(form.startInput),
      endAt: fromLocalInput(form.endInput)
    },
    props.reservation.id
  );
});

const shownConflicts = computed(() => {
  const merged = [...props.conflicts, ...liveConflicts.value].filter(
    (item) => item.rule !== "REQUIRED"
  );
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
  if (!startAt || !endAt || !form.dockId) return;
  emit("confirm", { dockId: form.dockId, startAt, endAt });
}
</script>

<template>
  <ModalBase :open="open" title="改约（先释放原装卸位）" @close="emit('close')">
    <div v-if="reservation" class="modal-body">
      <p class="muted">
        {{ reservation.plate }} · 温区 {{ tempZoneMeta[reservation.tempZone].label }}
      </p>
      <p v-if="reservation.status !== 'reserved'" class="inline-error">
        ⛔ 车辆入场后预约已锁定，不能改约。
      </p>
      <p v-else class="rule-hint">
        原预约：{{ docks.find((d) => d.id === reservation.dockId)?.name }}
        {{ formatRange(reservation.startAt, reservation.endAt) }}
        ；确认改约后原位立即释放。
      </p>
      <form class="form-grid" @submit.prevent="confirm">
        <label>
          新装卸位
          <select v-model="form.dockId" required>
            <option v-for="dock in selectableDocks" :key="dock.id" :value="dock.id">
              {{ dock.name }} · {{ dockKindMeta[dock.kind].label }}
            </option>
          </select>
        </label>
        <div class="time-row">
          <label>
            新开始
            <input v-model="form.startInput" type="datetime-local" required />
          </label>
          <label>
            新结束
            <input v-model="form.endInput" type="datetime-local" required />
          </label>
        </div>
        <ul v-if="shownConflicts.length" class="live-conflicts">
          <li v-for="(item, index) in shownConflicts" :key="index">
            ⚠ {{ item.detail || item.ruleLabel }}
          </li>
        </ul>
        <div class="actions">
          <button type="submit" :disabled="shownConflicts.length > 0 || reservation.status !== 'reserved'">
            释放原位并改约
          </button>
          <button type="button" class="secondary" @click="emit('close')">取消</button>
        </div>
      </form>
    </div>
  </ModalBase>
</template>
