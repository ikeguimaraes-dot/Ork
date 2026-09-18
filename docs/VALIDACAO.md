# Validação da base

Verificado em 18/09/2026, com dados sintéticos e Supabase local descartável. O banco do restaurante de origem não foi copiado nem alterado.

## Executado

- Instalação limpa das migrations no Supabase local (CLI 2.104.0, Postgres 17), incluindo RLS e buckets privados.
- Testes SQL de isolamento por unidade, perfil somente leitura, rollback, substituição e revisão concorrente.
- Bootstrap executado duas vezes: grupo, marca, duas unidades e primeiro administrador sem duplicação.
- 28 testes automatizados de aplicação, incluindo correção de importações, sessão, seleção de unidade, doze meses de compras e roteamento configurável.
- Lint, TypeScript e build de produção.
- Testes HTTP com usuário autenticado: DRE, contas a pagar, contratos, folha, receita, CMV, fluxo e APIs da folha/receita em banco vazio.
- GET de saída preserva a sessão; POST encerra a sessão e chamadas seguintes recebem 401.
- Dependências atualizadas; `npm audit` sem vulnerabilidades conhecidas reportadas na data da validação. Isso não substitui futuras revisões.

A biblioteca SheetJS vem do [distribuidor oficial](https://docs.sheetjs.com/docs/getting-started/installation/nodejs/), pois a versão publicada no registro npm é antiga. O lockfile conserva URL e integridade do pacote. Next.js foi atualizado para 16.3.5.

## Verificações por instalação

Não foi criada uma implantação de produção nem um projeto Supabase remoto para um cliente novo. SMTP, domínio, convites e recuperação por e-mail precisam de validação no ambiente definitivo. Arquivos reais de cada ERP, extração de PDF com IA e regras contábeis do cliente também exigem conferência antes da operação.

O build pode emitir aviso do empacotador sobre o worker PDF.js. Os pacotes PDF permanecem externos; valide os PDFs reais do cliente na hospedagem definitiva.

A CI repete verificações de código e banco em cada push. `npm run test:db` apaga somente os dados do Supabase local Ork; não aponte testes para produção.

Na última repetição local, as migrations foram aplicadas, mas o CLI encerrou antes de o Storage ficar saudável. O container ficou saudável em seguida e os testes SQL executados diretamente passaram. Uma instalação limpa anterior também passou pelo fluxo completo do CLI.

O CSS utilitário do shadcn 4.8.1 está versionado em `src/styles/vendor`, com sua licença MIT; a CLI de geração não é necessária na aplicação.
