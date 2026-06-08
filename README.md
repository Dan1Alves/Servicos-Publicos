# Gestão Urbana — Plataforma Institucional (Iluminação Pública)

Plataforma completa (frontend + backend) para gestão urbana com foco inicial em iluminação pública e pronta para evoluir para outros serviços municipais. O pacote atual entrega:

- Portal público mobile-first com mapa interativo (MapLibre GL + tiles Carto Positron), solicitação de geolocalização, seleção guiada de serviço e registro de denúncias com protocolo automático e upload opcional.
- Layout institucional, sóbrio e responsivo com paleta neutra. A Home é focada no mapa (sem cards públicos extras) e não existe página separada de “transparência”.
- Painel `/painel` com login JWT compartilhado entre Admin (prefeitura) e Dev (super admin), dashboard, filtro por bairro/rua/status/serviço, exportação CSV e mapa operacional. Admins também contam com a área “Briefing” para atualizar textos institucionais, fundos (modal de serviço, cartão inline, drawer e modal de denúncia), paleta do portal e até o estilo do mapa público.
- Camada Dev para criar postes, ativar serviços, ajustar identidade visual, cadastrar novas cidades e gerenciar usuários.
- Backend Node.js 18+ (Express) com SQLite via `sql.js` (WASM), autenticação JWT, upload seguro (Multer), rate-limit, histórico de alterações e organização multi-cidade.

## Páginas institucionais

| Página | URL | Conteúdo |
| --- | --- | --- |
| Seleção de cidade | `/` | Modal inicial com as prefeituras ativas para o cidadão escolher. |
| Home / Mapa público | `/:slug-da-cidade` (também aceita `?city=slug`) | Abre o modal de serviços da cidade escolhida; depois da seleção, mostra o mapa MapLibre centralizado no município. O cidadão só compartilha GPS ao clicar em “Ir para minha localização”. |
| Contato | `/contato` | Canais oficiais e formulário local para registrar interesse. |
| Login Institucional | `/login` | Tela dedicada de autenticação (Admin/Dev) com redirecionamento automático para o painel após validar o token. |
| Painel Admin / Dev | `/painel` | Login único, dashboard, filtros, mapa operacional e ferramentas avançadas para Dev. |

## Requisitos e execução local

- Node.js 18 ou superior (qualquer distro oficial). Como usamos apenas dependências em JavaScript puro (`sql.js`, `bcryptjs`, etc.), não é necessário Visual Studio ou toolchains nativas — basta o que já vem com o Node. Pode rodar direto no terminal integrado do VS Code.
- `npm` (já incluso no Node). Nenhum serviço externo adicional é necessário.

```powershell
# Instalar dependências
npm install

# Subir o servidor (http://localhost:3000)
npm start
```

Arquivos-chave:

- `server.js` — API Express com armazenamento SQLite (em memória + `data.db`), upload, rate-limit, JWT e rotas públicas/admin/dev.
- `public/` — Frontend estático (HTML/CSS/JS) servido pelo Express.
- `data.db` — Banco SQLite preenchido automaticamente com seeds (cidades, postes, serviços e usuários). Delete-o para recriar do zero.
- `uploads/` — Pasta local onde ficam as imagens enviadas pelos cidadãos.

## Fluxo do cidadão

1. A Home primeiro exibe um modal institucional com os serviços disponíveis. Três cartões aparecem (Iluminação Pública ativa; Buracos na Rua e Lixo Acumulado como “Em breve”). O mapa só libera quando o cidadão seleciona um serviço ativo.
2. Ao habilitar Iluminação, o mapa MapLibre GL é exibido, o sistema solicita geolocalização e carrega os postes cadastrados. O usuário só interage com o mapa e com o drawer do poste escolhido — ele não manipula dados administrativos.
3. O botão “Registrar denúncia” (no drawer ou no card logo abaixo do mapa) abre um formulário simples (tipo de problema, descrição opcional, foto opcional). Coordenadas são coletadas automaticamente e não podem ser editadas manualmente.
4. O envio cria protocolo único, registra data/hora/IP/poste/serviço/coords e mostra a confirmação ao cidadão.
5. Todos os chamados ficam restritos ao painel autenticado. O usuário público não visualiza fila de denúncias nem estatísticas internas além dos indicadores agregados no topo da Home.

## Perfis e credenciais seed

| Usuário | Senha | Perfil | Permissões |
| --- | --- | --- | --- |
| `admin` | `admin123` | Admin (Prefeitura) | Dashboard, filtros, mapa operacional, atualização de status, observações e exportação CSV. Não pode editar postes/serviços/layout. |
| `dev` | `dev123` | Dev (Super Admin) | Tudo que o Admin faz + gestão de postes, serviços, branding, cidades e usuários. |

