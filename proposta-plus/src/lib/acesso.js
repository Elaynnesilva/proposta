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
  botaoNome: 'Pack PreciFiqueBem',
  botaoLink: 'https://elaynnemaria.wixsite.com/arqdesign/pack-precifiquebem',
  emailPrincipal: EMAIL_PRINCIPAL_PADRAO,
  colaboradores: [],
}

export const ACESSO_PADRAO = { autorizados: [], excluidos: [], donoUid: '', suporte: SUPORTE_PADRAO }

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
      excluidos: data.excluidos || [],
      suporte: { ...SUPORTE_PADRAO, ...(data.suporte || {}) },
    }
  } catch {
    // sem permissão ou offline: devolve o padrão para o app não travar na tela de carregamento
    return { ...ACESSO_PADRAO }
  }
}

export async function salvarConfigAcesso(config) {
  await setDoc(refConfig(), config, { merge: true })
  return config
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
