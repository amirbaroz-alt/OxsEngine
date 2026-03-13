import {
  formatPhoneDisplay,
  formatPhone,
  formatDate,
  formatTime,
} from "../../client/src/lib/format-utils";

describe("formatPhoneDisplay", () => {
  it("should format Israeli mobile number with 972 prefix", () => {
    expect(formatPhoneDisplay("972585020130")).toBe("058-5020130");
  });

  it("should format Israeli mobile with + prefix", () => {
    expect(formatPhoneDisplay("+972585020130")).toBe("058-5020130");
  });

  it("should format local 10-digit Israeli number", () => {
    expect(formatPhoneDisplay("0585020130")).toBe("058-5020130");
  });

  it("should return original for 11-digit number outside 12-13 digit range", () => {
    expect(formatPhoneDisplay("97235020570")).toBe("97235020570");
  });

  it("should return original for short numbers", () => {
    expect(formatPhoneDisplay("12345")).toBe("12345");
  });

  it("should return empty string for empty input", () => {
    expect(formatPhoneDisplay("")).toBe("");
  });

  it("should handle number with dashes", () => {
    expect(formatPhoneDisplay("058-5020130")).toBe("058-5020130");
  });

  it("should handle number with spaces", () => {
    expect(formatPhoneDisplay("058 5020130")).toBe("058-5020130");
  });

  it("should return original for international non-Israeli numbers", () => {
    expect(formatPhoneDisplay("+14155551234")).toBe("+14155551234");
  });

  it("should return original for 13-digit number with extra zero after 972", () => {
    expect(formatPhoneDisplay("9720585020130")).toBe("9720585020130");
  });

  it("should format 12-digit Israeli mobile (standard 972 prefix)", () => {
    expect(formatPhoneDisplay("972585020130")).toBe("058-5020130");
  });
});

describe("formatPhone", () => {
  it("should add dash to 10-digit number", () => {
    expect(formatPhone("0585020130")).toBe("058-5020130");
  });

  it("should handle number already containing dashes", () => {
    expect(formatPhone("058-5020130")).toBe("058-5020130");
  });

  it("should handle number with spaces", () => {
    expect(formatPhone("058 5020130")).toBe("058-5020130");
  });

  it("should return original for non-10-digit numbers", () => {
    expect(formatPhone("123")).toBe("123");
  });
});

describe("formatDate", () => {
  it("should format date in Hebrew locale", () => {
    const result = formatDate("2025-06-15T10:30:00Z", "he");
    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(5);
  });

  it("should format date in English locale", () => {
    const result = formatDate("2025-06-15T10:30:00Z", "en");
    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
  });

  it("should format date in Arabic locale", () => {
    const result = formatDate("2025-06-15T10:30:00Z", "ar");
    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
  });

  it("should return original string for invalid date", () => {
    expect(formatDate("not-a-date", "he")).toBeTruthy();
  });

  it("should default to Hebrew for unknown language", () => {
    const result = formatDate("2025-06-15T10:30:00Z", "xx");
    expect(result).toBeTruthy();
  });
});

describe("formatTime", () => {
  it("should return time for today's date", () => {
    const now = new Date();
    const result = formatTime(now.toISOString());
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });

  it("should return 'Yesterday' for yesterday's date", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const result = formatTime(yesterday.toISOString());
    expect(result).toBe("Yesterday");
  });

  it("should return weekday name for dates within last 7 days", () => {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const result = formatTime(threeDaysAgo.toISOString());
    expect(result).toBeTruthy();
    expect(result).not.toMatch(/^\d{2}:\d{2}$/);
    expect(result).not.toBe("Yesterday");
  });

  it("should return date format for older dates", () => {
    const oldDate = new Date("2024-01-15T10:00:00Z");
    const result = formatTime(oldDate.toISOString());
    expect(result).toMatch(/\d{2}\/\d{2}/);
  });
});
