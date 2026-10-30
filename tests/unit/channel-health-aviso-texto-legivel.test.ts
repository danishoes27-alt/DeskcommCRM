/**
 * O aviso de conexão que chega à Central não pode falar de variável de ambiente nem mostrar código de erro cru.
 *
 * Quem lê é o dono do negócio. Com o WhatsApp por empresa, "o servidor recusou a chave" é de UMA empresa (não de
 * todas as conexões da instalação), e o código do cadastro quebrado (`waha_do_canal_chave_ilegivel`) é de log.
 */
import { describe, expect, it } from "vitest";

import { avisoDaConexao, DETALHE_CREDENCIAL_RECUSADA } from "@/lib/channels/health";

describe("avisoDaConexao — texto de quem vende", () => {
  it("chave recusada: sem nome de variável, sem 'NENHUMA conexão', e manda falar com o suporte", () => {
    const a = avisoDaConexao({ reachable: false, status: null, detail: DETALHE_CREDENCIAL_RECUSADA }, "Vendas");
    expect(a?.body).toMatch(/fale com o suporte/i);
    expect(a?.body).not.toMatch(/WAHA_API_KEY|\.env|NENHUMA/);
  });

  it.each([
    "waha_do_canal_chave_ilegivel: a chave cadastrada não pôde ser lida.",
    "waha_do_canal_endereco_invalido: o endereço não é uma URL válida.",
    "waha_do_canal_consulta_falhou: não consegui consultar o cadastro.",
    "transporte_nao_configurado",
    "waha_not_configured",
  ])("⭐ o código de cadastro quebrado (%s) vira uma frase, não aparece cru", (detalhe) => {
    const a = avisoDaConexao({ reachable: false, status: null, detail: detalhe }, "Vendas");
    expect(a?.severity).toBe("warn");
    expect(a?.body).toBe("O cadastro do WhatsApp desta empresa está incompleto ou com problema. Fale com o suporte.");
  });

  it("outros detalhes (rede) seguem como vinham — o aviso não inventa o que não sabe", () => {
    const a = avisoDaConexao({ reachable: false, status: null, detail: "ECONNREFUSED" }, "Vendas");
    expect(a?.body).toBe("ECONNREFUSED");
    expect(avisoDaConexao({ reachable: false, status: null, detail: null }, "Vendas")?.body).toBeNull();
  });
});
