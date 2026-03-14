import crypto from "crypto";
import mongoose from "mongoose";
import { SystemAuditLogModel, type ISystemAuditLog, type IAuditStep } from "../models/SystemAuditLog";
import { traceBuffer, type TraceData, MAX_BUFFER_SIZE } from "../lib/trace-buffer";
import { encryptPayload, decryptPayload, maskPhone } from "../utils/encryption";
import { getMessageModel } from "../models/message.model";
import { log } from "../lib/logger";

export interface StartTraceParams {
  traceId?: string;
  parentTraceId?: string;
  direction: "INBOUND" | "OUTBOUND";
  whatsappMessageId?: string;
  tenantId?: string;
  rawPayload?: string;
  encryptedContent?: string;
  sequenceTimestamp?: Date;
  messageType?: string;
  mimeType?: string;
  fileSize?: number;
  senderPhone?: string;
  senderName?: string;
  phoneNumberId?: string;
}

export interface UpdateStepParams {
  traceId: string;
  step: string;
  status: "OK" | "FAIL" | "SKIP";
  error?: string;
  durationMs?: number;
}

export interface FinalizeTraceParams {
  traceId: string;
  pipelineStatus?: "COMPLETED" | "FAILED" | "PARTIAL";
  assignedWorkerId?: string;
  tenantDbConnection?: mongoose.Connection;
}

export interface AccessLogEntry {
  traceId: string;
  viewedBy: string;
  viewerRole: string;
  viewedAt: Date;
  fieldsAccessed: string[];
}

class AuditService {
  private static instance: AuditService;
  private accessLog: AccessLogEntry[] = [];

  private constructor() {
    traceBuffer.setForceFlushHandler(async (data: TraceData) => {
      log(`[audit] ⚠ Buffer limit hit (${MAX_BUFFER_SIZE}): force-flushing oldest trace ${data.traceId} as PARTIAL_BUFFER_EXCEEDED`, "audit");
      await this.flushToMongo(data);
    });
  }

  static getInstance(): AuditService {
    if (!AuditService.instance) {
      AuditService.instance = new AuditService();
    }
    return AuditService.instance;
  }

  async findExistingTrace(whatsappMessageId: string): Promise<{ traceId: string; source: "buffer" | "db" } | null> {
    const buffered = traceBuffer.findByWhatsappMessageId(whatsappMessageId);
    if (buffered) {
      return { traceId: buffered.traceId, source: "buffer" };
    }

    const doc = await SystemAuditLogModel.findOne({ whatsappMessageId }).select("traceId").lean();
    if (doc) {
      return { traceId: doc.traceId, source: "db" };
    }

    return null;
  }

  async incrementRetry(traceId: string, source: "buffer" | "db"): Promise<void> {
    if (source === "buffer") {
      const data = traceBuffer.get(traceId);
      if (data) {
        traceBuffer.update(traceId, { retryCount: data.retryCount + 1 });
        traceBuffer.addStep(traceId, {
          step: "DUPLICATE_RETRY",
          status: "OK",
          timestamp: new Date(),
        });
      }
    } else {
      await SystemAuditLogModel.updateOne(
        { traceId },
        {
          $inc: { retryCount: 1 },
          $push: {
            steps: {
              step: "DUPLICATE_RETRY",
              status: "OK",
              timestamp: new Date(),
            },
          },
        }
      );
    }
    log(`[audit] Duplicate detected for trace ${traceId}, retryCount incremented`, "audit");
  }

  async startTrace(params: StartTraceParams): Promise<string> {
    const traceId = params.traceId || crypto.randomUUID();
    const now = Date.now();

    const traceData: TraceData = {
      traceId,
      parentTraceId: params.parentTraceId,
      whatsappMessageId: params.whatsappMessageId,
      tenantId: params.tenantId,
      direction: params.direction,
      pipelineStatus: "PENDING",
      encryptedContent: params.encryptedContent || (params.rawPayload ? encryptPayload(params.rawPayload) : undefined),
      sequenceTimestamp: params.sequenceTimestamp,
      handlingStatus: "OPEN",
      retryCount: 0,
      steps: [
        {
          step: "TRACE_STARTED",
          status: "OK",
          timestamp: new Date(),
          duration: 0,
        },
      ],
      startedAt: now,
      messageType: params.messageType,
      mimeType: params.mimeType,
      fileSize: params.fileSize,
      senderPhone: params.senderPhone,
      senderName: params.senderName,
      phoneNumberId: params.phoneNumberId,
    };

    await traceBuffer.set(traceId, traceData);

    traceBuffer.setExpireCallback(traceId, (data) => {
      log(`[audit] Trace ${traceId} expired in buffer, flushing as STUCK`, "audit");
      data.pipelineStatus = "STUCK";
      this.flushToMongo(data).catch((err) => {
        log(`[audit] Failed to flush expired trace ${traceId}: ${err.message}`, "audit");
      });
    });

    log(`[audit] Trace started: ${traceId} [${params.direction}]`, "audit");
    return traceId;
  }

