# Ork Financeiro

Base white-label de gestão financeira para restaurantes, com Next.js e Supabase. Cada cliente recebe seu próprio projeto Supabase e sua própria implantação do aplicativo; as unidades desse cliente compartilham o banco, com acesso controlado por RLS.

Este repositório contém **código, migrations, políticas, funções, buckets e cadastros técnicos iniciais**. Não contém dados financeiros, usuários, documentos, credenciais nem vínculo de infraestrutura de outro restaurante.

- [Instalação do zero](docs/INSTALACAO.md)
- [Banco, permissões e inventário SQL](docs/BANCO.md)
- [Personalização por cliente](docs/WHITE_LABEL.md)
- [Operação, atualizações e backups](docs/OPERACAO.md)
- [Validação e limites](docs/VALIDACAO.md)

## Desenvolvimento

Requisitos: Node.js 22.18+ (testado também com Node 26), npm, Docker e Supabase CLI.

```bash
npm ci
supabase start
cp .env.example .env.local
# Preencha as chaves LOCAIS mostradas por supabase status.
npm run dev
```

Acesse `http://localhost:3001`. O app inclui login próprio, recuperação de senha, menu e seleção de unidade. Não precisa de um shell externo.

```bash
npm run lint
npm run type-check
npm run test:ui
npm run build
npm run test:db # recria APENAS o banco Supabase local Ork; apaga dados locais
```

Para instalar em produção, siga o guia completo. Copiar o código sozinho não cria o banco nem configura e-mail ou usuários.
