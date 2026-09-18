# Operação e evolução

## Atualizações

1. Desenvolva e teste no Supabase local ou homologação própria.
2. Crie novas migrations com `supabase migration new nome_da_mudanca`; não altere a baseline após instalá-la em clientes.
3. Rode lint, tipos, testes, build e `npm run test:db`.
4. Faça backup do destino, confira `supabase migration list` e `db push --dry-run`.
5. Aplique migrations compatíveis antes do deploy que depende delas.
6. Valide login, uma leitura e uma substituição de importação em homologação.
7. Registre versão do código, migrations aplicadas, projeto e domínio de cada cliente.

Não execute instalação de um cliente com `.env.local` de outro. `scripts/bootstrap.mjs` exige o project-ref correspondente à URL para ajudar a evitar esse erro. O bootstrap pode ser repetido com o mesmo arquivo de configuração e os mesmos IDs.

## Backup e recuperação

Backups do banco e arquivos de Storage são itens diferentes. Defina retenção e rotina de teste de restauração para ambos. A disponibilidade de backups/PITR depende do plano Supabase contratado; confira no projeto antes de prometer prazo de recuperação.

Restaure em um projeto separado para conferir integridade antes de substituir produção. Preserve documentação da versão do código e migrations. Nunca use `supabase db reset` como reparo de produção.

## Segredos

Use variáveis de ambiente da hospedagem e gerenciador de segredos. Não versionar `.env*` com valores, `config/*.local.json`, cópias do banco, documentos de clientes nem arquivos `.vercel`. Somente `.env.example` contém nomes e placeholders seguros.

A service-role não deve aparecer em bundle do navegador. Não criar endpoints públicos de instalação ou de execução arbitrária de SQL. O bootstrap é administrativo, executado no terminal confiável.

## Diagnóstico

- 401: verificar login, domínio/cookies, URL/chave pública Supabase; nunca resolver removendo autenticação.
- Sem unidades: conferir `user_roles`, unidade ativa e vínculo correto.
- Relação/função ausente: conferir migrations do projeto exato.
- Storage negado: conferir bucket privado, UUID inicial do caminho e permissão da unidade.
- Fonte salva e indicadores pendentes: reabrir cockpit com permissão de edição para tentar recálculo; não reimportar repetidamente sem verificar a mensagem.
- PDF: conferir chave Anthropic quando aplicável, formato do fornecedor e logs sem documentos/tokens completos.

`npm run test:db` é destrutivo somente para o projeto **local Ork**. Não o use para conservar dados de desenvolvimento importantes sem exportá-los antes.