  updateStep(params: UpdateStepParams): void {
    const { traceId, step, status, error, durationMs } = params;

    const stepEntry: IAuditStep = {
      step,
      status,
      error: error || undefined,
      duration: durationMs,
      timestamp: new Date(),
    };

    const updated = traceBuffer.addStep(traceId, stepEntry);
    if (!updated) {
      log(`[audit] updateStep: trace ${traceId} not found in buffer`, "audit");
      return;
    }

    if (status === "FAIL") {
      traceBuffer.update(traceId, { retryCount: updated.retryCount + 1 });
    }
  }

  updateTenantId(traceId: string, tenantId: string): void {
    traceBuffer.update(traceId, { tenantId });
  }

  updateMetadata(traceId: string, meta: { messageType?: string; mimeType?: string; fileSize?: number; senderPhone?: string; senderName?: string; phoneNumberId?: string }): void {
    const partial: Partial<import("../lib/trace-buffer").TraceData> = {};
    if (meta.messageType) partial.messageType = meta.messageType;
    if (meta.mimeType) partial.mimeType = meta.mimeType;
    if (meta.fileSize != null) partial.fileSize = meta.fileSize;
    if (meta.senderPhone) partial.senderPhone = meta.senderPhone;
    if (meta.senderName) partial.senderName = meta.senderName;
    if (meta.phoneNumberId) partial.phoneNumberId = meta.phoneNumberId;
    traceBuffer.update(traceId, partial);
  }

  async finalizeTrace(params: FinalizeTraceParams): Promise<ISystemAuditLog | null> {
    const { traceId, pipelineStatus = "COMPLETED", assignedWorkerId, tenantDbConnection } = params;

    const traceData = traceBuffer.delete(traceId);
    if (!traceData) {
      log(`[audit] finalizeTrace: trace ${traceId} not found in buffer`, "audit");
      return null;
    }

    traceData.steps.push({
      step: "TRACE_FINALIZED",
      status: "OK",
      timestamp: new Date(),
      duration: Date.now() - traceData.startedAt,
    });

    if (pipelineStatus === "COMPLETED" && tenantDbConnection && traceData.whatsappMessageId) {
      try {
        const MessageModel = getMessageModel(tenantDbConnection);
        const exists = await MessageModel.findOne({
          $or: [
            { messageId: traceData.whatsappMessageId },
            { "metadata.waMessageId": traceData.whatsappMessageId },
          ],
        }).lean();

        if (!exists) {
          log(`[audit] finalizeTrace: message ${traceData.whatsappMessageId} not found in tenant DB, marking PARTIAL`, "audit");
          traceData.pipelineStatus = "PARTIAL";
          traceData.steps.push({
            step: "CONSISTENCY_CHECK",
            status: "FAIL",
            error: "Message not found in tenant DB",
            timestamp: new Date(),
          });
        } else {
          traceData.pipelineStatus = pipelineStatus;
          traceData.steps.push({
            step: "CONSISTENCY_CHECK",
            status: "OK",
            timestamp: new Date(),
          });
        }
      } catch (err: any) {
        log(`[audit] finalizeTrace: consistency check failed: ${err.message}`, "audit");
        traceData.pipelineStatus = "PARTIAL";
        traceData.steps.push({
          step: "CONSISTENCY_CHECK",
          status: "FAIL",
          error: err.message,
          timestamp: new Date(),
        });
      }
    } else {
      traceData.pipelineStatus = pipelineStatus;
    }

    if (assignedWorkerId) {
      traceData.assignedWorkerId = assignedWorkerId;
    }

    const saved = await this.flushToMongo(traceData);

    if (traceData.pipelineStatus === "FAILED" || traceData.pipelineStatus === "STUCK") {
      try {
        const { sendFailureAlert } = await import("./audit-alert.service");
        const lastError = [...traceData.steps].reverse().find(s => s.error)?.error;
        let tenantName: string | undefined;
        if (traceData.tenantId) {
          try {
            const { TenantModel } = await import("../models/tenant.model");
            const tenant = await TenantModel.findById(traceData.tenantId).select("nameEn slug").lean();
            tenantName = (tenant as any)?.nameEn || (tenant as any)?.slug;
          } catch {}
        }
        sendFailureAlert({
          tenantId: traceData.tenantId,
          tenantName,
          traceId: traceData.traceId,
          error: lastError,
          whatsappMessageId: traceData.whatsappMessageId,
        }).catch((err: any) => log(`[audit] Alert dispatch error: ${err.message}`, "audit"));
      } catch (err: any) {
        log(`[audit] Failed to import alert service: ${err.message}`, "audit");
      }
    }

    return saved;
  }

