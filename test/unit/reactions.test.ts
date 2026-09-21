import { describe, expect, it } from "vitest";
import type { MessageReaction } from "discord.js";
import {
  clearReactionEmoji,
  clearReactions,
  formatReactionSummary,
  reactionToken,
  recordReactionAdd,
  recordReactionRemove,
} from "../../src/discord/reactions.js";

const fakeReaction = (emoji: {
  id: string | null;
  name: string | null;
  animated?: boolean | null;
}): MessageReaction => ({ emoji }) as unknown as MessageReaction;

const nameOf = (id: string): string =>
  ({ u1: "리디", u2: "시후", u3: "친구" })[id] ?? id;

describe("reaction tracker", () => {
  it("builds tokens for static, animated and unicode emoji", () => {
    expect(reactionToken(fakeReaction({ id: "1", name: "cat", animated: false }))).toBe(
      "<:cat:1>",
    );
    expect(reactionToken(fakeReaction({ id: "2", name: "dance", animated: true }))).toBe(
      "<a:dance:2>",
    );
    expect(reactionToken(fakeReaction({ id: null, name: "😊" }))).toBe("😊");
  });

  it("collects reactions with counts and names", () => {
    recordReactionAdd("m-collect", "😊", "u1");
    recordReactionAdd("m-collect", "😊", "u2");
    recordReactionAdd("m-collect", "<:cat:1>", "u3");
    expect(formatReactionSummary("m-collect", nameOf)).toBe(
      "😊×2 (리디, 시후) <:cat:1>×1 (친구)",
    );
    clearReactions("m-collect");
  });

  it("ignores duplicate adds and handles removals", () => {
    recordReactionAdd("m-remove", "🔥", "u1");
    recordReactionAdd("m-remove", "🔥", "u1");
    expect(formatReactionSummary("m-remove", nameOf)).toBe("🔥×1 (리디)");
    recordReactionRemove("m-remove", "🔥", "u1");
    expect(formatReactionSummary("m-remove", nameOf)).toBeUndefined();
  });

  it("clears a single emoji", () => {
    recordReactionAdd("m-emoji", "😊", "u1");
    recordReactionAdd("m-emoji", "🔥", "u1");
    clearReactionEmoji("m-emoji", "😊");
    expect(formatReactionSummary("m-emoji", nameOf)).toBe("🔥×1 (리디)");
    clearReactions("m-emoji");
  });

  it("returns undefined for unknown messages", () => {
    expect(formatReactionSummary("m-unknown", nameOf)).toBeUndefined();
  });
});
