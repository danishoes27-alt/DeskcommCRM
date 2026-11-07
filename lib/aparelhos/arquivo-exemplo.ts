/**
 * FIXTURE DE TESTE: 4 aparelhos REAIS copiados do aparelhos.json publicado (lidos em 2026-11-07, T0),
 * com os totais recalculados para o recorte. NÃO é o arquivo inteiro e NÃO é lido em produção.
 * Existe para os testes provarem que preço e parcelas saem idênticos ao formato real.
 */
export const ARQUIVO_EXEMPLO = {
  "geradoEm": "2026-11-07T19:25:17-03:00",
  "totalAparelhos": 4,
  "totalVariantes": 11,
  "nota": "Aparelho que não está nesta lista não está disponível no site.",
  "aparelhos": [
    {
      "id": "redmi-note-15",
      "categoria": "android",
      "marca": "Xiaomi",
      "nome": "Redmi Note 15",
      "condicao": "novo",
      "oferta": false,
      "variantes": [
        {
          "nome": "8 GB + 256 GB",
          "cor": "Azul Glacial",
          "preco": {
            "avista": "R$ 1.429",
            "parcelas": "até 18x no boleto"
          },
          "rede": "4G",
          "nfc": "Sim",
          "processador": "MediaTek Helio G100 Ultra",
          "ram": "8 GB",
          "armazenamento": "256 GB",
          "bateria": null,
          "observacao": null
        },
        {
          "nome": "8 GB + 256 GB",
          "cor": "Preto",
          "preco": {
            "avista": "R$ 1.429",
            "parcelas": "até 18x no boleto"
          },
          "rede": "4G",
          "nfc": "Não",
          "processador": "MediaTek Helio G100 Ultra",
          "ram": "8 GB",
          "armazenamento": "256 GB",
          "bateria": null,
          "observacao": null
        }
      ]
    },
    {
      "id": "iphone-16-lacrado",
      "categoria": "iphone",
      "marca": "Apple",
      "nome": "iPhone 16",
      "condicao": "novo",
      "oferta": false,
      "variantes": [
        {
          "nome": "128 GB",
          "cor": "Preto",
          "preco": {
            "avista": "R$ 4.730",
            "parcelas": "até 18x no boleto"
          },
          "rede": null,
          "nfc": null,
          "processador": null,
          "ram": null,
          "armazenamento": "128 GB",
          "bateria": null,
          "observacao": null
        },
        {
          "nome": "128 GB",
          "cor": "Branco",
          "preco": {
            "avista": "R$ 4.780",
            "parcelas": "até 18x no boleto"
          },
          "rede": null,
          "nfc": null,
          "processador": null,
          "ram": null,
          "armazenamento": "128 GB",
          "bateria": null,
          "observacao": null
        }
      ]
    },
    {
      "id": "iphone-16-seminovo",
      "categoria": "iphone",
      "marca": "Apple",
      "nome": "iPhone 16",
      "condicao": "seminovo",
      "oferta": false,
      "variantes": [
        {
          "nome": "128 GB",
          "cor": "Verde",
          "preco": {
            "avista": "R$ 3.800",
            "parcelas": "até 18x no boleto"
          },
          "rede": null,
          "nfc": null,
          "processador": null,
          "ram": null,
          "armazenamento": "128 GB",
          "bateria": "84%",
          "observacao": "Garantia Apple: +R$ 100,00"
        },
        {
          "nome": "128 GB",
          "cor": "Preto",
          "preco": {
            "avista": "R$ 3.800",
            "parcelas": "até 18x no boleto"
          },
          "rede": null,
          "nfc": null,
          "processador": null,
          "ram": null,
          "armazenamento": "128 GB",
          "bateria": "84%",
          "observacao": "Garantia Apple: +R$ 100,00"
        },
        {
          "nome": "128 GB",
          "cor": "Azul",
          "preco": {
            "avista": "R$ 3.800",
            "parcelas": "até 18x no boleto"
          },
          "rede": null,
          "nfc": null,
          "processador": null,
          "ram": null,
          "armazenamento": "128 GB",
          "bateria": "84%",
          "observacao": "Garantia Apple: +R$ 100,00"
        },
        {
          "nome": "128 GB",
          "cor": "Branco",
          "preco": {
            "avista": "R$ 3.850",
            "parcelas": "até 18x no boleto"
          },
          "rede": null,
          "nfc": null,
          "processador": null,
          "ram": null,
          "armazenamento": "128 GB",
          "bateria": "84%",
          "observacao": "Garantia Apple: +R$ 100,00"
        },
        {
          "nome": "128 GB",
          "cor": "Rosa",
          "preco": {
            "avista": "R$ 3.800",
            "parcelas": "até 18x no boleto"
          },
          "rede": null,
          "nfc": null,
          "processador": null,
          "ram": null,
          "armazenamento": "128 GB",
          "bateria": "84%",
          "observacao": "Garantia Apple: +R$ 100,00"
        }
      ]
    },
    {
      "id": "iphone-17e-lacrado",
      "categoria": "iphone",
      "marca": "Apple",
      "nome": "iPhone 17e",
      "condicao": "novo",
      "oferta": false,
      "variantes": [
        {
          "nome": "256 GB",
          "cor": "Branco",
          "preco": {
            "avista": "R$ 4.400",
            "parcelas": "até 18x no boleto"
          },
          "rede": null,
          "nfc": null,
          "processador": null,
          "ram": null,
          "armazenamento": "256 GB",
          "bateria": null,
          "observacao": null
        },
        {
          "nome": "256 GB",
          "cor": "Preto",
          "preco": {
            "avista": "R$ 4.400",
            "parcelas": "até 18x no boleto"
          },
          "rede": null,
          "nfc": null,
          "processador": null,
          "ram": null,
          "armazenamento": "256 GB",
          "bateria": null,
          "observacao": null
        }
      ]
    }
  ]
} as const;

/** Cópia profunda mutável, para os testes alterarem sem sujar o original. */
export function arquivoExemplo(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(ARQUIVO_EXEMPLO)) as Record<string, unknown>;
}
