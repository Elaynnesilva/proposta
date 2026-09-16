import { doc, getDoc, setDoc, collection, getDocs, deleteDoc, serverTimestamp } from 'firebase/firestore'
import { db, auth } from './firebase'

/**
 * CONTROLE DE ACESSO
 *
 * Dois lugares no banco, com permissões bem diferentes:
 *
 *  - config/acesso  — as listas (autorizados, excluídos, colaboradores) e os textos da tela
 *                     de boas-vindas. Qualquer pessoa logada LÊ (é assim que o app dela
 *                     descobre em que situação está), mas só a dona ESCREVE.
 *
 *  - acessos/{uid}  — um documento por pessoa, escrito por ela mesma no primeiro login, com
 *                     e-mail, data de entrada e os dados que alimentam a tabela (nome,
 *                     WhatsApp, quantidade de propostas). A dona lê todos.
 *
 * A separação existe por segurança: se o cadastro de quem entra fosse feito direto em
 * config/acesso, qualquer pessoa logada precisaria de permissão de escrita nesse documento —
 * e poderia reescrever as listas inteiras, inclusive se colocando como autorizada.
 */

export const EMAIL_PRINCIPAL_PADRAO = 'elaynnearquiteta@gmail.com'

export const SUPORTE_PADRAO = {
  titulo: 'Olá! {nome}, seja bem vindo(a) ao P+.',
  mensagem: 'Você está usando uma versão de teste de {dias} dias. Faça o upgrade no link abaixo. '
    + 'Caso tenha adquirido este sistema por tempo ilimitado, desconsidere essa informação, seu e-mail '
    + 'será autorizado em breve. Caso contrário, entre em contato com o nosso suporte.',
  whatsapp: '(99) 9 8149-9138',
  email: 'precifiquebem.contato@gmail.com',
  diasTeste: 30,
  limiteMensal: 6,
  limiteMensalTeste: 2,
  botaoNome: 'Pack PreciFiqueBem',
  botaoLink: 'https://elaynnemaria.wixsite.com/arqdesign/pack-precifiquebem',
  emailPrincipal: EMAIL_PRINCIPAL_PADRAO,
  colaboradores: [],
}

/**
 * `teste` guarda os e-mails que estão em teste MESMO SEM TEREM ENTRADO ainda — por exemplo,
 * um e-mail tirado dos autorizados. Quem já fez login aparece em teste sozinho (pelo próprio
 * cadastro em acessos/{uid}); esta lista cobre justamente quem ainda não tem cadastro nenhum
 * e, sem ela, simplesmente sumia da tela ao sair dos autorizados.
 */
export const ACESSO_PADRAO = { autorizados: [], teste: [], excluidos: [], donoUid: '', suporte: SUPORTE_PADRAO }

const refConfig = () => doc(db, 'config', 'acesso')

export function normalizarEmail(email) {
  return String(email || '').trim().toLowerCase()
}

export async function lerConfigAcesso() {
  try {
    const snap = await getDoc(refConfig())
    const data = snap.exists() ? snap.data() : {}
    return {
      ...ACESSO_PADRAO,
      ...data,
      autorizados: data.autorizados || [],
      teste: data.teste || [],
      excluidos: data.excluidos || [],
      suporte: { ...SUPORTE_PADRAO, ...(data.suporte || {}) },
    }
  } catch {
    // sem permissão ou offline: devolve o padrão para o app não travar na tela de carregamento
    return { ...ACESSO_PADRAO }
  }
}

/**
 * Grava as listas e, junto, as versões "só e-mails" delas.
 *
 * As regras do Firestore precisam perguntar "este e-mail está na lista?", e elas não sabem
 * percorrer uma lista de objetos como {email, desde} para extrair um campo. Por isso o app
 * mantém, no mesmo documento, listas paralelas com os e-mails puros — é nelas que as regras
 * olham. Quem escreve continua sendo só a administradora, então elas são tão confiáveis
 * quanto as originais.
 */
export async function salvarConfigAcesso(config) {
  const completo = {
    ...config,
    autorizadosEmails: (config.autorizados || []).map((a) => normalizarEmail(a.email)),
    excluidosEmails: (config.excluidos || []).map((a) => normalizarEmail(a.email)),
    colaboradoresEmails: (config.suporte?.colaboradores || []).map(normalizarEmail),
  }
  await setDoc(refConfig(), completo, { merge: true })
  return completo
}

/**
 * Recalcula quem já passou do período de teste e grava a lista para as regras do Firestore.
 *
 * A conta é feita aqui, no app da administradora, e não dentro das regras. O motivo é de
 * confiança: a data de início do teste é gravada pelo aplicativo de quem entra, ou seja, pela
 * própria pessoa — se as regras dependessem dela, bastaria alterá-la para renovar o teste
 * sozinho. Vindo da administradora, a lista não pode ser forjada.
 *
 * Em troca, ela só é atualizada quando a administradora abre o sistema. Alguém pode, no pior
 * caso, seguir usando alguns dias além do prazo até a próxima vez que você entrar.
 */
