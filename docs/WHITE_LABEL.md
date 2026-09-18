# Configuração white-label

## Modelo de entrega

Um código comum no Ork, um Supabase por cliente e uma implantação por cliente. Isso permite nomes/domínios diferentes sem misturar dados. Use releases e variáveis por instalação; ramificações permanentes de código por cliente tendem a dificultar correções futuras.

## Variáveis

| Variável | Uso | Obrigatória |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | Origem do app, login e callbacks | Produção |
| `NEXT_PUBLIC_APP_NAME` | Nome no login, menu, título e rodapé | Não; padrão Ork |
| `NEXT_PUBLIC_APP_TAGLINE` | Descrição e assinatura | Não |
| `NEXT_PUBLIC_BRAND_COLOR` | Cor principal hexadecimal | Não |
| `NEXT_PUBLIC_SUPABASE_URL` | Projeto do cliente | Sim |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Chave pública de acesso, protegida por RLS | Sim |
| `SUPABASE_SERVICE_ROLE_KEY` | Bootstrap/manutenção de servidor | Sim para instalação; nunca pública |
| `ANTHROPIC_API_KEY` | Extração por IA nos importadores de PDF que usam Anthropic | Só para esses fluxos |
| `NEXT_PUBLIC_UNIT_RULES` | Objeto JSON por UUID da unidade | Gerado pelo bootstrap |
| `NEXT_PUBLIC_FINANCEIRO_URL` | Prefixo de APIs | Padrão `/financeiro` |

Exemplo de valor público para regras, usando o UUID da própria instalação:

```json
{
  "10000000-0000-4000-8000-000000000001": {
    "revenueAccount": "1.02",
    "erpCompany": "CODIGO_NO_ERP",
    "categoryContains": ["NOME EXATO DA UNIDADE DELIVERY"]
  }
}
```

Sem regra, receita usa `1.01` e compras permanecem na unidade escolhida. Uma categoria que corresponde a várias unidades é rejeitada: não há escolha silenciosa. Configure frases específicas para evitar colisão entre nomes semelhantes. As unidades e permissões são lidas do banco; este JSON não concede acesso.

`erpCompany` só é necessário para consultas legadas do ERP Everest que utilizam código de empresa. NF-e identifica destinatários por CNPJ; cadastre corretamente CNPJ e aliases antes de importar.

## O que foi desacoplado

Login/menu próprios, logout por POST, marca configurável, unidades dinâmicas no cockpit/importações/contratos, canais e roteamento configuráveis, competências por fontes e seletores de ano móveis. A DRE principal usa o razão/snapshots canônicos, sem depender de uma planilha histórica com anos fixos.

O protótipo antigo por marca (`/financeiro/[brand_slug]`) e o importador de DRE fixo de 2026 não integram esta base. Dependiam de fluxos/tabelas ou layouts históricos distintos. Os módulos apresentados como em preparação continuam assim; não são anunciados como funcionalidades concluídas.

## Fontes de dados

- NF-e: XML, chave fiscal e posição do item; CNPJ deve estar vinculado à unidade.
- Compras: layouts suportados `NF_PEDIDOS` e Contas a Pagar, além do importador de pacote. Abas mensais aceitam todos os meses; informe o ano no diálogo.
- Receita: formatos de relatório implementados de venda/movimento, por XLSX/PDF.
- Folha: extrato Domínio suportado; validar rubricas e encargos do cliente.
- Contratos/protestos: uploads privados e conferência dos metadados extraídos.

Não foram publicados arquivos reais de exemplo. Na entrada de um novo cliente, peça amostras anonimizadas e confira cabeçalhos, competência, CNPJ, totais e reimportação. Um novo ERP pode exigir um adaptador.

## Decisões ainda próprias de cada cliente

Classificação de despesas, taxas de cartão/delivery, prazos previstos, datas de pagamento, metas, critérios de estoque/CMV, rateios e definição do fechamento. O software inicia sem receitas/despesas fictícias e sem regras específicas copiadas de outro restaurante.
