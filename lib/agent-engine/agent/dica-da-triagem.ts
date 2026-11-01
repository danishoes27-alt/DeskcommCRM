/**
 * A DICA DE UMA LINHA PARA A IA — o que a triagem do "antes" entrega ao prompt
 * (`docs/14-spec-jev.md`, seções 2 e 3.2, ambiguidade 3).
 *
 * Só em `decidindo`, e só com confiança ALTA (`destinoEfetivo`): "categoria: conserto; destino:
 * atender" ou "peça primeiro o dado que falta". Em `observando`, com confiança média ou baixa,
 * ou quando o Jev não respondeu, o prompt fica EXATAMENTE como hoje — devolve `''`, e o bloco
 * é omitido da lista de sufixos do turno.
 *
 * O destino `equipe` não vira dica: ele abre um aviso na Central (T20) e a IA segue atendendo.
 * A dica é uma ajuda, nunca uma ordem que sobreponha o prompt da loja, e traz só o rótulo da
 * categoria — nunca texto do cliente.
 */
import type { CategoriaDaTriagem } from "@/lib/ai/decisao/categorias";

import type { TriagemDoTurno } from "./triagem-no-turno";

export function dicaDaTriagem(t: TriagemDoTurno | undefined): string {
  if (t === undefined || t.estado !== "decidindo") return "";
  const { veredito, categorias } = t;
  if (veredito.destinoEfetivo === "pedir_dado") {
    return "Dica da triagem: peça primeiro o dado que falta para atender (por exemplo, qual aparelho ou serviço).";
  }
  if (veredito.destinoEfetivo === "atender" && veredito.categoria.faixa === "alta") {
    const rotulo = rotuloDa(categorias, veredito.categoria.id);
    return `Dica da triagem: categoria: ${rotulo}; destino: atender.`;
  }
  return "";
}

function rotuloDa(categorias: readonly CategoriaDaTriagem[], id: string): string {
  return (categorias.find((c) => c.id === id)?.rotulo ?? id).toLowerCase();
}
