import { describe, expect, it } from "vitest";
import { completedPosition, guardCommand } from "./command-guard";

describe("simulator command guard", () => {
  it("does not replay a retained revision after restart", () => {
    expect(guardCommand(7, 7, "2099-01-01T00:00:00.000Z")).toBe("duplicate");
  });

  it("rejects expired and malformed timestamps", () => {
    expect(guardCommand(7, 8, "2020-01-01T00:00:00.000Z")).toBe("expired");
    expect(guardCommand(7, 8, "not-a-date")).toBe("expired");
  });

  it("reports the duration at natural completion", () => {
    expect(completedPosition(12_345)).toBe(12_345);
  });
});
