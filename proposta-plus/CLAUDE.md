# Proposta+

Aplicativo de propostas comerciais para arquitetura e design de interiores.
A profissional cola os dados de uma planilha de precificação, o sistema monta uma
apresentação de slides, gera PDF e um link público para o cliente.

## Stack e comandos

- React + Vite + Tailwind, publicado na Vercel
- Firebase: Auth (Google) e Firestore. **Plano gratuito (Spark)** — sem Cloud Functions
  e sem Storage para imagens (Storage só é usado para vídeo)
- `npm install` / `npm run dev` / `npm run build`
- Sempre rodar `npm run build` antes de entregar qualquer alteração

## Como as mudanças chegam ao ar

A Vercel está conectada ao repositório no GitHub e publica sozinha sempre que o código lá muda —
não existe um botão de publicar separado. Ela extrai o zip entregue por fase e arrasta os arquivos
para o **"Upload files" do GitHub** (não usa Git nem terminal localmente); a Vercel detecta o commit
novo e publica em 1-2 minutos. `firestore.rules` fica de fora desse caminho: precisa ser colado à
mão no Console do Firebase (Firestore → Rules → Publish) — por isso toda alteração nesse arquivo
exige aviso em destaque.

**Reverter um deploy que quebrou algo:** painel da Vercel → aba Deployments → menu (`...`) do deploy
anterior que funcionava → "Promote to Production". Volta o site ao ar na hora, sem precisar de novo
build. Não desfaz dados já gravados ou apagados no Firestore nesse meio-tempo, e não cobre uma
regressão causada por `firestore.rules` (que tem seu próprio histórico de versões no Console do
Firebase).

## Como falar com a pessoa

Ela é arquiteta, não programadora. Explicar em português, sem jargão, dizendo **por que**
o problema acontecia — não só o que foi mudado. Comentários no código em português,
explicando a razão da decisão: o código é lido por ela.

Entregar o projeto inteiro em zip, numerado por fase (fase45, fase46…). O zip sempre traz uma
única pasta **"proposta-plus"** por dentro, com tudo dentro dela — assim, ao extrair, ela sabe
exatamente qual pasta abrir e selecionar (Ctrl+A) para arrastar pro "Upload files" do GitHub,
sem risco de arrastar a pasta errada e criar uma pasta duplicada dentro do repositório.

## Layout

```
src/
  lib/
    db.js        Firestore: propostas, configurações, mídia, medição de espaço
    media.js     Carregamento das fotos sob demanda + cache (memória e IndexedDB)
    acesso.js    Papéis (dono/colaborador/autorizado/teste/excluído), listas, suporte
    slides.js    Monta o array de slides a partir de fields + content + settings
    fields.js    Campos colados da planilha (por pacote: completo/básico/essencial)
    content.js   Conteúdo padrão da apresentação (textos de fábrica)
  pages/
    Presenter.jsx  ~2.900 linhas. Apresentação, edição de slide, PDF, gerador invisível
    Dashboard.jsx  Painel, status, encerramento, limites mensais
    Editor.jsx     Dados do projeto, agendamentos, design, preços
    Settings.jsx   Marca, conteúdo padrão, galeria de imagens, limpeza de órfãs
    Usuarios.jsx   Só para a dona: autorizados/teste/excluídos/suporte
firestore.rules  NÃO sobe com o deploy — publicar à mão no Console do Firebase
```

## Regras duras (erros que já custaram caro)

**Nunca usar classe responsiva (`md:`, `sm:`, `lg:`) dentro do desenho do slide.**
O slide é sempre 1600x900 e só é encolhido por `transform: scale`. As classes do Tailwind
olham a largura da JANELA, não do canvas — no celular o slide se remontava no formato
mobile: colunas viravam empilhadas e fotos marcadas `hidden md:block` sumiam.
Ver o comentário em cima de `SlideView`.

**Medir espaço com `offsetWidth`/`offsetHeight`, nunca `getBoundingClientRect`.**
O segundo devolve o tamanho já escalado, que reaplicado dentro do canvas era multiplicado
pela escala de novo. Fotos estouravam o espaço em telas grandes e o PDF saía diferente da tela.

**Tamanho de imagem é calculado em JS, não deixado para o CSS.**
`aspect-ratio` + altura cheia fazia a largura ser cortada por `maxWidth`, e o formato
escolhido não valia. Ver `ImageStrip` e `GradeDeFeedbacks`.

