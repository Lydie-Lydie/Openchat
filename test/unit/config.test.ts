import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";

const base = {
  DISCORD_TOKEN: "t",
  DISCORD_APP_ID: "app",
  SELF_USER_ID: "self",
};

describe("loadConfig", () => {
  it("defaults style guilds to the allowed guilds", () => {
    const config = loadConfig({ ...base, ALLOWED_GUILD_IDS: "g1,g2" });
    expect(config.discord.allowedGuildIds).toEqual(["g1", "g2"]);
    expect(config.discord.styleGuildIds).toEqual(["g1", "g2"]);
  });

  it("defaults allowed guilds to DISCORD_GUILD_ID", () => {
    const config = loadConfig({ ...base, DISCORD_GUILD_ID: "g0" });
    expect(config.discord.allowedGuildIds).toEqual(["g0"]);
    expect(config.discord.styleGuildIds).toEqual(["g0"]);
  });

  it("lets STYLE_GUILD_IDS override the style reference target", () => {
    const config = loadConfig({
      ...base,
      ALLOWED_GUILD_IDS: "g1,g2",
      STYLE_GUILD_IDS: "g2",
    });
    expect(config.discord.allowedGuildIds).toEqual(["g1", "g2"]);
    expect(config.discord.styleGuildIds).toEqual(["g2"]);
  });

  it("parses style channel scope", () => {
    const config = loadConfig({ ...base, STYLE_CHANNEL_IDS: "c1,c2" });
    expect(config.discord.styleChannelIds).toEqual(["c1", "c2"]);
    expect(loadConfig({ ...base }).discord.styleChannelIds).toEqual([]);
  });

  it("defaults search off and parses SEARCH_ENABLED", () => {
    expect(loadConfig({ ...base }).discord.searchEnabled).toBe(false);
    expect(loadConfig({ ...base, SEARCH_ENABLED: "true" }).discord.searchEnabled).toBe(
      true,
    );
  });

  it("defaults mention users to self plus admins", () => {
    const config = loadConfig({ ...base, ADMIN_USER_IDS: "a1,a2" });
    expect(config.discord.mentionAllowedUserIds).toEqual(["self", "a1", "a2"]);
  });
});
