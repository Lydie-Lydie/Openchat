export const ALIAS_MAX_LENGTH = 32;

export type AliasValidation =
  | { readonly ok: true; readonly alias: string }
  | { readonly ok: false; readonly reason: string };

const CONTROL_PATTERN = /[\u0000-\u001F\u007F]/gu;
const FORBIDDEN_PATTERN = /[<>@#`]/u;

export const normalizeAlias = (raw: string): AliasValidation => {
  const alias = raw.replace(CONTROL_PATTERN, "").replace(/\s+/gu, " ").trim();

  if (alias.length === 0) {
    return { ok: false, reason: "호칭이 비어 있습니다." };
  }
  if (alias.length > ALIAS_MAX_LENGTH) {
    return { ok: false, reason: `호칭은 ${ALIAS_MAX_LENGTH}자 이하여야 합니다.` };
  }
  if (FORBIDDEN_PATTERN.test(alias)) {
    return { ok: false, reason: "호칭에 <, >, @, #, ` 문자는 쓸 수 없습니다." };
  }
  return { ok: true, alias };
};
