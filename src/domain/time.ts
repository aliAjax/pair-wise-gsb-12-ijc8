// 时间工具：全部用本地时区录入（datetime-local），落库统一转为 ISO 字符串。

const pad = (n: number) => String(n).padStart(2, "0");

/** Date -> datetime-local input 值（YYYY-MM-DDTHH:mm，本地时区） */
export function toLocalInput(value: Date | string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local 值 -> ISO 字符串；非法输入返回 "" */
export function fromLocalInput(value: string): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

/** ISO -> 展示用 MM-DD HH:mm */
export function formatDateTime(iso: string | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 时段展示 */
export function formatRange(startIso: string, endIso: string): string {
  return `${formatDateTime(startIso)} ~ ${formatDateTime(endIso)}`;
}

/** 时长（分钟） */
export function durationMinutes(startIso: string, endIso: string): number {
  return Math.max(0, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000));
}
