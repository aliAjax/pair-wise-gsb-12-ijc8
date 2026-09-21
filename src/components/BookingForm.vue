<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import {
  dockKindMeta,
  tempZoneMeta,
  tempZoneOptions,
  type Dock
} from "../domain/types";
import {
  fromLocalInput,
  toLocalInput,
  defaultSlotStart,
  defaultSlotEnd
} from "../domain/time";
import type { BookingConflict } from "../domain/types";

const props = defineProps<{
  docks: Dock[];
  /** 实时校验回调，返回冲突，输入合法时为空数组 */
  onValidate: (input: {
    plate: string;
    tempZone: string;
    dockId: string;
    startAt: string | null;
    endAt: string | null;
  }) => BookingConflict[];
  submitLabel: string;
  submitting: boolean;
}>();

const emit = defineEmits<{
  submit: [
    input: {
      plate: string;
      tempZone: string;
      dockId: string;
      startAt: string;
      endAt: string;
      notes: string;
    }
  ];
  cancel: [];
}>();

const initialStart = defaultSlotStart();
const form = reactive({
  plate: "",
  tempZone: "normal",
  dockId: "",
  startInput: toLocalInput(initialStart),
  endInput: toLocalInput(defaultSlotEnd(initialStart)),
  notes: ""
});

const isColdCargo = computed(() => tempZoneMeta[form.tempZone as keyof typeof tempZoneMeta].cold);

const selectableDocks = computed(() =>
  props.docks.filter((dock) => (isColdCargo.value ? dock.kind === "cold" : true))
);

// 切换温区后若当前装卸位不合规，自动纠正到合规装卸位
watch(isColdCargo, (cold) => {
  if (cold) {
    const current = props.docks.find((dock) => dock.id === form.dockId);
    if (!current || current.kind !== "cold") {
      form.dockId = props.docks.find((dock) => dock.kind === "cold")?.id ?? "";
    }
  }
});

/** 实时提示只展示规则性冲突；必填缺项由提交时统一拦截 */
const liveConflicts = computed<BookingConflict[]>(() =>
  props
    .onValidate({
      plate: form.plate,
      tempZone: form.tempZone,
      dockId: form.dockId,
      startAt: fromLocalInput(form.startInput),
      endAt: fromLocalInput(form.endInput)
    })
    .filter((item) => item.rule !== "REQUIRED")
);

function submit() {
  const startAt = fromLocalInput(form.startInput);
  const endAt = fromLocalInput(form.endInput);
  if (!startAt || !endAt) return;
  emit("submit", {
    plate: form.plate,
    tempZone: form.tempZone,
    dockId: form.dockId,
    startAt,
    endAt,
    notes: form.notes.trim()
  });
}

defineExpose({ form });
</script>

<template>
  <form class="panel form-panel" @submit.prevent="submit">
    <h2>装卸位预约</h2>
    <div class="form-grid">
      <label>
        车牌号
        <input v-model="form.plate" placeholder="如 沪A·82L6" required />
      </label>
      <label>
        温区
        <select v-model="form.tempZone" required>
          <option v-for="zone in tempZoneOptions" :key="zone" :value="zone">
            {{ tempZoneMeta[zone].label }}{{ tempZoneMeta[zone].cold ? "（冷链车）" : "" }}
          </option>
        </select>
      </label>
      <label>
        装卸位
        <select v-model="form.dockId" required>
          <option value="">请选择</option>
          <option v-for="dock in selectableDocks" :key="dock.id" :value="dock.id">
            {{ dock.name }} · {{ dockKindMeta[dock.kind].label }}
          </option>
        </select>
      </label>
      <p v-if="isColdCargo" class="rule-hint">冷链车只能预约冷藏位，普通位已自动隐藏。</p>
      <div class="time-row">
        <label>
          开始
          <input v-model="form.startInput" type="datetime-local" required />
        </label>
        <label>
          结束
          <input v-model="form.endInput" type="datetime-local" required />
        </label>
      </div>
      <label>
        备注
        <textarea v-model="form.notes" placeholder="货物、单据或到场说明" />
      </label>

      <ul v-if="liveConflicts.length" class="live-conflicts">
        <li v-for="(item, index) in liveConflicts" :key="index">
          ⚠ {{ item.detail || item.ruleLabel }}
        </li>
      </ul>

      <div class="actions">
        <button type="submit" :disabled="submitting || liveConflicts.length > 0">
          {{ submitLabel }}
        </button>
        <button type="button" class="secondary" @click="emit('cancel')">清空</button>
      </div>
    </div>
  </form>
</template>
