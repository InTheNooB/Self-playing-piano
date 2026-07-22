import { describe, expect, it, vi } from "vitest";
import type { MqttPublisher } from "@spp/infrastructure";
import { deliverCommand } from "./command-delivery";

const publisher = (overrides: Partial<MqttPublisher> = {}): MqttPublisher => ({
  connect: vi.fn().mockResolvedValue(undefined),
  publish: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  ...overrides,
});

const callbacks = () => ({
  onDefiniteFailure: vi.fn().mockResolvedValue(undefined),
  onUncertain: vi.fn().mockResolvedValue(undefined),
  onPublished: vi.fn().mockResolvedValue(undefined),
});

describe("deliverCommand", () => {
  it("treats connection failure as definitely not published", async () => {
    const target = publisher({ connect: vi.fn().mockRejectedValue(new Error("offline")) });
    const handlers = callbacks();
    expect(await deliverCommand({ publisher: target, topic: "desired", payload: "{}", ...handlers })).toBe("failed");
    expect(handlers.onDefiniteFailure).toHaveBeenCalledWith("offline");
    expect(target.publish).not.toHaveBeenCalled();
  });

  it("keeps an ambiguous publish locked", async () => {
    const target = publisher({ publish: vi.fn().mockRejectedValue(new Error("puback timeout")) });
    const handlers = callbacks();
    expect(await deliverCommand({ publisher: target, topic: "desired", payload: "{}", ...handlers })).toBe("uncertain");
    expect(handlers.onUncertain).toHaveBeenCalledWith("puback timeout");
    expect(handlers.onDefiniteFailure).not.toHaveBeenCalled();
  });

  it("stays confirmed when only audit metadata fails", async () => {
    const handlers = callbacks();
    handlers.onPublished.mockRejectedValue(new Error("database unavailable"));
    expect(await deliverCommand({ publisher: publisher(), topic: "desired", payload: "{}", ...handlers })).toBe("confirmed");
    expect(handlers.onDefiniteFailure).not.toHaveBeenCalled();
  });
});
