import {
  WHATSAPP_SESSION_WINDOW_MS,
  MEDIA_MAX_DOWNLOAD_SIZE,
  MEDIA_MAX_BASE64_SIZE,
  DEFERRED_MEDIA_INITIAL_DELAY_MS,
  DEFERRED_MEDIA_RETRY_DELAY_MS,
  MEDIA_DOWNLOAD_TIMEOUT_MS,
  API_REQUEST_TIMEOUT_MS,
  MAX_TEMPLATE_MESSAGE_LENGTH,
  MEDIA_URL_EXPIRY_MS,
  MEDIA_SIZE_LIMITS,
  MEDIA_SIZE_DEFAULT,
  SLA_DEFAULT_RESPONSE_MINUTES,
  SLA_DEFAULT_WARNING_MINUTES,
} from "../../server/lib/constants/limits";

describe("Backend Constants (server/lib/constants/limits.ts)", () => {
  describe("WhatsApp Session Window", () => {
    it("should be exactly 24 hours in milliseconds", () => {
      expect(WHATSAPP_SESSION_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
      expect(WHATSAPP_SESSION_WINDOW_MS).toBe(86400000);
    });
  });

  describe("Media Size Limits", () => {
    it("should set max download size to 50MB", () => {
      expect(MEDIA_MAX_DOWNLOAD_SIZE).toBe(50 * 1024 * 1024);
    });

    it("should set max base64 size to 10MB", () => {
      expect(MEDIA_MAX_BASE64_SIZE).toBe(10 * 1024 * 1024);
    });

    it("should set default media size to 16MB", () => {
      expect(MEDIA_SIZE_DEFAULT).toBe(16 * 1024 * 1024);
    });

    it("should define per-type upload limits", () => {
      expect(MEDIA_SIZE_LIMITS.AUDIO).toBe(16 * 1024 * 1024);
      expect(MEDIA_SIZE_LIMITS.IMAGE).toBe(5 * 1024 * 1024);
      expect(MEDIA_SIZE_LIMITS.VIDEO).toBe(16 * 1024 * 1024);
      expect(MEDIA_SIZE_LIMITS.DOCUMENT).toBe(100 * 1024 * 1024);
      expect(MEDIA_SIZE_LIMITS.STICKER).toBe(500 * 1024);
      expect(MEDIA_SIZE_LIMITS.FILE).toBe(100 * 1024 * 1024);
    });
  });

  describe("Deferred Media Timing", () => {
    it("should set initial delay to 5 seconds", () => {
      expect(DEFERRED_MEDIA_INITIAL_DELAY_MS).toBe(5000);
    });

    it("should set retry delay to 30 seconds", () => {
      expect(DEFERRED_MEDIA_RETRY_DELAY_MS).toBe(30000);
    });
  });

  describe("Timeout Constants", () => {
    it("should set media download timeout to 60 seconds", () => {
      expect(MEDIA_DOWNLOAD_TIMEOUT_MS).toBe(60000);
    });

    it("should set API request timeout to 15 seconds", () => {
      expect(API_REQUEST_TIMEOUT_MS).toBe(15000);
    });
  });

  describe("SLA Defaults", () => {
    it("should set default response time to 15 minutes", () => {
      expect(SLA_DEFAULT_RESPONSE_MINUTES).toBe(15);
    });

    it("should set default warning time to 10 minutes", () => {
      expect(SLA_DEFAULT_WARNING_MINUTES).toBe(10);
    });
  });

  describe("Template and URL Limits", () => {
    it("should set max template message length to 1500", () => {
      expect(MAX_TEMPLATE_MESSAGE_LENGTH).toBe(1500);
    });

    it("should set media URL expiry to 5 minutes", () => {
      expect(MEDIA_URL_EXPIRY_MS).toBe(5 * 60 * 1000);
      expect(MEDIA_URL_EXPIRY_MS).toBe(300000);
    });
  });
});

describe("Media Service uses constants from limits.ts", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it("should import MEDIA_MAX_DOWNLOAD_SIZE for downloadMediaAsBuffer default", async () => {
    jest.mock("../../server/index", () => ({ log: jest.fn() }));
    jest.mock("../../server/services/socket.service", () => ({ emitNewMessage: jest.fn() }));

    const limitsModule = await import("../../server/lib/constants/limits");
    const mediaModule = await import("../../server/services/whatsapp-media.service");

    const source = require("fs").readFileSync(
      require("path").resolve(__dirname, "../../server/services/whatsapp-media.service.ts"),
      "utf8"
    );

    expect(source).toContain("MEDIA_MAX_DOWNLOAD_SIZE");
    expect(source).toContain("MEDIA_MAX_BASE64_SIZE");
    expect(source).toContain("DEFERRED_MEDIA_INITIAL_DELAY_MS");
    expect(source).toContain("DEFERRED_MEDIA_RETRY_DELAY_MS");
    expect(source).toContain("MEDIA_URL_EXPIRY_MS");
    expect(source).not.toMatch(/maxSize\s*=\s*50\s*\*\s*1024\s*\*\s*1024/);
    expect(source).not.toMatch(/10\s*\*\s*1024\s*\*\s*1024(?!.*import)/);
  });

  it("should import MEDIA_SIZE_LIMITS in inbox routes", () => {
    const source = require("fs").readFileSync(
      require("path").resolve(__dirname, "../../server/routes/inbox.ts"),
      "utf8"
    );

    expect(source).toContain("MEDIA_LIMITS_MAP");
    expect(source).toContain("MEDIA_SIZE_DEFAULT");
    expect(source).not.toContain("AUDIO: 16 * 1024 * 1024");
  });
});
