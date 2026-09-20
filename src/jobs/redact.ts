import type { Db } from "../db/index.js";
import { containsSecretData } from "../safety/filters.js";
import { deleteMessagesByIds, selfMessageIdsWithContent } from "../db/queries.js";

export const purgeSecretMessages = (db: Db, scanLimit = 10000): number => {
  const rows = selfMessageIdsWithContent(db, scanLimit);
  const ids = rows.filter((row) => containsSecretData(row.content)).map((row) => row.id);
  return deleteMessagesByIds(db, ids);
};