  logAccess(entry: Omit<AccessLogEntry, "viewedAt">): void {
    const fullEntry: AccessLogEntry = {
      ...entry,
      viewedAt: new Date(),
    };
    this.accessLog.push(fullEntry);

    if (this.accessLog.length > 10000) {
      this.accessLog = this.accessLog.slice(-5000);
    }

    log(`[audit] Access logged: ${entry.viewedBy} (${entry.viewerRole}) viewed trace ${entry.traceId}`, "audit");
  }

  getAccessLog(traceId?: string): AccessLogEntry[] {
    if (traceId) {
      return this.accessLog.filter((e) => e.traceId === traceId);
    }
    return [...this.accessLog];
  }

  async getTrace(traceId: string): Promise<{
    trace: ISystemAuditLog | TraceData | null;
    source: "buffer" | "db";
  }> {
    const buffered = traceBuffer.get(traceId);
    if (buffered) {
      return { trace: buffered, source: "buffer" };
    }

    const doc = await SystemAuditLogModel.findOne({ traceId }).lean();
    return { trace: doc, source: "db" };
  }

  async queryTraces(filter: {
    tenantId?: string;
    direction?: "INBOUND" | "OUTBOUND";
    pipelineStatus?: string;
    whatsappMessageId?: string;
    phoneSearch?: string;
    from?: Date;
    to?: Date;
    page?: number;
    limit?: number;
  }): Promise<{ traces: ISystemAuditLog[]; totalCount: number }> {
    const query: any = {};

    if (filter.tenantId) query.tenantId = filter.tenantId;
    if (filter.direction) query.direction = filter.direction;
    if (filter.pipelineStatus) query.pipelineStatus = filter.pipelineStatus;
    if (filter.whatsappMessageId) query.whatsappMessageId = filter.whatsappMessageId;
    if (filter.phoneSearch) {
      const digits = filter.phoneSearch.replace(/[^\d]/g, "");
      if (digits.length >= 4) {
        const phoneSuffix = digits.length >= 9 ? digits.slice(-9) : digits;
        const escapedSuffix = phoneSuffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const suffixRegex = { $regex: escapedSuffix + "$" };
        console.log("DEBUG: Final Monitor Regex Suffix:", phoneSuffix);
        const phoneCondition = { $or: [
          { senderPhone: suffixRegex },
          { phoneNumberId: suffixRegex },
        ]};
        if (!query.$and) query.$and = [];
        query.$and.push(phoneCondition);
      }
    }
    if (filter.from || filter.to) {
      query.sequenceTimestamp = {};
      if (filter.from) query.sequenceTimestamp.$gte = filter.from;
      if (filter.to) query.sequenceTimestamp.$lte = filter.to;
    }

    const page = Math.max(1, filter.page || 1);
    const limit = Math.min(100, Math.max(1, filter.limit || 50));
    const skip = (page - 1) * limit;

    const [traces, totalCount] = await Promise.all([
      SystemAuditLogModel.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      SystemAuditLogModel.countDocuments(query),
    ]);

    return { traces: traces as ISystemAuditLog[], totalCount };
  }

  getBufferStats(): { activeTraces: number; traces: Array<{ traceId: string; direction: string; status: string; age: number; steps: number }> } {
    const all = traceBuffer.getAll();
    return {
      activeTraces: all.length,
      traces: all.map((t) => ({
        traceId: t.traceId,
        direction: t.direction,
        status: t.pipelineStatus,
        age: Date.now() - t.startedAt,
        steps: t.steps.length,
      })),
    };
  }

  decryptContent(encryptedContent: string): string {
    return decryptPayload(encryptedContent);
  }

  maskPhoneNumber(phone: string): string {
    return maskPhone(phone);
  }

  async flushToMongo(data: TraceData): Promise<ISystemAuditLog> {
    const doc = new SystemAuditLogModel({
      traceId: data.traceId,
      parentTraceId: data.parentTraceId || null,
      whatsappMessageId: data.whatsappMessageId,
      tenantId: data.tenantId ? new mongoose.Types.ObjectId(data.tenantId) : null,
      direction: data.direction,
      pipelineStatus: data.pipelineStatus,
      encryptedContent: data.encryptedContent,
      sequenceTimestamp: data.sequenceTimestamp,
      assignedWorkerId: data.assignedWorkerId ? new mongoose.Types.ObjectId(data.assignedWorkerId) : null,
      handlingStatus: data.handlingStatus,
      retryCount: data.retryCount,
      messageType: data.messageType,
      mimeType: data.mimeType,
      fileSize: data.fileSize,
      senderPhone: data.senderPhone,
      senderName: data.senderName,
      phoneNumberId: data.phoneNumberId,
      steps: data.steps,
    });

    const saved = await doc.save();
    log(`[audit] Trace ${data.traceId} flushed to MongoDB [${data.pipelineStatus}]`, "audit");
    return saved;
  }
}

export const auditService = AuditService.getInstance();
