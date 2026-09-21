// 展示层文案与配色（不属于领域规则）。
import type { EventType, ReservationStatus } from "../domain/types";

export const STATUS_LABELS: Record<ReservationStatus, string> = {
  booked: "待入场",
  loading: "装卸中（已锁定）",
  released: "已放行",
  expired: "超时释放",
  rescheduled: "已改约释放",
  aborted: "装卸取消",
};

export const STATUS_BADGE: Record<ReservationStatus, string> = {
  booked: "badge badge-booked",
  loading: "badge badge-loading",
  released: "badge badge-released",
  expired: "badge badge-expired",
  rescheduled: "badge badge-rescheduled",
  aborted: "badge badge-aborted",
};

export const EVENT_LABELS: Record<EventType, string> = {
  created: "新建预约",
  entered: "入场锁定",
  released: "放行",
  expired: "超时释放",
  rescheduled: "改约/取消",
  aborted: "装卸取消",
};

export const EVENT_BADGE: Record<EventType, string> = {
  created: "badge badge-booked",
  entered: "badge badge-loading",
  released: "badge badge-released",
  expired: "badge badge-expired",
  rescheduled: "badge badge-rescheduled",
  aborted: "badge badge-aborted",
};
