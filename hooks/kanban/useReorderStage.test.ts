import { describe, expect, it } from "vitest";

import { ordemDepoisDeMover } from "./useReorderStage";

describe("ordemDepoisDeMover", () => {
  const ids = ["a", "b", "c", "d"];
  it("manda para o começo quando não há vizinho à esquerda", () => {
    expect(ordemDepoisDeMover(ids, "c", null)).toEqual(["c", "a", "b", "d"]);
  });
  it("põe logo depois do vizinho indicado", () => {
    expect(ordemDepoisDeMover(ids, "a", "c")).toEqual(["b", "c", "a", "d"]);
    expect(ordemDepoisDeMover(ids, "d", "a")).toEqual(["a", "d", "b", "c"]);
  });
  it("não mexe quando o vizinho não existe", () => {
    expect(ordemDepoisDeMover(ids, "a", "zzz")).toEqual(ids);
  });
});
