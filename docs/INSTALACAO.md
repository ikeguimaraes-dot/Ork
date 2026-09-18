# Instalação do zero

## 1. Separar cada cliente

Use um projeto Supabase e uma implantação Vercel por cliente. Matriz, filial e delivery do mesmo cliente podem ser `units` nesse projeto. O papel `founder` vê toda a instalação: portanto, **não junte clientes independentes no mesmo banco** neste modelo.

O repositório é o produto comum. Evite copiar migrations manualmente entre clientes: publique versões e mantenha cada instalação no mesmo release, com variáveis e cadastros próprios. Um novo cliente começa com banco vazio, nunca com backup de outro cliente.

## 2. Criar infraestrutura

1. Crie um projeto novo no Supabase; guarde a senha do banco em gerenciador de segredos.
2. Anote a URL, chave pública `anon` e chave `service_role` em Project Settings → API. Este código usa essas chaves legadas JWT. Não coloque `service_role` em variável `NEXT_PUBLIC_*`.
3. Clone este repositório e instale as dependências:

```bash
git clone https://github.com/ikeguimaraes-dot/Ork.git
cd Ork
npm ci
cp .env.example .env.local
```

Preencha `.env.local` com as chaves do **projeto novo**. `NEXT_PUBLIC_APP_URL` será o domínio HTTPS definitivo em produção, sem caminho; localmente, `http://localhost:3001`.

## 3. Criar todo o banco

Instale o Supabase CLI e autentique sua conta. No diretório do Ork:

```bash
supabase login
supabase link --project-ref SEU_PROJECT_REF
supabase migration list
supabase db push --dry-run
supabase db push
```

A primeira migration cria a estrutura completa da aplicação e suas dependências: tabelas, índices, sequências, constraints, views, funções, triggers, grants e RLS. A segunda cria os buckets privados, os papéis iniciais e o plano de contas. Os schemas `auth` e `storage` são geridos pelo próprio Supabase; não os copie de outro projeto.

**Não use esta baseline num banco já alimentado. Não execute `db reset --linked` em produção.** Ela é uma linha inicial independente do histórico do sistema de origem.

`supabase/seed.sql` é reservado a desenvolvimento e está vazio. Cadastros técnicos obrigatórios estão nas migrations, para serem instalados também por `db push` remoto.

## 4. Configurar Auth e e-mail

No Supabase Authentication:

- Site URL: o mesmo valor de `NEXT_PUBLIC_APP_URL`.
- Redirect URLs: inclua `https://SEU_DOMINIO/auth/callback` e, se necessário, a URL local equivalente.
- Desabilite cadastro público para que somente administradores criem/convidem usuários.
- Configure SMTP próprio e remetente para convites e recuperação de senha. Sem SMTP válido, não considere o fluxo de e-mail pronto em produção.
- Nos templates de convite e recuperação, use link para `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite` ou `type=recovery`, respectivamente. O callback também aceita `code` PKCE.

Crie o primeiro usuário em Authentication → Users, ou envie um convite. Copie seu UUID. Não compartilhe senha por chat nem a coloque em arquivos versionados. O convidado define a própria senha em `/redefinir-senha`.

## 5. Cadastrar restaurante e administrador

```bash
cp config/client.example.json config/client.local.json
```

Edite nome, slug, cor, unidades e CNPJs reais. Deixe CNPJ vazio se ainda não disponível; nesse caso, importações XML dependentes dele devem aguardar o cadastro. Configure `revenueAccount`: `1.01` salão, `1.02` delivery, `1.03` eventos ou `1.04` outras receitas. O script gera os UUIDs, salva no arquivo local e pode ser executado novamente sem duplicar os cadastros.

```bash
npm run bootstrap -- --config config/client.local.json --owner UUID_DO_USUARIO --project-ref SEU_PROJECT_REF
```

O script verifica o destino e a existência do usuário, cria grupo/marca/unidades, profile e vínculo `founder`. Não cria dados financeiros nem envia e-mail. Se ocorrer falha parcial, corrija o erro e rode novamente usando o mesmo arquivo, que conserva os IDs.

Ele produz `.env.instance.local`: copie suas variáveis para `.env.local` e para a Vercel. Esse arquivo não é carregado automaticamente pelo Next.js. Nome/cor/regras são públicos; chaves secretas permanecem somente nas variáveis de servidor.

Para o Supabase local, use `--project-ref local`. O CLI local atende em `http://127.0.0.1:55431` e banco em porta `55432`, conforme `supabase/config.toml`.

## 6. Publicar aplicativo

Crie uma implantação Vercel ligada ao Ork. Framework: Next.js; install: `npm ci`; build: `npm run build`. Configure em Production as variáveis da tabela em [WHITE_LABEL.md](WHITE_LABEL.md), incluindo os valores gerados pelo bootstrap. Refaça o deploy após alterar variáveis `NEXT_PUBLIC_*`.

Não copie `.vercel`, `.env.local`, o project-ref local ou as chaves do projeto de origem. Use um projeto Supabase separado também para homologação; previews não devem receber as chaves de produção automaticamente.

O build da Vercel bloqueia as quatro configurações obrigatórias vazias: URL Supabase, chave pública, service-role e URL do aplicativo. Ele não comprova que uma chave digitada incorretamente é válida: faça a aceitação abaixo.

## 7. Aceitação antes de alimentar

1. Faça login e abra folha, receita, DRE, compras e caixa; banco vazio deve produzir estados sem dados, sem erro de tabela ausente.
2. Aguarde e navegue entre telas: o menu não pode encerrar a sessão. Saída usa POST; GET não faz logout.
3. Cadastre um usuário com `socio_readonly` por unidade e confirme leitura sem escrita.
4. Com duas unidades, confira que um usuário vinculado a uma delas não acessa a outra por URL ou API.
5. Importe um arquivo pequeno e conhecido. Corrija e reimporte o mesmo escopo; confira substituição e recálculo, sem duplicação.
6. Teste XML, XLSX e PDFs dos sistemas reais do cliente. PDF com IA exige a chave opcional Anthropic e conferência da extração.
7. Teste upload/download privado de contrato e recuperação de senha por e-mail.
8. Configure backups e registre a versão instalada.

Os formatos de arquivo variam entre ERPs. Ter a estrutura pronta não torna qualquer planilha automaticamente compatível; consulte [WHITE_LABEL.md](WHITE_LABEL.md).
