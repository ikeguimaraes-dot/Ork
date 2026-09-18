# Banco de dados

O banco é necessário para usar o sistema; os dados do cliente anterior não são. A instalação recria a estrutura a partir das migrations e começa sem lançamentos, notas, títulos, folha, extratos ou documentos.

## O que está versionado

- `supabase/migrations/*_ork_baseline.sql`: DDL consolidado sem dados de cliente. Inclui dependências de chaves estrangeiras das tabelas financeiras.
- `supabase/migrations/*_ork_storage_seed.sql`: plano de contas inicial, papéis e buckets/políticas de Storage.
- `docs/database-objects.json`: inventário de tabelas, views e funções da baseline.
- `tests/sql/financeiro-integridade.sql`: testes transacionais, executados em banco local e encerrados em rollback.
- `scripts/bootstrap.mjs`: cadastros específicos da nova instalação, criados com IDs novos.

As migrations anteriores não eram uma instalação autossuficiente. Esta baseline foi extraída somente da estrutura, selecionada por dependências e acrescida das políticas de acesso necessárias. Não inclui usuários Auth, sessões, segredos, arquivos de Storage nem histórico de migration do banco de origem.

## Famílias de dados

| Família | Objetos principais | Alimentação inicial |
|---|---|---|
| Organização e acesso | `groups`, `brands`, `units`, `profiles`, `roles`, `user_roles`, `unit_cnpjs` | Bootstrap e administrador |
| Compras e contas a pagar | `titulos_a_pagar`, `produtos_relatorio`, `fornecedores`, de/para | Importações e classificação |
| Fiscal | `nfe_importacoes`, `nfe_documentos` | XML de NF-e |
| Receita | `receita_dias` e seus detalhes, `vendas_*` | XLSX/PDF dos formatos suportados |
| Folha e gorjetas | `payroll_extrato_dominio_*`, `dre_folha`, `gorjeta_*` | Extratos e cadastros autorizados |
| Razão e indicadores | `plano_contas`, `lancamentos`, `dre_snapshot`, `kpi_snapshot`, `financeiro_revisoes`, `metas` | Derivados das fontes e parâmetros |
| Conferência | `conferencias`, `reconciliacoes_sugeridas`, `regras_classificacao` | Conferência e classificação |
| Caixa | `contas_bancarias`, `movimentacoes_caixa`, `recebiveis_cartao` | Saldos e movimentos do cliente |
| Documentos | `contratos`, `contratos_arquivos`, `protestos_*`, `financeiro_importacoes` | Uploads privados |
| Apoio e compatibilidade | Cadastros de pessoal, fornecedores, catálogo e tabelas DRE auxiliares | Vazios; dependências de schema não significam que módulos de RH/compras completos estejam incluídos |

## Permissões

- `founder`: administrador de toda a instalação. Não representa um cliente dentro de banco compartilhado; o cliente é o próprio projeto Supabase.
- `cfo`: vínculo por `unit_id` para operação financeira.
- `socio_readonly`: vínculo por `unit_id`, somente consulta.
- `service_role`: usado apenas por instalação/manutenção confiável. As requisições do aplicativo usam o JWT do usuário e RLS.
- Usuário Auth sem vínculo não recebe acesso financeiro. Não basta inserir nome de papel em `user_metadata`.

Para novos colaboradores, crie/convidе o usuário no Auth, crie `profiles` e insira `user_roles` com o UUID do papel e da unidade. Faça isso pelo administrador do banco; não dê service-role ao usuário.

Todas as tabelas da baseline têm RLS. Views selecionadas usam `security_invoker`; funções de consulta de vínculos usam `SECURITY DEFINER` apenas para resolver acesso sem recursão. Tabelas de apoio não cobertas pelas políticas financeiras ficam restritas a founder, ou à unidade quando possuem `unit_id`. Nenhuma tabela é liberada anonimamente.

## Storage

Buckets privados: `contratos`, `protestos`, `financeiro-importacoes` e `folha-documentos`. Os caminhos começam pelo UUID da unidade. Downloads são assinados e uploads passam por políticas da unidade. Não torne o bucket público para resolver erro de acesso.

## Substituição e recálculo

`financeiro_aplicar_lote` executa o lote em transação. A substituição respeita origem, unidade e período; erro faz rollback. A unidade que enviou uma compra é preservada em `import_unit_id`, mesmo quando uma regra direciona a linha para outra unidade.

`financeiro_revisoes` detecta mudança de fonte. Razão e snapshots são publicados juntos, condicionados à revisão esperada. As fontes continuam sendo a referência; snapshots podem ser reconstruídos, documentos de origem não devem ser descartados como se fossem cache.

Importações não criam regras de negócio universais. Plano de contas é técnico; classificações específicas, metas, prazos de recebimento e fechamento precisam ser revisados por cliente.
