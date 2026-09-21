<script setup lang="ts">
import { computed, reactive, watch } from "vue";

import {
  DOCKS,
  ZONE_LABELS,
  ZONE_OPTIONS,
} from "../domain/constants";
import type { BookingDraft, Conflict, Reservation } from "../domain/types";
import { docksForZone, validateDraft } from "../domain/validation";
import { fromLocalInput, toLocalInput } from "../domain/time";
import ConflictList from "./ConflictList.vue";

const props = defineProps<{
  reservations: Reservation[];
  ignoreId?: string;
  initial?: Partial<BookingDraft>;
  submitText: string;
  /** 提交前是否展示实时规则预检 */
  livePreview?: boolean;
}>();

const emit = defineEmits<{
  submit: [draft: BookingDraft];
  cancel: [];
}>();

function defaultStart(): string {
  const d = new Date(Date.now() + 30 * 60000);
  d.setSeconds(0, 0);
  return toLocalInput(d);
}
function defaultEnd(): string {
  const d = new Date(Date.now() + 90 * 60000);
  d.setSeconds(0, 0);
  return toLocalInput(d);
}

const form = reactive({
  plate: props.initial?.plate ?? "",
  zone: props.initial?.zone ?? ("ambient" as BookingDraft["zone"]),
  dockId: props.initial?.dockId ?? "",
  startLocal: props.initial?.startAt ? toLocalInput(props.initial.startAt) : defaultStart(),
  endLocal: props.initial?.endAt ? toLocalInput(props.initial.endAt) : defaultEnd(),
  notes: props.initial?.notes ?? "",
});

const dockChoices = computed(() => docksForZone(form.zone));

// 温区变化后，若已选装卸位不兼容则清空，强制重新选择
watch(
  () => form.zone,
  () => {
    if (form.dockId && !dockChoices.value.some((d) => d.id === form.dockId)) {
      form.dockId = "";
    }
  },
);

const liveConflicts = computed<Conflict[]>(() => {
  if (!props.livePreview) return [];
  const draft = toDraft();
  if (!draft.dockId || !draft.startAt || !draft.endAt) return [];
  return validateDraft(draft, props.reservations, props.ignoreId).conflicts;
});

function toDraft(): BookingDraft {
  return {
    plate: form.plate.trim(),
    zone: form.zone,
    dockId: form.dockId,
    startAt: fromLocalInput(form.startLocal),
    endAt: fromLocalInput(form.endLocal),
    notes: form.notes.trim(),
  };
}

function onSubmit() {
  emit("submit", toDraft());
}

function dockHint(): string {
  if (!form.zone) return "请先选择温区";
  return form.zone === "ambient"
    ? "常温车：仅可选择普通位"
    : "冷链车：仅可选择冷藏位";
}
</script>

<template>
  <form class="modal-form" @submit.prevent="onSubmit">
    <div class="form-row">
      <label class="field">
        <span>车牌号 <i>*</i></span>
        <input v-model="form.plate" placeholder="如 沪A-82L6" required maxlength="16" />
      </label>
      <label class="field">
        <span>温区 <i>*</i></span>
        <select v-model="form.zone" required>
          <option v-for="z in ZONE_OPTIONS" :key="z" :value="z">{{ ZONE_LABELS[z] }}</option>
        </select>
      </label>
    </div>

    <label class="field">
      <span>装卸位 <i>*</i>（{{ dockHint() }}）</span>
      <select v-model="form.dockId" required>
        <option value="" disabled>请选择装卸位</option>
        <option v-for="d in dockChoices" :key="d.id" :value="d.id">
          {{ d.name }}{{ d.kind === "refrigerated" ? " · 冷藏位" : " · 普通位" }}
        </option>
      </select>
    </label>

    <div class="form-row">
      <label class="field">
        <span>开始时间 <i>*</i></span>
        <input v-model="form.startLocal" type="datetime-local" required />
      </label>
      <label class="field">
        <span>结束时间 <i>*</i></span>
        <input v-model="form.endLocal" type="datetime-local" required />
      </label>
    </div>

    <label class="field">
      <span>备注</span>
      <textarea v-model="form.notes" rows="2" placeholder="货品、温控要求等" />
    </label>

    <ConflictList v-if="liveConflicts.length" :conflicts="liveConflicts" title="规则预检：以下冲突会拦截提交" />

    <div class="modal-actions">
      <button type="button" class="secondary" @click="emit('cancel')">取消</button>
      <button type="submit">{{ submitText }}</button>
    </div>
  </form>
</template>
