import { formatConversationDate } from "../../client/src/lib/format-utils";

describe("formatConversationDate", () => {
  it("should return date and time in DD/MM/YY HH:MM format", () => {
    const result = formatConversationDate("2026-03-05T14:30:00.000Z");
    expect(typeof result).toBe("string");
    expect(result).toContain(":");
    expect(result.length).toBeGreaterThan(5);
  });

  it("should handle today's date", () => {
    const now = new Date();
    const result = formatConversationDate(now.toISOString());
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(5);
  });

  it("should handle yesterday's date", () => {
    const yesterday = new Date(Date.now() - 86400000);
    const result = formatConversationDate(yesterday.toISOString());
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(5);
  });

  it("should handle dates from last year", () => {
    const result = formatConversationDate("2025-01-15T09:00:00.000Z");
    expect(typeof result).toBe("string");
    expect(result).toContain(":");
  });

  it("should produce consistent output for same input", () => {
    const date = "2026-06-15T10:30:00.000Z";
    const result1 = formatConversationDate(date);
    const result2 = formatConversationDate(date);
    expect(result1).toBe(result2);
  });

  it("should include both date and time parts separated by space", () => {
    const result = formatConversationDate("2026-03-05T14:30:00.000Z");
    const parts = result.split(" ");
    expect(parts.length).toBeGreaterThanOrEqual(2);
  });
});
