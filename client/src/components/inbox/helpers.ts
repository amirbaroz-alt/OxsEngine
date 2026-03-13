import UTIF from "utif";
import type { Customer, MediaCache } from "./types";
export { formatPhoneDisplay, formatTime } from "@/lib/format-utils";
import { WHATSAPP_SESSION_WINDOW_MS, SLA_DEFAULT_RESPONSE_MINUTES, SLA_DEFAULT_WARNING_MINUTES } from "@/lib/constants/limits";

export function getInitials(c?: Customer): string {
  if (!c) return "?";
  return ((c.firstName?.[0] || "") + (c.lastName?.[0] || "")).toUpperCase() || "?";
}

export function formatSnoozeUntil(dateStr: string): string {
  const d = new Date(dateStr);
  const date = d.toLocaleDateString([], { day: "2-digit", month: "2-digit" });
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date} ${time}`;
}

export function is24hExpired(conv?: { lastInboundAt?: string; lastMessageAt?: string; createdAt?: string } | null): boolean {
  if (!conv) return true;
  const ref = conv.lastInboundAt || conv.lastMessageAt || conv.createdAt;
  if (!ref) return true;
  return (Date.now() - new Date(ref).getTime()) > WHATSAPP_SESSION_WINDOW_MS;
}

export function getSlaStatus(
  conv: { status: string; lastInboundAt?: string; lastMessageAt?: string; createdAt?: string },
  slaConfig?: { responseTimeMinutes?: number; warningTimeMinutes?: number; enabled?: boolean } | null
): { breached: boolean; warning: boolean; waitingMinutes: number } {
  if (!slaConfig?.enabled) return { breached: false, warning: false, waitingMinutes: 0 };
  if (conv.status === "RESOLVED") return { breached: false, warning: false, waitingMinutes: 0 };
  const ref = conv.lastInboundAt || conv.lastMessageAt || conv.createdAt;
  if (!ref) return { breached: false, warning: false, waitingMinutes: 0 };
  const waitingMinutes = Math.floor((Date.now() - new Date(ref).getTime()) / 60000);
  const responseTime = slaConfig.responseTimeMinutes ?? SLA_DEFAULT_RESPONSE_MINUTES;
  const warningTime = slaConfig.warningTimeMinutes ?? SLA_DEFAULT_WARNING_MINUTES;
  return {
    breached: waitingMinutes >= responseTime,
    warning: waitingMinutes >= warningTime && waitingMinutes < responseTime,
    waitingMinutes,
  };
}

export function isTiffMime(mimeType?: string): boolean {
  if (!mimeType) return false;
  return mimeType === "image/tiff" || mimeType === "image/tif";
}

export function tiffBase64ToPngDataUrl(base64: string): string | null {
  try {
    const binary = atob(base64);
    const buf = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) buf[i] = binary.charCodeAt(i);
    const ifds = UTIF.decode(buf.buffer);
    if (!ifds.length) return null;
    UTIF.decodeImage(buf.buffer, ifds[0]);
    const rgba = UTIF.toRGBA8(ifds[0]);
    const w = ifds[0].width;
    const h = ifds[0].height;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const imgData = ctx.createImageData(w, h);
    imgData.data.set(new Uint8ClampedArray(rgba.buffer));
    ctx.putImageData(imgData, 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

export function getImageSrc(base64: string, mimeType: string): string {
  if (isTiffMime(mimeType)) {
    return tiffBase64ToPngDataUrl(base64) || `data:${mimeType};base64,${base64}`;
  }
  return `data:${mimeType};base64,${base64}`;
}

export function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType });
}

export function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function fetchMediaBatchProgressive(
  ids: string[],
  onChunkLoaded: (chunk: MediaCache) => void,
): Promise<void> {
  if (ids.length === 0) return;
  const token = localStorage.getItem("auth_token") || "";
  const reversed = [...ids].reverse();
  const chunks: string[][] = [];
  for (let i = 0; i < reversed.length; i += 10) chunks.push(reversed.slice(i, i + 10));
  for (const chunk of chunks) {
    try {
      const res = await fetch("/api/inbox/messages/media-batch", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        credentials: "include",
        body: JSON.stringify({ ids: chunk }),
      });
      if (res.ok) {
        const data = await res.json();
        const streamIds: { id: string; mimeType: string; fileName?: string }[] = [];
        const directEntries: MediaCache = {};
        for (const [id, entry] of Object.entries(data)) {
          if ((entry as any).useStream) {
            streamIds.push({ id, mimeType: (entry as any).mimeType || "application/octet-stream", fileName: (entry as any).fileName });
          } else {
            directEntries[id] = entry as any;
          }
        }
        if (Object.keys(directEntries).length > 0) {
          onChunkLoaded(directEntries);
        }
        for (const item of streamIds) {
          try {
            const streamRes = await fetch(`/api/inbox/messages/${item.id}/media/stream`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (streamRes.ok) {
              const blob = await streamRes.blob();
              const reader = new FileReader();
              const b64 = await new Promise<string>((resolve) => {
                reader.onloadend = () => resolve((reader.result as string).split(",")[1] || "");
                reader.readAsDataURL(blob);
              });
              onChunkLoaded({ [item.id]: { base64: b64, mimeType: blob.type || item.mimeType, fileName: item.fileName } });
            }
          } catch {}
        }
      }
    } catch {}
  }
}
