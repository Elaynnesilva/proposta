# Proposta+

Sistema de apresentação de propostas de projeto de arquitetura e interiores.

## O que já funciona (nesta primeira versão)

- Login por email/senha (guardado neste navegador — ver seção Firebase abaixo)
- Painel com todas as suas propostas: criar, renomear, excluir
- Marcar proposta como **aceita** (com valor que entrou no caixa, destacado) ou **recusada**
- Gráfico de propostas aceitas x recusadas
- Editor de proposta com:
  - Campo para colar as informações da sua planilha (ou preencher manualmente) — sem nenhum código técnico visível
  - Escolha da tipologia (Residencial / Comercial / Corporativo) — troca as fotos padrão
  - 3 modelos de design: Minimalista, Criativo, Corporativo
  - Roda de cores com até 3 cores (aceita código hexadecimal)
  - Slides personalizados (texto, imagem, vídeo)
  - Upload de vídeo do projeto ou link de incorporação (YouTube/Vimeo)
- Apresentação em tela cheia com animação: os textos aparecem um a um a cada clique
- Configurações: logo do sistema, dados da empresa/profissional, textos padrão (edição única que reflete nos 3 tipos) e fotos padrão por tipologia

## Rodar localmente

```bash
npm install
npm run dev
```

Abra o endereço que aparecer no terminal (geralmente http://localhost:5173).

## Publicar no Vercel

1. Suba esta pasta para um repositório no GitHub (ou use `vercel` pela CLI direto desta pasta).
2. No [vercel.com](https://vercel.com), clique em **Add New Project** e selecione o repositório.
3. Vercel detecta automaticamente que é um projeto Vite — não precisa mudar nada nas configurações de build.
4. Clique em **Deploy**.

## Sobre o login e os dados salvos

O Proposta+ já está conectado ao seu projeto Firebase (**proposta-575f3**). Login por
email/senha e por Google, e todas as propostas salvas no Firestore — sincronizando
automaticamente em qualquer computador ou celular onde você entrar com a mesma conta.

### Falta um passo: aplicar as regras de segurança do Firestore

Isso impede que qualquer pessoa leia ou edite os dados de outra pessoa.

1. No [console do Firebase](https://console.firebase.google.com), vá em **Firestore** > aba **Rules**.
2. Apague o conteúdo atual e cole o conteúdo do arquivo `firestore.rules` (está na raiz desta pasta).
3. Clique em **Publish** (Publicar).

### Quando publicar no Vercel: autorize o domínio

Por padrão, o Firebase só permite login a partir de `localhost` e do próprio domínio
`proposta-575f3.firebaseapp.com`. Depois de publicar no Vercel, adicione o domínio novo:

1. No console do Firebase, vá em **Authentication** > aba **Settings** > **Authorized domains**.
2. Clique em **Add domain** e cole o domínio que o Vercel te deu (ex: `proposta-plus.vercel.app`).

Sem esse passo, o login (principalmente o "Entrar com Google") não vai funcionar no site publicado.


## Estrutura do projeto

```
src/
  lib/
    db.js          -> tudo que salva/lê dados (login, propostas, configurações)
    fields.js       -> lista de campos da proposta (nomes em português)
    content.js      -> textos e fotos padrão por tipologia
    templates.js    -> os 3 modelos de design + paleta de cores
    slides.js       -> monta a lista de telas da apresentação
  components/
    DataTable.jsx        -> tabela onde você cola/edita os dados
    ColorWheelPicker.jsx -> roda de cores
    Layout.jsx            -> menu lateral / menu inferior no celular
  pages/
    Login.jsx
    Dashboard.jsx    -> lista de propostas + gráfico
    Editor.jsx        -> dados, design, slides extras, vídeo
    Settings.jsx       -> marca, textos padrão, fotos por tipologia
    Presenter.jsx       -> a apresentação em tela cheia
```

## Próximos passos sugeridos

- Conectar Firebase (login real entre aparelhos + backup na nuvem)
- Exportar a apresentação como PDF
- Ajustar mais a fundo a identidade visual de cada um dos 3 modelos
