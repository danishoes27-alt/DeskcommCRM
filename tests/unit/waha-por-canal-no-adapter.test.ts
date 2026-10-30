/**
 * O ADAPTADOR DO WHATSAPP FALA COM O WAHA DE CADA CANAL.
 *
 * O resolvedor ("canal -> WAHA") é testado em `lib/channels/waha-endpoint.test.ts`. Aqui se prova o que o
 * adaptador FAZ com a resposta dele: duas empresas, dois WAHAs; cadastro quebrado vira "fila com motivo"
 * (ou, no que é enfeite, silêncio) e nunca cai no WAHA de outra empresa; a mídia baixa do WAHA do canal.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EnderecoDoWaha } from "@/lib/channels/waha-endpoint";

const mundo = vi.hoisted(() => ({
  clientes: new Map<string, Record<string, unknown>>(),
  enderecos: new Map<string, { baseUrl: string; apiKey: string; origem: "canal" | "ambiente" }>(),
  quebrados: new Set<string>(),
  perguntou: [] as string[],
}));

vi.mock("@/lib/channels/waha-endpoint-app", async () => {
  const { WahaDoCanalError } = await import("@/lib/channels/waha-endpoint");
  const checar = (ref: string) => {
    mundo.perguntou.push(ref);
    if (mundo.quebrados.has(ref)) throw new WahaDoCanalError("chave_ilegivel", "a chave deste canal não pôde ser lida.");
  };
  return {
    clienteDoWahaDaSessao: async (ref: string) => {
      checar(ref);
      return mundo.clientes.get(ref) ?? null;
    },
    enderecoDoWahaDaSessao: async (ref: string) => {
      checar(ref);
      return mundo.enderecos.get(ref) ?? null;
    },
  };
});

vi.mock("@/lib/messaging/media/waha-source", () => ({
  fetchWahaMedia: vi.fn(async () => ({ buffer: Buffer.alloc(1), mime: "image/png" })),
}));

import { getAdapter } from "@/lib/channels";
import { fetchWahaMedia } from "@/lib/messaging/media/waha-source";

const ORG = "20000000-0000-4000-8000-000000000001";
const adaptador = () => getAdapter("waha");

function clienteDe(nome: string) {
  return {
    nome,
    sendMessage: vi.fn(async () => ({ id: `ID_${nome}` })),
    setPresence: vi.fn(async () => undefined),
    listarGrupos: vi.fn(async () => [{ chatId: "1@g.us", subject: nome }]),
    getProfilePictureUrl: vi.fn(async () => `https://foto/${nome}`),
  };
}

beforeEach(() => {
  mundo.clientes.clear();
  mundo.enderecos.clear();
  mundo.quebrados.clear();
  mundo.perguntou.length = 0;
  vi.mocked(fetchWahaMedia).mockClear();
});

describe("duas empresas, dois WAHAs", () => {
  it("cada envio sai pelo cliente do WAHA do PRÓPRIO canal", async () => {
    const acme = clienteDe("acme");
    const beta = clienteDe("beta");
    mundo.clientes.set("org_acme", acme);
    mundo.clientes.set("org_beta", beta);

    const a = await adaptador().send({ organizationId: ORG, sessionRef: "org_acme", to: "595@c.us", kind: "text", body: "oi A" });
    const b = await adaptador().send({ organizationId: ORG, sessionRef: "org_beta", to: "595@c.us", kind: "text", body: "oi B" });

    expect(acme.sendMessage).toHaveBeenCalledTimes(1);
    expect(beta.sendMessage).toHaveBeenCalledTimes(1);
    expect(acme.sendMessage).toHaveBeenCalledWith("org_acme", "595@c.us", "oi A", null);
    expect(beta.sendMessage).toHaveBeenCalledWith("org_beta", "595@c.us", "oi B", null);
    expect(a.externalId).toBe("ID_acme");
    expect(b.externalId).toBe("ID_beta");
  });

  it("o indicador de digitando, a foto de perfil e a lista de grupos também vão pelo WAHA do canal", async () => {
    const acme = clienteDe("acme");
    const beta = clienteDe("beta");
    mundo.clientes.set("org_acme", acme);
    mundo.clientes.set("org_beta", beta);

    await adaptador().signalTyping!({ organizationId: ORG, sessionRef: "org_beta", recipient: "595@c.us" });
    await expect(adaptador().fetchProfilePictureUrl!({ organizationId: ORG, sessionRef: "org_acme", recipient: "595@c.us" })).resolves.toBe("https://foto/acme");
    await expect(adaptador().listGroups!({ sessionRef: "org_beta" })).resolves.toEqual([{ chatId: "1@g.us", subject: "beta" }]);

    expect(beta.setPresence).toHaveBeenCalledTimes(1);
    expect(acme.setPresence).not.toHaveBeenCalled();
    expect(acme.listarGrupos).not.toHaveBeenCalled();
  });

  it("a mídia recebida é baixada do WAHA do canal (endereço e chave dele, não os do ambiente)", async () => {
    const endereco: EnderecoDoWaha = { baseUrl: "http://waha-beta:3000", apiKey: "chave-beta", origem: "canal" };
    mundo.enderecos.set("org_beta", endereco);

    await adaptador().fetchInboundMedia!({ organizationId: ORG, sessionRef: "org_beta", url: "http://localhost:3000/api/files/x.jpg", hintMime: "image/jpeg" });

    expect(fetchWahaMedia).toHaveBeenCalledWith("http://localhost:3000/api/files/x.jpg", "image/jpeg", endereco);
  });
});

describe("canal sem WAHA algum", () => {
  it("send LANÇA waha_not_configured (o handler transforma em fila) — não devolve externalId nulo", async () => {
    await expect(
      adaptador().send({ organizationId: ORG, sessionRef: "org_vazio", to: "595@c.us", kind: "text", body: "oi" }),
    ).rejects.toThrow(/^waha_not_configured/);
  });

  it("isConfiguredForSession é false; o enfeite vira no-op; o que não pode seguir lança", async () => {
    await expect(adaptador().isConfiguredForSession!("org_vazio")).resolves.toBe(false);
    await expect(adaptador().signalTyping!({ organizationId: ORG, sessionRef: "org_vazio", recipient: "595@c.us" })).resolves.toBeUndefined();
    await expect(adaptador().fetchProfilePictureUrl!({ organizationId: ORG, sessionRef: "org_vazio", recipient: "595@c.us" })).resolves.toBeNull();
    await expect(adaptador().listGroups!({ sessionRef: "org_vazio" })).rejects.toThrow(/^waha_not_configured/);
    await expect(
      adaptador().fetchInboundMedia!({ organizationId: ORG, sessionRef: "org_vazio", url: "http://x/y.jpg" }),
    ).rejects.toThrow(/^waha_not_configured/);
  });

  it("checkHealth diz que o transporte não está configurado", async () => {
    await expect(adaptador().checkHealth!({ organizationId: ORG, sessionRef: "org_vazio" })).resolves.toEqual({
      reachable: false,
      status: null,
      detail: "transporte_nao_configurado",
    });
  });
});

describe("canal com o cadastro do WAHA QUEBRADO", () => {
  const outra = () => {
    // Uma OUTRA empresa saudável, com o seu WAHA: serve de isca para provar que nada cai nele.
    const isca = clienteDe("isca");
    mundo.clientes.set("org_isca", isca);
    return isca;
  };

  it("send lança waha_not_configured com o código da falha, sem tocar em nenhum outro WAHA", async () => {
    const isca = outra();
    mundo.quebrados.add("org_quebrada");
    await expect(
      adaptador().send({ organizationId: ORG, sessionRef: "org_quebrada", to: "595@c.us", kind: "text", body: "oi" }),
    ).rejects.toThrow(/^waha_not_configured: waha_do_canal_chave_ilegivel/);
    expect(isca.sendMessage).not.toHaveBeenCalled();
    expect(mundo.perguntou).toEqual(["org_quebrada"]);
  });

  it("isConfiguredForSession é false", async () => {
    mundo.quebrados.add("org_quebrada");
    await expect(adaptador().isConfiguredForSession!("org_quebrada")).resolves.toBe(false);
  });

  it("o enfeite vira no-op (nada de erro na tela por causa de 'digitando')", async () => {
    mundo.quebrados.add("org_quebrada");
    await expect(adaptador().signalTyping!({ organizationId: ORG, sessionRef: "org_quebrada", recipient: "595@c.us" })).resolves.toBeUndefined();
    await expect(adaptador().resolvePhoneForIdentity!({ organizationId: ORG, sessionRef: "org_quebrada", identity: "lid:123" })).resolves.toBeNull();
  });

  it("a saúde do canal diz que o problema é o CADASTRO, não a rede", async () => {
    mundo.quebrados.add("org_quebrada");
    await expect(adaptador().checkHealth!({ organizationId: ORG, sessionRef: "org_quebrada" })).resolves.toEqual({
      reachable: false,
      status: null,
      detail: "waha_do_canal_chave_ilegivel",
    });
  });

  it("mídia, edição e grupos recusam em vez de usar outro WAHA", async () => {
    mundo.quebrados.add("org_quebrada");
    await expect(adaptador().fetchInboundMedia!({ organizationId: ORG, sessionRef: "org_quebrada", url: "http://x/y.jpg" })).rejects.toThrow(/^waha_not_configured/);
    await expect(
      adaptador().editMessage!({ organizationId: ORG, sessionRef: "org_quebrada", recipient: "595@c.us", externalId: "true_595@c.us_ABC", text: "novo" }),
    ).rejects.toThrow(/^waha_not_configured/);
    await expect(adaptador().listGroups!({ sessionRef: "org_quebrada" })).rejects.toThrow(/^waha_not_configured/);
    expect(fetchWahaMedia).not.toHaveBeenCalled();
  });
});
