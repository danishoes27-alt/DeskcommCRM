/**
 * Mensagem digitada por uma pessoa enquanto o WhatsApp estava fora do ar.
 *
 * Ela fica na fila (`queued`) e NÃO sai por conta própria: o reenvio automático é só de IA, automação e sistema.
 * Sem aviso, a bolha parecia enviada — um relógio parado, sem uma palavra. Aqui a tela diz, em português de
 * quem atende, que ela não foi enviada e por quê. Mensagem de IA/automação na fila NÃO ganha o aviso: essa sai
 * sozinha quando o número volta, e dizer "não enviada" seria mentir para o outro lado.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { MessageBubble } from "@/components/inbox/MessageBubble";
import type { Message } from "@/lib/types/messaging";

function msg(over: Partial<Message> = {}): Message {
  return {
    id: "m1",
    organization_id: "org1",
    conversation_id: "c1",
    channel_session_id: "s1",
    contact_id: "ct1",
    external_id: null,
    type: "text",
    direction: "outbound",
    status: "queued",
    ack: null,
    error_code: null,
    error_message: null,
    body: "oi, tudo bem?",
    media_url: null,
    media_mime: null,
    media_size_bytes: null,
    media_storage_path: null,
    sent_via: "user",
    sent_by_user_id: null,
    sent_at: "2026-09-08T12:00:00.000Z",
    delivered_at: null,
    read_at: null,
    metadata: { queued_reason: "channel_session_not_working" },
    edited_at: null,
    revoked_at: null,
    reply_to_message_id: null,
    created_at: "2026-09-08T12:00:00.000Z",
    ...over,
  };
}

const AVISO = "Não enviada: WhatsApp desconectado";

describe("aviso de 'não enviada' na bolha", () => {
  it("⭐ digitada por pessoa, na fila por queda: mostra 'Não enviada: WhatsApp desconectado'", () => {
    render(<MessageBubble message={msg()} />);
    expect(screen.getByText(AVISO)).toBeInTheDocument();
  });

  it("vale também para quem enviou pelo CRM (sent_via 'crm')", () => {
    render(<MessageBubble message={msg({ sent_via: "crm" })} />);
    expect(screen.getByText(AVISO)).toBeInTheDocument();
  });

  it("IA e automação na fila NÃO ganham o aviso — saem sozinhas quando o número volta", () => {
    for (const via of ["ai", "automation", "system"] as const) {
      const { unmount } = render(<MessageBubble message={msg({ sent_via: via })} />);
      expect(screen.queryByText(AVISO), via).toBeNull();
      unmount();
    }
  });

  it("mensagem já enviada não carrega o aviso, mesmo com o motivo antigo guardado", () => {
    render(<MessageBubble message={msg({ status: "sent", external_id: "ABC" })} />);
    expect(screen.queryByText(AVISO)).toBeNull();
  });

  it("na fila por outro motivo (sem `queued_reason`), nada é dito — só o que se sabe", () => {
    render(<MessageBubble message={msg({ metadata: {} })} />);
    expect(screen.queryByText(AVISO)).toBeNull();
  });

  it("mensagem recebida nunca ganha o aviso", () => {
    render(<MessageBubble message={msg({ direction: "inbound" })} />);
    expect(screen.queryByText(AVISO)).toBeNull();
  });
});
