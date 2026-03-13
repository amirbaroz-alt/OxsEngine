export function formatPhoneDisplay(phone: string): string {
  if (!phone) return phone;
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("972") && digits.length >= 12 && digits.length <= 13) {
    digits = "0" + digits.slice(3);
  }
  if (digits.length === 10 && digits.startsWith("0")) {
    return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  }
  return phone;
}

export function formatPhone(phone: string): string {
  const digits = phone.replace(/[-\s]/g, "");
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return phone;
}

export function formatDate(timestamp: string, language: string): string {
  try {
    const locale = language === "ar" ? "ar-EG" : language === "en" ? "en-US" : "he-IL";
    return new Date(timestamp).toLocaleString(locale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return timestamp;
  }
}

export function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const time24 = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  if (diffDays === 0) return time24;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return d.toLocaleDateString([], { weekday: "short" });
  return d.toLocaleDateString([], { day: "2-digit", month: "2-digit" });
}

export function formatConversationDate(dateStr: string): string {
  const d = new Date(dateStr);
  const date = d.toLocaleDateString([], { day: "2-digit", month: "2-digit", year: "2-digit" });
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date} ${time}`;
}
