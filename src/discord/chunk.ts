export const DISCORD_MAX_LENGTH = 2000;

export const chunkMessage = (
  text: string,
  maxLength: number = DISCORD_MAX_LENGTH,
): string[] => {
  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.length <= maxLength) return [trimmed];

  const chunks: string[] = [];
  let remaining = trimmed;

  while (remaining.length > maxLength) {
    const window = remaining.slice(0, maxLength);
    const candidates = [
      window.lastIndexOf("\n\n"),
      window.lastIndexOf("\n"),
      window.lastIndexOf(". "),
      window.lastIndexOf(" "),
    ].filter((i) => i > maxLength * 0.5);

    const splitAt = candidates.length > 0 ? Math.max(...candidates) : maxLength;
    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
};