**Fotos são base64 dentro de documentos do Firestore** (limite de 1MB por documento).
Comprimidas para 1400px / qualidade 0,75 antes de subir. Cada foto vira um documento na
subcoleção `media`. Consequências:
- `saveImageAsMedia` tem um índice por conteúdo. Sem ele, cada gravação da proposta
  reenviava TODAS as fotos e duplicava tudo — chegou a 7.823 documentos de cópias
- apagar um documento no Firestore **não apaga as subcoleções**; sempre esvaziar `media`
  antes de apagar a proposta
- a apresentação carrega só as fotos do slide atual e do próximo (`lib/media.js`)
- para contar fotos use `getCountFromServer`, nunca `getDocs`: pedir a coleção baixa
  todas as fotos inteiras (isso travou a tela por 10 minutos uma vez)

**`firestore.rules` é publicado à mão.** A Vercel publica o site, não as regras. Toda
alteração nelas exige avisar a pessoa para republicar no Console do Firebase.

**O e-mail da administradora está escrito dentro das regras**, de propósito: se o app
decidisse quem é admin, bastaria alguém editar o próprio cadastro para virar um.

## Modelo de dados

- `users/{uid}` — settings + content (conteúdo padrão da apresentação)
- `users/{uid}/proposals/{id}` — uma proposta; `fields` vem da planilha
- `users/{uid}/proposals/{id}/media/{id}` — fotos daquela proposta
- `users/{uid}/media/{id}` — biblioteca da conta (fotos "para todas as propostas")
- `config/acesso` — listas de acesso e textos de suporte; só a dona escreve
- `acessos/{uid}` — cadastro que cada pessoa escreve de si mesma no login

**Escopo de edição de slide:** toda edição pergunta onde salvar — só esta proposta,
só este tipo de projeto, ou todas. Vai para `slideOverrides` (proposta) ou
`content.slideDefaults[bucket]` (modelo). Campos do cliente (título e itens da capa)
ficam sempre presos à proposta, mesmo escolhendo "todas".

**Dados pessoais não vão em `content.js`.** Nome, biografia e registro vêm de
Configurações; os feedbacks de fábrica são genéricos. Já houve vazamento: toda conta nova
nascia com o nome, a bio e os depoimentos de clientes reais da dona.

## Controle de acesso

Cada conta é um espaço isolado — ninguém vê os dados de ninguém, **inclusive a dona**.
É isso que impede, por exemplo, apagar os dados de outra pessoa pelo painel: exigiria
permissão de leitura sobre eles.

Colaboradores são a exceção: trabalham dentro do espaço da dona
(`definirContaDeTrabalho` em `db.js`).

Teste vencido e excluído: leem tudo, não gravam nada. **Apagar é sempre permitido**,
mesmo bloqueado — senão a pessoa não consegue liberar espaço, e o próprio aviso do
sistema manda excluir uma proposta para destravar o botão.

A permissão de edição fica em `acesso.js` (`podeEditarAgora`), não passada de tela em
tela: a apresentação e o editor abrem por rotas próprias, fora do layout que conhece o papel.

## Ciclo de vida da proposta

`rascunho → aceita/recusada → pendente de encerramento → encerrada`

Encerrar apaga as fotos e a apresentação, mantendo os dados do projeto. É o que devolve
espaço. **Exige PDF gerado antes** — é a única cópia que sobra. 30 dias após a entrega, a
proposta aceita entra em "pendente de encerramento": trava a edição mas não apaga nada.
Proposta encerrada ou recusada não abre a apresentação nem pelo endereço direto.

Limites por mês: 6 para autorizados, 2 para teste, ilimitado para a dona.
Configuráveis em Usuários → Suporte.

## Pendências conhecidas

- Fotos de propostas apagadas antes da correção continuam no banco e só saem pelo Console
  (o SDK não lista subcoleções de documentos que já não existem)
- "Excluir cadastro" só limpa os dados quando a pessoa volta a entrar
- Testes vencidos só são bloqueados depois que a dona entra (a lista é recalculada nesse momento)
- Imagens de exemplo apontam para picsum.photos — dependem de um site externo estar no ar
- Limite de fotos por proposta no período de teste ainda não existe
- O painel de espaço mostra só o consumo da própria conta, não o do banco inteiro
