/**
 * @jest-environment jsdom
 */
import {
  STATUS_COLORS,
  NOTE_COLORS,
  READ_RECEIPT_BLUE,
  WA_BG_LIGHT,
  WA_BG_DARK,
  getStatusBorderColor,
  getStatusBadgeStyle,
} from "../../client/src/lib/constants/theme";

describe("Theme Constants", () => {
  describe("STATUS_COLORS", () => {
    it("should define APPROVED colors", () => {
      expect(STATUS_COLORS.APPROVED.border).toBe("#22c55e");
      expect(STATUS_COLORS.APPROVED.text).toBe("#16a34a");
      expect(STATUS_COLORS.APPROVED.bg).toBe("#f0fdf4");
    });

    it("should define REJECTED colors", () => {
      expect(STATUS_COLORS.REJECTED.border).toBe("#ef4444");
      expect(STATUS_COLORS.REJECTED.text).toBe("#dc2626");
      expect(STATUS_COLORS.REJECTED.bg).toBe("#fef2f2");
    });

    it("should define PENDING colors", () => {
      expect(STATUS_COLORS.PENDING.border).toBe("#eab308");
      expect(STATUS_COLORS.PENDING.text).toBe("#ca8a04");
      expect(STATUS_COLORS.PENDING.bg).toBe("#fefce8");
    });

    it("should define DEFAULT border color", () => {
      expect(STATUS_COLORS.DEFAULT.border).toBe("#6b7280");
    });
  });

  describe("NOTE_COLORS", () => {
    it("should define note background and text colors", () => {
      expect(NOTE_COLORS.bg).toBe("#FFF9C4");
      expect(NOTE_COLORS.bgDark).toBe("#3a3520");
      expect(NOTE_COLORS.text).toBe("#7D6608");
      expect(NOTE_COLORS.textDark).toBe("#c9a90c");
      expect(NOTE_COLORS.textDarkAlt).toBe("#e0d5a0");
      expect(NOTE_COLORS.border).toBe("#F1C40F");
    });
  });

  describe("WhatsApp Background Colors", () => {
    it("should define light mode WA background", () => {
      expect(WA_BG_LIGHT).toBe("#e5ddd5");
    });

    it("should define dark mode WA background", () => {
      expect(WA_BG_DARK).toBe("#0b141a");
    });
  });

  describe("Other Constants", () => {
    it("should define read receipt blue", () => {
      expect(READ_RECEIPT_BLUE).toBe("#4FC3F7");
    });
  });

  describe("getStatusBorderColor", () => {
    it("should return APPROVED border color", () => {
      expect(getStatusBorderColor("APPROVED")).toBe("#22c55e");
    });

    it("should return REJECTED border color", () => {
      expect(getStatusBorderColor("REJECTED")).toBe("#ef4444");
    });

    it("should return PENDING border color", () => {
      expect(getStatusBorderColor("PENDING")).toBe("#eab308");
    });

    it("should return DEFAULT border for DRAFT status", () => {
      expect(getStatusBorderColor("DRAFT")).toBe("#6b7280");
    });

    it("should return DEFAULT border for unknown status", () => {
      expect(getStatusBorderColor("UNKNOWN")).toBe("#6b7280");
    });
  });

  describe("getStatusBadgeStyle", () => {
    it("should return full style object for APPROVED", () => {
      const style = getStatusBadgeStyle("APPROVED");
      expect(style).toEqual({
        borderColor: "#22c55e",
        color: "#16a34a",
        backgroundColor: "#f0fdf4",
      });
    });

    it("should return full style object for REJECTED", () => {
      const style = getStatusBadgeStyle("REJECTED");
      expect(style).toEqual({
        borderColor: "#ef4444",
        color: "#dc2626",
        backgroundColor: "#fef2f2",
      });
    });

    it("should return full style object for PENDING", () => {
      const style = getStatusBadgeStyle("PENDING");
      expect(style).toEqual({
        borderColor: "#eab308",
        color: "#ca8a04",
        backgroundColor: "#fefce8",
      });
    });

    it("should return undefined for DRAFT status", () => {
      expect(getStatusBadgeStyle("DRAFT")).toBeUndefined();
    });

    it("should return undefined for unknown status", () => {
      expect(getStatusBadgeStyle("SOMETHING_ELSE")).toBeUndefined();
    });
  });
});
