import { MessageCircle, Phone, Mail } from "lucide-react";

export interface Customer {
  _id: string;
  firstName: string;
  lastName: string;
  phone?: string;
  email?: string;
  crmId?: string;
  channel: string;
}

export interface Message {
  _id: string;
  conversationId: string;
  tenantId: string;
  direction: "INBOUND" | "OUTBOUND";
  content: string;
  htmlContent?: string;
  type: string;
  channel: string;
  isInternal?: boolean;
  senderName?: string;
  senderId?: string;
  senderRole?: string;
  deliveryStatus?: "sent" | "delivered" | "read" | "failed";
  metadata?: any;
  createdAt: string;
  replyToMessageId?: string;
  replyToContent?: string;
  replyToSender?: string;
  forwardedFromMessageId?: string;
  flagged?: boolean;
  deletedAt?: string;
  editedAt?: string;
}

export interface Conversation {
  _id: string;
  tenantId: string;
  customerId: string;
  status: "OPEN" | "PENDING" | "RESOLVED" | "UNASSIGNED" | "ACTIVE" | "SNOOZED" | "SPAM";
  channel: "WHATSAPP" | "SMS" | "EMAIL";
  lastMessageAt: string;
  lastInboundAt?: string;
  createdAt?: string;
  updatedAt?: string;
  assignedTo?: string;
  assignedName?: string;
  assignedAt?: string;
  customer?: Customer;
  lastMessage?: Message;
  tags?: string[];
  resolutionTag?: string;
  resolutionSummary?: string;
  snoozedUntil?: string;
  customerConversationCount?: number;
  starred?: boolean;
  unreadCount?: number;
  channelPhoneNumberId?: string | null;
  isOrphan?: boolean;
  orphanPhoneNumberId?: string;
}

export const CHANNEL_LINE_MAP: Record<string, { label: string; color: string }> = {
  "974917135711141": { label: "03-5020115", color: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 border-blue-200 dark:border-blue-800" },
};
export const DEFAULT_CHANNEL_LINE = { label: "03-5020940", color: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800" };

export interface Agent {
  _id: string;
  name: string;
  role: string;
  groupId?: string;
}

export interface JourneyConversation {
  _id: string;
  tenantId: string;
  customerId: string;
  status: "OPEN" | "PENDING" | "RESOLVED" | "UNASSIGNED" | "ACTIVE" | "SNOOZED";
  channel: "WHATSAPP" | "SMS" | "EMAIL";
  lastMessageAt: string;
  createdAt: string;
  messages: Message[];
}

export type MediaCache = Record<string, { base64: string; mimeType: string; fileName?: string; streamUrl?: string }>;

export const channelIcons: Record<string, typeof MessageCircle> = {
  WHATSAPP: MessageCircle,
  SMS: Phone,
  EMAIL: Mail,
};

export const channelColors: Record<string, string> = {
  WHATSAPP: "text-green-600",
  SMS: "text-slate-500",
  EMAIL: "text-blue-600",
};

export const channelBadgeBg: Record<string, string> = {
  WHATSAPP: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  SMS: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
  EMAIL: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
};
