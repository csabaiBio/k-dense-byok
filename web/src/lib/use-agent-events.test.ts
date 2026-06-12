import { describe, expect, it } from "vitest";

import {
  applyAgentEventToMessage,
  sessionEventsToChatMessages,
  type ChatMessage,
} from "@/lib/use-agent";

const baseMessage = (): ChatMessage => ({
  id: "assistant",
  role: "assistant",
  content: "",
  timestamp: 1,
});

describe("applyAgentEventToMessage", () => {
  it("appends partial text and replaces final text", () => {
    const partial = applyAgentEventToMessage(
      baseMessage(),
      { partial: true, content: { parts: [{ text: "hel" }] } },
      () => "generated",
      10
    );

    expect(partial.content).toBe("hel");

    const final = applyAgentEventToMessage(
      partial,
      { partial: false, content: { parts: [{ text: "hello" }] } },
      () => "generated",
      11
    );

    expect(final.content).toBe("hello");
  });

  it("records turn id and model version from event metadata", () => {
    const next = applyAgentEventToMessage(
      baseMessage(),
      {
        modelVersion: "openrouter/example",
        actions: { stateDelta: { _turnId: "turn-123" } },
      },
      () => "generated",
      10
    );

    expect(next.modelVersion).toBe("openrouter/example");
    expect(next.turnId).toBe("turn-123");
  });

  it("pairs tool responses with running tool calls", () => {
    const running = applyAgentEventToMessage(
      baseMessage(),
      {
        content: {
          parts: [{ functionCall: { id: "tool-1", name: "delegate_task" } }],
        },
      },
      () => "generated",
      10
    );

    const complete = applyAgentEventToMessage(
      running,
      {
        content: {
          parts: [
            {
              functionResponse: {
                id: "tool-1",
                name: "delegate_task",
                response: { result: "done", skills_used: ["analysis"] },
              },
            },
          ],
        },
      },
      () => "generated",
      20
    );

    expect(complete.activities).toHaveLength(1);
    expect(complete.activities?.[0]).toMatchObject({
      id: "tool-1",
      label: "Specialist finished",
      status: "complete",
      detail: "Used 'analysis' skills",
    });
  });
});

describe("sessionEventsToChatMessages", () => {
  it("maps user and assistant text events into chat messages", () => {
    const messages = sessionEventsToChatMessages([
      {
        id: "u1",
        author: "user",
        timestamp: 1,
        content: { parts: [{ text: "Question" }] },
      },
      {
        id: "a1",
        author: "root_agent",
        timestamp: 2,
        modelVersion: "openrouter/example",
        actions: { stateDelta: { _turnId: "turn-1" } },
        content: { parts: [{ text: "Answer" }] },
      },
    ]);

    expect(messages).toEqual([
      {
        id: "u1",
        role: "user",
        content: "Question",
        timestamp: 1000,
        modelVersion: undefined,
        turnId: undefined,
      },
      {
        id: "a1",
        role: "assistant",
        content: "Answer",
        timestamp: 2000,
        modelVersion: "openrouter/example",
        turnId: "turn-1",
      },
    ]);
  });

  it("drops partial and empty-text events", () => {
    const messages = sessionEventsToChatMessages([
      {
        id: "p1",
        author: "root_agent",
        partial: true,
        timestamp: 1,
        content: { parts: [{ text: "partial" }] },
      },
      {
        id: "f1",
        author: "root_agent",
        timestamp: 2,
        content: { parts: [{ text: "" }] },
      },
      {
        id: "f2",
        author: "root_agent",
        timestamp: 3,
        content: { parts: [{ text: "final" }] },
      },
    ]);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ id: "f2", content: "final" });
  });
});
