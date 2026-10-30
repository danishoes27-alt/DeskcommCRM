"use client";

/**
 * O WhatsApp de UMA empresa, do ponto de vista do operador da plataforma.
 *
 * O lojista só escaneia o QR e vê o estado; quem diz com qual servidor de WhatsApp a empresa fala é o
 * operador, aqui. Linguagem simples, e a chave de acesso é SÓ de escrita: depois de salva a tela mostra apenas
 * "cadastrada" — o valor nunca volta ao navegador.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";
import { ApiError } from "@/lib/api/types";
import { lerEstadoDoCanal } from "@/lib/channels/estado";

interface CanalDoOperador {
  id: string;
  nome: string;
  status: string;
  transporte_proprio: boolean;
}

interface EstadoDoWhatsapp {
  cadastrado: boolean;
  endereco: string | null;
  tem_chave: boolean;
  webhook_base_configurada: boolean;
  tem_transporte_global: boolean;
  canais: CanalDoOperador[];
  canais_com_falha: number;
}

type ResultadoDoTeste = { ok: true; versao: string | null; motor: string | null } | { ok: false; motivo: string };

interface ChaveGerada {
  chave: string;
  hash_sha512: string;
  kit: string;
}

export function TenantWhatsappClient({ id }: { id: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  const chave = ["admin", "tenant", id, "whatsapp"] as const;

  const estado = useQuery({
    queryKey: chave,
    queryFn: async () => (await apiClient.get<{ data: EstadoDoWhatsapp }>(`/api/v1/admin/tenants/${id}/whatsapp`)).data,
    staleTime: 15_000,
  });

  const [endereco, setEndereco] = useState<string | null>(null);
  const [chaveDigitada, setChaveDigitada] = useState("");
  const [teste, setTeste] = useState<ResultadoDoTeste | null>(null);
  const [gerada, setGerada] = useState<ChaveGerada | null>(null);

  const enderecoNoCampo = endereco ?? estado.data?.endereco ?? "";

  const aviso = (err: unknown, padrao: string) => toast.error(err instanceof ApiError && err.message ? t(err.message) : t(padrao));

  const testar = useMutation({
    mutationFn: async () =>
      (await apiClient.post<{ data: ResultadoDoTeste }>(`/api/v1/admin/tenants/${id}/whatsapp`, {
        acao: "testar",
        base_url: enderecoNoCampo,
        ...(chaveDigitada ? { api_key: chaveDigitada } : {}),
      })).data,
    onSuccess: setTeste,
    onError: (err) => aviso(err, "Não foi possível testar a conexão."),
  });

  const salvar = useMutation({
    mutationFn: async (atualizarCanais: boolean) =>
      (await apiClient.post<{ data: EstadoDoWhatsapp & { canais_atualizados: number } }>(`/api/v1/admin/tenants/${id}/whatsapp`, {
        acao: "cadastrar",
        base_url: enderecoNoCampo,
        ...(chaveDigitada ? { api_key: chaveDigitada } : {}),
        atualizar_canais: atualizarCanais,
      })).data,
    onSuccess: () => {
      setChaveDigitada("");
      setEndereco(null);
      setTeste(null);
      toast.success(t("Cadastro salvo."));
      void queryClient.invalidateQueries({ queryKey: chave });
    },
    onError: (err) => aviso(err, "Não foi possível salvar o cadastro."),
  });

  const reaplicar = useMutation({
    mutationFn: async () =>
      (await apiClient.post<{ data: { canais: Array<{ resultado: string }> } }>(`/api/v1/admin/tenants/${id}/whatsapp`, { acao: "reaplicar_webhook" })).data,
    onSuccess: (d) => {
      const falhas = d.canais.filter((c) => c.resultado === "falhou").length;
      if (falhas > 0) toast.error(t("O aviso de mensagens não foi reaplicado em alguns canais. Confira a conexão com o servidor."));
      else toast.success(t("Aviso de mensagens conferido em todos os canais."));
      void queryClient.invalidateQueries({ queryKey: chave });
    },
    onError: (err) => aviso(err, "Não foi possível reaplicar o aviso de mensagens."),
  });

  const gerar = useMutation({
    mutationFn: async () =>
      (await apiClient.post<{ data: ChaveGerada }>(`/api/v1/admin/tenants/${id}/whatsapp`, { acao: "gerar_chave" })).data,
    onSuccess: setGerada,
    onError: (err) => aviso(err, "Não foi possível gerar a chave."),
  });

  if (estado.isLoading) return <Skeleton className="h-64 rounded-xl" />;
  if (estado.isError || !estado.data) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-10 text-center text-sm text-destructive">
        {t("Não foi possível carregar o WhatsApp desta empresa. Tente recarregar a página.")}
      </div>
    );
  }
  const e = estado.data;
  const podeSalvar = enderecoNoCampo.trim() !== "" && (chaveDigitada.trim() !== "" || e.tem_chave);

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t("WhatsApp desta empresa")}</h2>
          <Badge variant={e.cadastrado ? "success" : "warning"}>{e.cadastrado ? t("Cadastrado") : t("Falta cadastrar")}</Badge>
        </div>
        {!e.cadastrado && (
          <p className="text-sm text-muted-foreground">
            {t("Falta cadastrar o WhatsApp desta empresa. Enquanto isso, o lojista vê “Estamos preparando o seu WhatsApp”.")}
          </p>
        )}
        {!e.webhook_base_configurada && (
          <p className="text-sm text-warning-fg">
            {t("A URL pública do aviso de mensagens não está configurada neste servidor: sem ela, um número não consegue ser conectado.")}
          </p>
        )}
      </section>

      <section className="space-y-4 rounded-lg border p-4">
        <div className="space-y-1.5">
          <Label htmlFor="whatsapp-endereco">{t("Endereço do WhatsApp desta empresa")}</Label>
          <Input
            id="whatsapp-endereco"
            value={enderecoNoCampo}
            onChange={(ev) => setEndereco(ev.target.value)}
            placeholder="http://nome-do-servico:3000"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="whatsapp-chave">{t("Chave de acesso")}</Label>
          <Input
            id="whatsapp-chave"
            type="password"
            value={chaveDigitada}
            onChange={(ev) => setChaveDigitada(ev.target.value)}
            placeholder={e.tem_chave ? "•••••••• " + t("cadastrada") : ""}
            autoComplete="new-password"
          />
          <p className="text-xs text-muted-foreground">
            {e.tem_chave ? t("Deixe em branco para manter a chave que já está cadastrada.") : t("A chave não volta a ser mostrada depois de salva.")}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={enderecoNoCampo.trim() === "" || testar.isPending} onClick={() => testar.mutate()}>
            {t("Testar conexão")}
          </Button>
          <Button disabled={!podeSalvar || salvar.isPending} onClick={() => salvar.mutate(false)}>
            {t("Salvar cadastro")}
          </Button>
          {e.canais.length > 0 && (
            <Button variant="outline" disabled={!podeSalvar || salvar.isPending} onClick={() => salvar.mutate(true)}>
              {t("Salvar e atualizar os canais que já usam este servidor")}
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {t("Números já conectados em outro servidor continuam nele. Para mudá-los, conecte o número de novo.")}
        </p>

        {teste && (
          <p className={teste.ok ? "text-sm text-success-fg" : "text-sm text-error-fg"} role="status">
            {teste.ok
              ? `${t("Conexão funcionando.")}${teste.versao ? ` ${t("Versão")} ${teste.versao}.` : ""}`
              : t(teste.motivo)}
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{t("Canais desta empresa")}</h3>
        {e.canais.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("Nenhum número conectado ainda.")}</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {e.canais.map((c) => {
              const estadoDoCanal = lerEstadoDoCanal(c.status);
              return (
                <li key={c.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                  <span>{c.nome}</span>
                  <Badge variant={estadoDoCanal.tom}>{t(estadoDoCanal.rotulo)}</Badge>
                </li>
              );
            })}
          </ul>
        )}
        {e.canais_com_falha > 0 && (
          <p className="text-sm text-error-fg">{t("Há canais caídos nesta empresa. Confira o servidor do WhatsApp dela.")}</p>
        )}
        <div>
          <Button variant="outline" disabled={reaplicar.isPending || e.canais.length === 0} onClick={() => reaplicar.mutate()}>
            {t("Reaplicar aviso de mensagens")}
          </Button>
        </div>
      </section>

      <section className="space-y-3 rounded-lg border p-4">
        <h3 className="text-sm font-semibold">{t("Criar o servidor desta empresa")}</h3>
        <p className="text-sm text-muted-foreground">
          {t("Gere uma chave nova, crie o serviço com os valores abaixo e depois cole a chave aqui. A chave aparece uma única vez.")}
        </p>
        <Button variant="secondary" disabled={gerar.isPending} onClick={() => gerar.mutate()}>
          {t("Gerar chave nova")}
        </Button>
        {gerada && (
          <div className="space-y-2 text-sm">
            <div>
              <div className="font-medium">{t("Chave (cole no cadastro acima)")}</div>
              <code className="block break-all rounded-md bg-muted px-2 py-1">{gerada.chave}</code>
            </div>
            <div>
              <div className="font-medium">{t("Valor da variável de acesso no serviço")}</div>
              <code className="block break-all rounded-md bg-muted px-2 py-1">sha512:{gerada.hash_sha512}</code>
            </div>
            <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">{gerada.kit}</pre>
          </div>
        )}
      </section>
    </div>
  );
}
