import { beforeEach, describe, expect, it, vi } from "vitest";

const exigir = vi.fn();
const gravar = vi.fn();
const auditar = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/requirePlatformAdmin", () => ({ requirePlatformAdmin: () => exigir() }));
vi.mock("@/lib/audit", () => ({ audit: (a: unknown) => auditar(a) }));
vi.mock("@/lib/instalacao/config", () => ({
  gravarPelaTela: (...a: unknown[]) => gravar(...a),
  voltarAoAmbiente: vi.fn(),
  estadoParaTela: vi.fn().mockResolvedValue({ chave: "COTACAO_USD_BRL" }),
}));

import { salvarConfiguracaoDaInstalacao } from "./salvarConfiguracaoDaInstalacao";

beforeEach(() => {
  vi.clearAllMocks();
  exigir.mockResolvedValue({ user: { id: "dono" } });
  gravar.mockResolvedValue({ ok: true });
});

describe("a cotação do dólar na configuração da plataforma (T23)", () => {
  it("o administrador da plataforma grava, normalizada, e a auditoria leva o valor", async () => {
    const r = await salvarConfiguracaoDaInstalacao("COTACAO_USD_BRL", " 5,42 ");
    expect(r.ok).toBe(true);
    expect(gravar).toHaveBeenCalledWith("COTACAO_USD_BRL", "5.42", expect.objectContaining({ ehSegredo: false }));
    expect(auditar).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "platform.config_changed",
        metadata: expect.objectContaining({ chave: "COTACAO_USD_BRL", valor: "5.42" }),
      }),
    );
  });

  it.each(["abc", "0", "-3", "900", "5 reais"])("recusa %s sem gravar", async (v) => {
    const r = await salvarConfiguracaoDaInstalacao("COTACAO_USD_BRL", v);
    expect(r.ok).toBe(false);
    expect(gravar).not.toHaveBeenCalled();
    expect(auditar).not.toHaveBeenCalled();
  });

  it("quem não é administrador da plataforma (o admin da loja) não altera: nada é gravado", async () => {
    exigir.mockRejectedValue(new Error("403"));
    await expect(salvarConfiguracaoDaInstalacao("COTACAO_USD_BRL", "5.40")).rejects.toThrow();
    expect(gravar).not.toHaveBeenCalled();
    expect(auditar).not.toHaveBeenCalled();
  });

  it("outras chaves não ganham o campo valor na auditoria", async () => {
    await salvarConfiguracaoDaInstalacao("SUPPORT_EMAIL", "a@b.co");
    const meta = auditar.mock.calls[0]![0].metadata;
    expect(meta.valor).toBeUndefined();
  });
});
