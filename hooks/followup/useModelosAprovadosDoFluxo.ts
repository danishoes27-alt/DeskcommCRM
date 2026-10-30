"use client";
import { useQuery } from "@tanstack/react-query";

import { apiClient } from "@/lib/api/client";
import type { ModeloAprovadoDoFluxo } from "@/lib/followup/modelos-aprovados";

type Resposta = { data: ModeloAprovadoDoFluxo[]; meta?: { exige_modelo?: boolean } };

const CHAVE = ["followup-modelos-aprovados"] as const;

function buscar() {
  return apiClient.get<Resposta>("/api/v1/ai/followup-flows/modelos-aprovados");
}

/**
 * Modelos aprovados do canal que um passo de fluxo consegue enviar sozinho — o
 * único envio que passa com a janela de 24 h fechada. Ver
 * `lib/followup/modelos-aprovados.ts` para o que entra na lista e por quê.
 */
export function useModelosAprovadosDoFluxo() {
  return useQuery({
    queryKey: CHAVE,
    queryFn: buscar,
    staleTime: 60_000,
    select: (res) => res.data,
  });
}

/**
 * Algum canal da empresa exige modelo fora da janela de 24 h?
 *
 * Quem só conecta número por QR manda texto livre a qualquer hora, e falar de "janela" e "modelo aprovado" para
 * ela é inventar um problema. Enquanto a resposta não chega, ou se vier sem o campo, vale `true`: mostrar o aviso
 * a mais custa menos que esconder de quem precisa dele.
 */
export function useAlgumCanalExigeModelo(): boolean {
  const { data } = useQuery({
    queryKey: CHAVE,
    queryFn: buscar,
    staleTime: 60_000,
    select: (res) => res.meta?.exige_modelo !== false,
  });
  return data ?? true;
}
