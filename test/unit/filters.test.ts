import { describe, expect, it } from "vitest";
import {
  containsSensitiveData,
  isChatLike,
  isTooSimilar,
  similarity,
  validateOutgoing,
} from "../../src/safety/filters.js";

describe("filters", () => {
  it("detects sensitive patterns", () => {
    expect(containsSensitiveData("내 번호 010-1234-5678 이야")).toBe(true);
    expect(containsSensitiveData("주민번호 900101-1234567")).toBe(true);
    expect(containsSensitiveData("메일 a@b.com 으로 보내줘")).toBe(true);
    expect(containsSensitiveData("Account:x AccountPassword:y")).toBe(true);
    expect(containsSensitiveData("https://example.com/x")).toBe(true);
    expect(containsSensitiveData("오늘 날씨 좋다")).toBe(false);
  });

  it("detects chat-like messages", () => {
    expect(isChatLike("오늘 좀 피곤하네")).toBe(true);
    expect(isChatLike("안녕하세요")).toBe(true);
    expect(isChatLike("ㅇㅇ")).toBe(true);
    expect(isChatLike("그건 좀 애매한데 ㅋㅋ")).toBe(true);
    expect(isChatLike("지금 뭐해?")).toBe(true);
    expect(isChatLike("<@123456789012345678> 안녕 오늘 뭐 먹을래?")).toBe(true);
    expect(isChatLike("```code block```")).toBe(false);
    expect(isChatLike("https://example.com")).toBe(false);
    expect(isChatLike("Account:ivub AccountPassword:zau9")).toBe(false);
    expect(isChatLike("line one\nline two")).toBe(false);
    expect(isChatLike("abcdefghij")).toBe(false);
    expect(isChatLike("가".repeat(200))).toBe(false);
  });

  it("rejects paste-like and label-like text", () => {
    expect(isChatLike("의뢰를 보고 6명의 초보 모험가가 모였다...")).toBe(false);
    expect(isChatLike("실전! 파이토치 딥러닝 프로젝트")).toBe(false);
    expect(isChatLike("논문리뷰")).toBe(false);
    expect(isChatLike("코스프레를 즐기는")).toBe(false);
    expect(isChatLike("의사")).toBe(false);
    expect(
      isChatLike(
        "내가 지금 연구를 할때 내 직무를 루틴화하고 ai 스킬 등으로 만들어서 agent 구성하여 오토메이션하는걸 ai 활용경험으로 쓰는것이 매우 좋다",
      ),
    ).toBe(false);
    expect(
      isChatLike("{1 girl}, hatsune miku, nsfw, [artist:ningen_mame], explicit"),
    ).toBe(false);
  });

  it("scores identical text as 1", () => {
    expect(similarity("오늘 날씨 진짜 좋다", "오늘 날씨 진짜 좋다")).toBe(1);
  });

  it("scores unrelated text low", () => {
    expect(similarity("오늘 날씨 좋다", "내일 회의 준비하자")).toBeLessThan(0.2);
  });

  it("flags near duplicates", () => {
    const recent = ["오늘 날씨 진짜 좋더라"];
    expect(isTooSimilar("오늘 날씨 진짜 좋더라", recent)).toBe(true);
  });

  it("validates outgoing messages", () => {
    expect(validateOutgoing({ text: "안녕", maxLength: 100, recent: [] }).ok).toBe(true);
    expect(validateOutgoing({ text: "", maxLength: 100, recent: [] }).ok).toBe(false);
    expect(
      validateOutgoing({ text: "가".repeat(101), maxLength: 100, recent: [] }).ok,
    ).toBe(false);
    expect(
      validateOutgoing({ text: "010-1234-5678", maxLength: 100, recent: [] }).ok,
    ).toBe(false);
    expect(
      validateOutgoing({ text: "같은 말", maxLength: 100, recent: ["같은 말"] }).ok,
    ).toBe(false);
  });
});
