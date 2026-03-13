import mongoose from "mongoose";
import axios from "axios";
import "./setup";
import { SmsService } from "../server/services/sms.service";
import { CommunicationLogModel } from "../server/models/communication-log.model";

jest.mock("../server/index", () => ({
  log: jest.fn(),
}));

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("SmsService (019SMS)", () => {
  const tenantId = new mongoose.Types.ObjectId().toString();
  let smsService: SmsService;

  beforeEach(() => {
    smsService = new SmsService();
    (smsService as any).scheduleAutoRetry = jest.fn();
  });

  describe("Successful Send", () => {
    it("should set communicationLog status to Success on status 0 response", async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { status: 0, message: "SMS will be sent", shipment_id: "ship-123" },
      });

      const result = await smsService.sendSms({
        recipient: "0501234567",
        content: "Test message",
        tenantId,
      });

      expect(result.status).toBe("Success");
      expect(result.messageId).toBe("ship-123");
      expect(result.retryCount).toBe(0);
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    });

    it("should send correct 019SMS payload format with sms wrapper", async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { status: 0, message: "SMS will be sent", shipment_id: "ship-456" },
      });

      await smsService.sendSms({
        recipient: "0501234567",
        content: "Payload test",
        tenantId,
      });

      expect(mockedAxios.post).toHaveBeenCalledWith(
        "https://019sms.co.il/api",
        expect.objectContaining({
          sms: expect.objectContaining({
            user: expect.objectContaining({ username: expect.any(String) }),
            source: expect.any(String),
            destinations: expect.objectContaining({ phone: ["501234567"] }),
            message: "Payload test",
          }),
        }),
        expect.objectContaining({
          headers: expect.objectContaining({
            "Content-Type": "application/json",
            "Authorization": expect.stringContaining("Bearer"),
          }),
        })
      );
    });

    it("should use sms.user.username from SMS019_USER_NAME env var", async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { status: 0, message: "OK", shipment_id: "ship-user" },
      });

      await smsService.sendSms({
        recipient: "0501234567",
        content: "Username check",
        tenantId,
      });

      const callPayload = mockedAxios.post.mock.calls[0][1] as any;
      expect(callPayload.sms.user.username).toBe(process.env.SMS019_USER_NAME);
    });

    it("should include Bearer token in Authorization header", async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { status: 0, message: "OK", shipment_id: "ship-auth" },
      });

      await smsService.sendSms({
        recipient: "0501234567",
        content: "Auth check",
        tenantId,
      });

      const callConfig = mockedAxios.post.mock.calls[0][2] as any;
      expect(callConfig.headers["Authorization"]).toBe(`Bearer ${process.env.SMS019_ACCESS_TOKEN}`);
    });

    it("should persist the log entry in the database", async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { status: 0, message: "OK", shipment_id: "db-check" },
      });

      await smsService.sendSms({
        recipient: "0509999999",
        content: "DB persistence test",
        tenantId,
      });

      const logs = await CommunicationLogModel.find({ recipient: "0509999999" });
      expect(logs.length).toBe(1);
      expect(logs[0].content).toBe("DB persistence test");
      expect(logs[0].status).toBe("Success");
    });
  });

  describe("Auto-Retry Mechanism", () => {
    it("should call scheduleAutoRetry on failure (status != 0)", async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { status: 1, message: "Service unavailable" },
      });

      const result = await smsService.sendSms({
        recipient: "0501234567",
        content: "Test message",
        tenantId,
      });

      expect(result.status).toBe("Failed");
      expect(result.errorMessage).toBe("Service unavailable");
      expect((smsService as any).scheduleAutoRetry).toHaveBeenCalledTimes(1);
      expect((smsService as any).scheduleAutoRetry).toHaveBeenCalledWith(
        expect.any(String),
        "0501234567",
        "Test message",
        0
      );
    });

    it("should increment retryCount in the database on each manual retry", async () => {
      mockedAxios.post.mockResolvedValue({
        data: { status: 1, message: "Still failing" },
      });

      const initial = await smsService.sendSms({
        recipient: "0501234567",
        content: "Multi-retry test",
        tenantId,
      });

      const retry1 = await smsService.retrySms(String(initial._id));
      expect(retry1!.retryCount).toBe(1);

      const dbAfterRetry1 = await CommunicationLogModel.findById(initial._id);
      expect(dbAfterRetry1!.retryCount).toBe(1);

      const retry2 = await smsService.retrySms(String(initial._id));
      expect(retry2!.retryCount).toBe(2);

      const dbAfterRetry2 = await CommunicationLogModel.findById(initial._id);
      expect(dbAfterRetry2!.retryCount).toBe(2);
    });

    it("should handle network errors and trigger retry", async () => {
      mockedAxios.post.mockRejectedValueOnce(new Error("ECONNREFUSED"));

      const result = await smsService.sendSms({
        recipient: "0501234567",
        content: "Network error test",
        tenantId,
      });

      expect(result.status).toBe("Failed");
      expect(result.errorMessage).toBe("ECONNREFUSED");
      expect((smsService as any).scheduleAutoRetry).toHaveBeenCalledTimes(1);
    });
  });

  describe("Manual Retry", () => {
    it("should not exceed the maximum of 3 retries", async () => {
      mockedAxios.post.mockResolvedValue({
        data: { status: 1, message: "Persistent failure" },
      });

      const initial = await smsService.sendSms({
        recipient: "0501234567",
        content: "Max retry test",
        tenantId,
      });

      await smsService.retrySms(String(initial._id));
      await smsService.retrySms(String(initial._id));
      await smsService.retrySms(String(initial._id));

      const finalAttempt = await smsService.retrySms(String(initial._id));
      expect(finalAttempt!.retryCount).toBe(3);

      const logEntry = await CommunicationLogModel.findById(initial._id);
      expect(logEntry!.retryCount).toBe(3);
    });

    it("should succeed on manual retry after initial failure", async () => {
      mockedAxios.post.mockResolvedValueOnce({
        data: { status: 1, message: "Temporary failure" },
      });

      const initial = await smsService.sendSms({
        recipient: "0501234567",
        content: "Retry test",
        tenantId,
      });

      expect(initial.status).toBe("Failed");

      mockedAxios.post.mockResolvedValueOnce({
        data: { status: 0, message: "OK", shipment_id: "ship-retry-ok" },
      });

      const retried = await smsService.retrySms(String(initial._id));

      expect(retried).not.toBeNull();
      expect(retried!.status).toBe("Success");
      expect(retried!.retryCount).toBe(1);
      expect(retried!.messageId).toBe("ship-retry-ok");
    });

    it("should return null for non-existent log ID", async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      const result = await smsService.retrySms(fakeId);
      expect(result).toBeNull();
    });
  });
});