`POST /api/login` retorna `{ token, role, city }`. Use `Authorization: Bearer <token>` para acessar `/api/admin/*` (admin/dev) e `/api/dev/*` (apenas dev).

> Cada usuário **Admin** é vinculado a uma única cidade cadastrada pelo Dev. No primeiro acesso, o Admin deve confirmar o nome oficial da cidade e informar latitude, longitude e zoom do centro do mapa. Depois disso, ele visualiza somente os chamados daquela prefeitura e o seletor de cidade fica bloqueado. Perfis **Dev** podem alternar livremente entre cidades ativas.
>
> O dashboard do painel permite ajustar latitude, longitude e zoom do centro do mapa público da cidade. A URL pública fica no formato `https://dominio/:slug-da-cidade`, por exemplo `/carnaubais`.
>
> A aba **Briefing** do painel permite que Admins atualizem rapidamente o nome institucional, título/subtítulo da Home, cores primária/secundária/destaque, fundos do modal de serviços/cartão inline/drawer/modal de denúncia e até o estilo do mapa público, sem depender do time Dev.

## APIs principais

- **Público**
  - `GET /api/public/config` — cidades ativas, serviços cadastrados e branding institucional.
  - `GET /api/public/posts?city=slug` — postes ativos por cidade para exibir no mapa.
  - `GET /api/public/statistics?city=slug` — totais, status, média de resolução, hotspots e protocolos recentes.
  - `POST /api/report` — registro de denúncias (gera protocolo, salva IP/coords/imagem, anexa histórico).
- **Admin (Prefeitura)**
  - `GET /api/admin/meta` — filtros dinamicamente preenchidos (bairros, ruas, status, serviços) e aviso de primeiro acesso pendente.
  - `GET /api/admin/dashboard` — indicadores consolidados + séries mensais.
  - `GET /api/admin/reports` — lista filtrável com dados completos, incluindo coordenadas do poste.
  - `PATCH /api/admin/city` — atualiza nome da cidade, latitude, longitude e zoom do mapa público da prefeitura vinculada ao Admin.
  - `PATCH /api/admin/reports/:id` — alteração de status + observação (atualiza histórico e resolved_at).
  - `GET /api/admin/export` — CSV com respeito aos filtros aplicados.
- **Dev (Super Admin)**
  - CRUD de postes: `GET/POST /api/dev/posts`, `PUT/DELETE /api/dev/posts/:id`.
  - Cadastro de serviços: `GET/POST /api/dev/services`, `PATCH /api/dev/services/:id` (status, ordem, descrição, “em breve”, etc.).
  - Identidade institucional: `GET/PATCH /api/dev/branding` (cores, textos, brasão/logos futuros).
  - Multi-cidade: `GET/POST/PATCH /api/dev/cities`, `DELETE /api/dev/cities/:id` (remove também usuários admin, chamados, postes e bairros vinculados).
  - Usuários: `GET/POST /api/dev/users`, `PATCH /api/dev/users/:id` (troca de senha/papel), `DELETE /api/dev/users/:id`.

## Estrutura de dados

- `cities`, `districts`, `streets` — organizam múltiplas cidades e seus bairros/ruas.
- `posts` — poste com `post_uid`, coordenadas, bairro/rua e flags de atividade.
- `services` — módulos configuráveis (`active`, `upcoming`, etc.) exibidos no seletor público.
- `reports` — chamados com protocolo, serviço, poste, status (`aberto`, `em_andamento`, `resolvido`), IP, coordenadas do navegador, imagem, tempo de resolução, histórico serializado e origem (`portal`).
- `report_history` — trilha auditável de mudanças (status, anotações, autor e timestamps).
- `users` — autenticação com hash `bcryptjs` e papéis `admin` ou `dev`.
- `institutional_settings` — JSON único com branding/textos/contatos.

## Proteções e próximos passos

- Rate-limit específico para `/api/report` (30 envios/hora por IP), validação de upload (PNG/JPG/WEBP até 5 MB) e sanitização de texto.
- JWT expira em 8h e passa pelo middleware `requireRole`, garantindo separação entre Admin e Dev.
- Seeds garantem dados mínimos (cidade, postes, serviços, usuários e branding). Basta apagar `data.db` para reiniciar.
- Estrutura já preparada para novos módulos (WhatsApp, sensores inteligentes, app mobile). Utilize `/api/dev/services` para marcar um serviço como “em breve” e liberá-lo quando necessário.

> Dica: defina `JWT_SECRET` no ambiente antes de subir em produção (`setx JWT_SECRET "sua_chave_super_secreta"` no Windows). No ambiente local, o valor padrão funciona apenas para testes.
