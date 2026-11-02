"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import { chaveDoQuadro } from "./useBoard";
import type { BoardData } from "@/lib/kanban/types";

interface ReorderArgs {
  stageId: string;
  /** Vizinho da ESQUERDA depois da mudança (`null` = primeira coluna). */
  depoisDe: string | null;
}

/**
 * Arrastar uma coluna para outro lugar do quadro. É a mesma rota de Configurações ›
 * Funis (`PATCH .../stages/:stageId` com `depois_de`), só com outro gesto: quem
 * arrasta sabe onde a coluna caiu, não qual fração de `position` isso vira.
 *
 * Otimista, como `useRenameStage`: a coluna já aparece no lugar novo, e o
 * `onSettled` reconcilia com o servidor (que é quem recalcula a posição).
 */
export function ordemDepoisDeMover(ids: string[], stageId: string, depoisDe: string | null): string[] {
  const resto = ids.filter((id) => id !== stageId);
  const onde = depoisDe === null ? 0 : resto.indexOf(depoisDe) + 1;
  if (depoisDe !== null && onde === 0) return ids;
  resto.splice(onde, 0, stageId);
  return resto;
}

export function useReorderStage(pipelineId: string) {
  const qc = useQueryClient();
  const queryKey = chaveDoQuadro(pipelineId);

  return useMutation({
    mutationFn: ({ stageId, depoisDe }: ReorderArgs) =>
      apiClient.patch(`/api/v1/pipelines/${pipelineId}/stages/${stageId}`, { depois_de: depoisDe }),
    onMutate: async ({ stageId, depoisDe }) => {
      await qc.cancelQueries({ queryKey });
      const snapshot = qc.getQueryData<BoardData>(queryKey);
      if (snapshot) {
        const ordem = ordemDepoisDeMover(
          snapshot.stages.map((s) => s.id),
          stageId,
          depoisDe,
        );
        const porId = new Map(snapshot.stages.map((s) => [s.id, s]));
        qc.setQueryData<BoardData>(queryKey, {
          ...snapshot,
          stages: ordem.map((id) => porId.get(id)!),
        });
      }
      return { snapshot };
    },
    onError: (err, _args, ctx) => {
      if (ctx?.snapshot) qc.setQueryData(queryKey, ctx.snapshot);
      showApiError(err);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey });
    },
  });
}