export async function sincronizarVencidos(config, acessos) {
  const dias = Number(config.suporte?.diasTeste) || 30
  const principal = normalizarEmail(config.suporte?.emailPrincipal || EMAIL_PRINCIPAL_PADRAO)
  const autorizados = new Set((config.autorizados || []).map((a) => normalizarEmail(a.email)))
  const colaboradores = new Set((config.suporte?.colaboradores || []).map(normalizarEmail))

  const vencidos = []
  const considerar = (email, desde) => {
    const e = normalizarEmail(email)
    if (!e || e === principal || autorizados.has(e) || colaboradores.has(e)) return
    if (!desde) return
    const fim = new Date(new Date(desde).getTime() + dias * 24 * 60 * 60 * 1000)
    if (fim.getTime() < Date.now()) vencidos.push(e)
  }
  ;(acessos || []).forEach((a) => considerar(a.email, a.desde))
  ;(config.teste || []).forEach((t) => considerar(t.email, t.desde))

  const lista = [...new Set(vencidos)]
  const atual = config.vencidosEmails || []
  const igual = lista.length === atual.length && lista.every((e) => atual.includes(e))
  if (igual) return config
  return salvarConfigAcesso({ ...config, vencidosEmails: lista })
}

/* ---------------- registro de quem entra ---------------- */

/**
 * Chamado a cada login. Cria (ou atualiza) o documento da própria pessoa em acessos/{uid}.
 * A data de entrada é gravada só na primeira vez — é dela que sai a contagem dos dias de teste.
 */
export async function registrarAcesso({ nome, whatsapp, propostas } = {}) {
  const user = auth.currentUser
  if (!user) return null
  const ref = doc(db, 'acessos', user.uid)
  try {
    const snap = await getDoc(ref)
    const jaExiste = snap.exists()
    const dados = {
      email: normalizarEmail(user.email),
      ultimoAcesso: serverTimestamp(),
      ...(nome !== undefined ? { nome } : {}),
      ...(whatsapp !== undefined ? { whatsapp } : {}),
      ...(propostas !== undefined ? { propostas } : {}),
      ...(jaExiste ? {} : { desde: new Date().toISOString() }),
    }
    await setDoc(ref, dados, { merge: true })
    return { ...(jaExiste ? snap.data() : {}), ...dados }
  } catch {
    return null
  }
}

export async function listarAcessos() {
  try {
    const snap = await getDocs(collection(db, 'acessos'))
    return snap.docs.map((d) => ({ uid: d.id, ...d.data() }))
  } catch {
    return []
  }
}

/**
 * Marca o cadastro de alguém para ser ZERADO no próximo login dela.
 *
 * A limpeza não acontece agora porque quem apaga os dados é o aplicativo da própria pessoa —
 * a administradora nunca recebe permissão de leitura sobre o espaço de ninguém, e é isso que
 * sustenta a promessa de que cada conta é isolada. A marca fica no cadastro dela; ao entrar,
 * o app dela vê a marca, apaga o próprio conteúdo, começa um teste novo e limpa a marca.
 */
export async function marcarParaZerar(uid) {
  if (!uid) return
  await setDoc(doc(db, 'acessos', uid), { zerar: true, desde: null }, { merge: true }).catch(() => {})
}

/** Limpa a marca e recomeça a contagem do teste — chamado pelo app de quem foi zerado. */
export async function concluirZeragem() {
  const user = auth.currentUser
  if (!user) return
  await setDoc(doc(db, 'acessos', user.uid), { zerar: false, desde: new Date().toISOString() }, { merge: true }).catch(() => {})
}

export async function apagarAcesso(uid) {
  await deleteDoc(doc(db, 'acessos', uid)).catch(() => {})
}

/* ---------------- quem é quem ---------------- */

/**
 * Descobre o papel de quem está logado. Devolve também `contaDeDados`: o espaço cujas
 * propostas a pessoa vai ver. Para todo mundo é o próprio espaço; só o colaborador aponta
 * para o espaço da dona — é isso que faz ele cair direto nas propostas dela.
 */
export function resolverPapel({ config, user, acesso }) {
  const email = normalizarEmail(user?.email)
  const principal = normalizarEmail(config.suporte?.emailPrincipal || EMAIL_PRINCIPAL_PADRAO)
  const colaboradores = (config.suporte?.colaboradores || []).map(normalizarEmail)
  const autorizados = (config.autorizados || []).map((a) => normalizarEmail(a.email))
  const excluidos = (config.excluidos || []).map((a) => normalizarEmail(a.email))

  if (email && email === principal) {
    return { papel: 'dono', email, contaDeDados: user.uid, podeEditar: true }
  }
  if (excluidos.includes(email)) {
    return { papel: 'excluido', email, contaDeDados: user.uid, podeEditar: false }
  }
  if (colaboradores.includes(email)) {
    return { papel: 'colaborador', email, contaDeDados: config.donoUid || user.uid, podeEditar: true }
  }
  if (autorizados.includes(email)) {
    return { papel: 'autorizado', email, contaDeDados: user.uid, podeEditar: true }
  }

  // ninguém na lista: é um teste. A contagem começa no primeiro login registrado.
  const dias = Number(config.suporte?.diasTeste) || 30
  const desde = acesso?.desde ? new Date(acesso.desde) : new Date()
  const fim = new Date(desde.getTime() + dias * 24 * 60 * 60 * 1000)
  const diasRestantes = Math.ceil((fim.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
  return {
    papel: 'teste',
    email,
    contaDeDados: user.uid,
    podeEditar: diasRestantes > 0,
    diasRestantes,
    fimDoTeste: fim.toISOString(),
    vencido: diasRestantes <= 0,
  }
}

/** Separa uma colagem de e-mails (vírgula, ponto e vírgula, espaço ou linha) numa lista limpa. */
export function separarEmails(texto) {
  return [...new Set(
    String(texto || '')
      .split(/[\s,;]+/)
      .map(normalizarEmail)
      .filter((e) => e.includes('@')),
  )]
}
