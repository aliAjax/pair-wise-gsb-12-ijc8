<script setup lang="ts">
import {
  dockKindMeta,
  statusMeta,
  tempZoneMeta,
  type Dock,
  type Reservation
} from "../domain/types";
import { formatDateTime, formatRange } from "../domain/time";

const props = defineProps<{
  reservation: Reservation;
  dock?: Dock;
  rebookTarget?: Reservation | null;
}>();

const emit = defineEmits<{
  checkIn: [id: string];
  startLoading: [id: string];
  release: [reservation: Reservation];
  reschedule: [reservation: Reservation];
  cancelLoading: [reservation: Reservation];
  cancelReserved: [reservation: Reservation];
}>();
</script>

<template>
  <article class="record" :data-status="reservation.status">
    <div class="record-head">
      <p class="record-title">{{ reservation.plate }}</p>
      <span class="status" :data-tone="statusMeta[reservation.status].tone">
        {{ statusMeta[reservation.status].label }}
      </span>
    </div>

    <div class="details">
      <span>温区：{{ tempZoneMeta[reservation.tempZone].label }}</span>
      <span>装卸位：{{ dock ? `${dock.name}（${dockKindMeta[dock.kind].label}）` : reservation.dockId }}</span>
      <span class="span-2">时段：{{ formatRange(reservation.startAt, reservation.endAt) }}</span>
      <span v-if="reservation.checkedInAt">入场时间：{{ formatDateTime(reservation.checkedInAt) }}</span>
      <span v-if="reservation.releasedAt">放行时间：{{ formatDateTime(reservation.releasedAt) }}</span>
    </div>

    <div v-if="reservation.status === 'released'" class="release-info">
      <span>铅封号：<b>{{ reservation.sealNo }}</b></span>
      <span>净重：<b>{{ reservation.netWeight }} 吨</b></span>
      <p>放行备注：{{ reservation.releaseNotes }}</p>
    </div>

    <p v-if="reservation.notes" class="note">预约备注：{{ reservation.notes }}</p>
    <p v-if="reservation.endReason" class="note warn">终态说明：{{ reservation.endReason }}</p>
    <p v-if="rebookTarget" class="note">
      后续预约：{{ rebookTarget.plate }} → {{ dock?.name ?? "" }}
      {{ formatRange(rebookTarget.startAt, rebookTarget.endAt) }}
    </p>

    <div class="actions">
      <button v-if="reservation.status === 'reserved'" type="button" @click="emit('checkIn', reservation.id)">
        入场（锁定预约）
      </button>
      <button v-if="reservation.status === 'checkedIn'" type="button" @click="emit('startLoading', reservation.id)">
        开始装卸
      </button>
      <template v-if="reservation.status === 'loading'">
        <button type="button" @click="emit('release', reservation)">录入放行资料</button>
        <button class="danger" type="button" @click="emit('cancelLoading', reservation)">终止装卸</button>
      </template>
      <template v-if="reservation.status === 'reserved'">
        <button class="secondary" type="button" @click="emit('reschedule', reservation)">改约</button>
        <button class="danger" type="button" @click="emit('cancelReserved', reservation)">取消预约</button>
      </template>
    </div>
  </article>
</template>
