/**
 * CAMADA DE DADOS DO PROPOSTA+ — agora usando Firebase de verdade.
 * Login e todas as propostas ficam salvos na nuvem (Firestore) e
 * sincronizam automaticamente em qualquer computador ou celular
 * onde a pessoa entrar com o mesmo email.
 *
 * Todas as outras telas do app (Dashboard, Editor, Presenter, Settings)
 * continuam chamando essas mesmas funções — nada mudou para elas.
 */
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  updateProfile,
} from 'firebase/auth'
import {
  doc, getDoc, setDoc, deleteDoc,
  collection, getDocs, query, orderBy, limit, getCountFromServer,
  serverTimestamp, addDoc, updateDoc,
} from 'firebase/firestore'
import { auth, db, googleProvider, storage } from './firebase'
import { defaultFieldsObject } from './fields'
import { ref, uploadBytesResumable, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'

let cachedUser = null

/* ---------------- AUTENTICAÇÃO ---------------- */

/** Chame isso uma vez, no início do app, para saber se já existe uma sessão ativa. */
export function subscribeAuth(callback) {
  return onAuthStateChanged(auth, (firebaseUser) => {
    cachedUser = firebaseUser ? { uid: firebaseUser.uid, email: firebaseUser.email, name: firebaseUser.displayName } : null
    callback(cachedUser)
  })
}

export function getCurrentUser() {
  return cachedUser
}

async function ensureUserDoc(uid, extra = {}) {
  const ref = doc(db, 'users', uid)
  const snap = await getDoc(ref)
  if (!snap.exists()) {
    await setDoc(ref, {
      settings: {
        companyName: '', professionalName: '', registration: '', bio: '',
        city: '', logoDataUrl: '', instagram: '', whatsapp: '', ...extra,
      },
      content: null,
    })
  }
}

export async function signUp(email, password, name) {
  const cred = await createUserWithEmailAndPassword(auth, email, password)
  if (name) await updateProfile(cred.user, { displayName: name })
  await ensureUserDoc(cred.user.uid, { professionalName: name || '' })
  cachedUser = { uid: cred.user.uid, email: cred.user.email, name }
  return cachedUser
}

export async function signIn(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password)
  cachedUser = { uid: cred.user.uid, email: cred.user.email, name: cred.user.displayName }
  return cachedUser
}

export async function signInWithGoogle() {
  const cred = await signInWithPopup(auth, googleProvider)
  await ensureUserDoc(cred.user.uid, { professionalName: cred.user.displayName || '' })
  cachedUser = { uid: cred.user.uid, email: cred.user.email, name: cred.user.displayName }
  return cachedUser
}

export async function signOutUser() {
  await signOut(auth)
  cachedUser = null
}

/**
 * Espaço de dados em uso. Normalmente é o da própria pessoa; só o colaborador aponta para o
 * espaço da dona — é isso que faz ele cair direto nas propostas dela, sem tela de escolha.
 * Definido uma vez no login (ver App.jsx) e usado por todas as leituras e gravações.
 */
let contaDeTrabalho = null

export function definirContaDeTrabalho(uid) {
  contaDeTrabalho = uid || null
}

function requireUid() {
  if (contaDeTrabalho) return contaDeTrabalho
  if (!cachedUser) throw new Error('Nenhum usuário autenticado.')
  return cachedUser.uid
}

/* ---------------- PROPOSTAS ---------------- */

export async function listProposals() {
  const uid = requireUid()
  const q = query(collection(db, 'users', uid, 'proposals'), orderBy('updatedAt', 'desc'))
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

export async function getProposal(id) {
  const uid = requireUid()
  const snap = await getDoc(doc(db, 'users', uid, 'proposals', id))
  if (!snap.exists()) return null
  return hydrateMediaRefs(uid, id, { id: snap.id, ...snap.data() })
}

/**
 * Igual à de cima, mas SEM baixar as fotos: devolve a proposta com as referências curtas
 * intactas. É o que a apresentação usa — ela pede cada foto separadamente, só do slide que
 * está na tela (ver lib/media.js). Abrir uma proposta deixou de baixar dezenas de MB de uma vez.
 */
export async function getProposalRaw(id) {
  const uid = requireUid()
  const snap = await getDoc(doc(db, 'users', uid, 'proposals', id))
  if (!snap.exists()) return null
  return { id: snap.id, ...snap.data() }
}

export async function getTemplateContentRaw() {
  const uid = requireUid()
  const snap = await getDoc(doc(db, 'users', uid))
  const data = snap.exists() ? snap.data() : {}
  return data.content || null
}

export async function getPublicProposalRaw(uid, id) {
  const snap = await getDoc(doc(db, 'users', uid, 'proposals', id))
  if (!snap.exists()) return null
  return { id: snap.id, ...snap.data() }
}

export async function getPublicTemplateContentRaw(uid) {
  const snap = await getDoc(doc(db, 'users', uid))
  return snap.exists() ? (snap.data().content || {}) : {}
}

/** Busca UMA foto pela referência curta. Usada pelo carregamento sob demanda. */
export async function fetchMediaByRef(ref, { uid, proposalId }) {
  const conta = uid || requireUid()
  try {
    if (ref.startsWith(SHARED_MEDIA_PREFIX)) {
      const snap = await getDoc(doc(db, 'users', conta, 'media', ref.slice(SHARED_MEDIA_PREFIX.length)))
      return snap.exists() ? snap.data().dataUrl : ''
    }
    if (ref.startsWith(MEDIA_PREFIX)) {
      if (!proposalId) return ''
      const snap = await getDoc(doc(db, 'users', conta, 'proposals', proposalId, 'media', ref.slice(MEDIA_PREFIX.length)))
      return snap.exists() ? snap.data().dataUrl : ''
    }
  } catch { /* sem permissão ou offline: devolve vazio em vez de quebrar a tela */ }
  return ''
}

export async function saveProposal(proposal) {
  const uid = requireUid()
  const { id, ...data } = proposal
  if (id) {
    const ref = doc(db, 'users', uid, 'proposals', id)
    await updateDoc(ref, { ...data, updatedAt: serverTimestamp() })
    const snap = await getDoc(ref)
    return { id: snap.id, ...snap.data() }
  }
  const ref = await addDoc(collection(db, 'users', uid, 'proposals'), {
    ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  })
  const snap = await getDoc(ref)
  return { id: snap.id, ...snap.data() }
}

/**
 * Apaga a proposta E as fotos dela.
 *
 * No Firestore, apagar um documento NÃO apaga as coleções penduradas nele: as fotos ficavam
 * em proposals/{id}/media sem nenhuma proposta apontando pra elas, invisíveis na tela e
 * ocupando espaço pra sempre. Por isso a subcoleção é esvaziada ANTES de apagar a proposta —
 * nessa ordem, porque depois de apagar o documento não dá mais pra chegar até as fotos.
 */
export async function deleteProposal(id) {
  const uid = requireUid()
  await apagarFotosDaProposta(uid, id)
  await deleteDoc(doc(db, 'users', uid, 'proposals', id))
}

async function apagarFotosDaProposta(uid, proposalId) {
  const snap = await getDocs(collection(db, 'users', uid, 'proposals', proposalId, 'media'))
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref).catch(() => {})))
  return snap.size
}

/**
 * Encerra uma proposta: apaga todas as fotos dela e limpa as referências, mantendo os dados
 * do projeto (cliente, valores, datas, status). A proposta vira consulta — não dá mais pra
 * apresentar nem editar, e o espaço das fotos é devolvido.
 */
export async function closeProposal(proposal) {
  const uid = requireUid()
  const apagadas = await apagarFotosDaProposta(uid, proposal.id)
  const limpo = removerReferenciasDeFoto(proposal)
  await saveProposal({ ...limpo, closed: true, closedAt: new Date().toISOString() })
  return apagadas
}

/** troca toda referência de foto (e toda foto em base64 que tenha sobrado) por vazio */
function removerReferenciasDeFoto(value) {
  if (Array.isArray(value)) return value.map(removerReferenciasDeFoto)
  if (value && typeof value === 'object' && value.constructor === Object) {
    const next = {}
    Object.keys(value).forEach((k) => { next[k] = removerReferenciasDeFoto(value[k]) })
    return next
  }
  if (typeof value === 'string' && (isMediaRef(value) || isSharedMediaRef(value) || value.startsWith('data:image'))) return ''
  return value
}

/**
 * Varredura das fotos que não são mais usadas por ninguém.
 *
 * Cobre dois casos: fotos da biblioteca da conta (users/{uid}/media) que nenhuma proposta nem
 * o conteúdo do modelo referencia mais, e fotos dentro de uma proposta que foram trocadas ou
 * removidas dos slides. Devolve quantas foram apagadas.
 *
 * O que ela NÃO alcança: fotos de propostas que já foram apagadas antes desta correção. O
 * Firestore não deixa um aplicativo listar as subcoleções de um documento que não existe
 * mais, então essas só podem ser removidas à mão no Console do Firebase (elas aparecem lá
 * como documentos em itálico dentro de "proposals").
 */
export async function limparFotosOrfas() {
  const uid = requireUid()
  const usadas = new Set()
  const anotar = (value) => {
    if (Array.isArray(value)) return value.forEach(anotar)
    if (value && typeof value === 'object' && value.constructor === Object) return Object.values(value).forEach(anotar)
    if (typeof value === 'string' && (isMediaRef(value) || isSharedMediaRef(value))) usadas.add(value)
  }

  const userSnap = await getDoc(doc(db, 'users', uid))
  anotar(userSnap.exists() ? userSnap.data().content : null)

  const propostas = await getDocs(collection(db, 'users', uid, 'proposals'))
  propostas.docs.forEach((d) => anotar(d.data()))

  let apagadas = 0

  // biblioteca da conta
  const compartilhadas = await getDocs(collection(db, 'users', uid, 'media'))
  await Promise.all(compartilhadas.docs.map(async (d) => {
    if (usadas.has(`${SHARED_MEDIA_PREFIX}${d.id}`)) return
    await deleteDoc(d.ref).catch(() => {})
    apagadas++
  }))

  // fotos dentro de cada proposta que existe
  for (const prop of propostas.docs) {
    const fotos = await getDocs(collection(db, 'users', uid, 'proposals', prop.id, 'media'))
    await Promise.all(fotos.docs.map(async (d) => {
      if (usadas.has(`${MEDIA_PREFIX}${d.id}`)) return
      await deleteDoc(d.ref).catch(() => {})
      apagadas++
    }))
  }

  return apagadas
}

/** Torna uma proposta acessível por link, sem precisar de login (o cliente vendo a apresentação). */
export async function setProposalPublic(id, isPublic) {
  const uid = requireUid()
  await updateDoc(doc(db, 'users', uid, 'proposals', id), { public: isPublic })
}

/* ---------------- LEITURA PÚBLICA (link do cliente, sem login) ----------------
 * Usadas só na página de apresentação pública. Só funcionam se a proposta tiver
 * public: true (ver setProposalPublic) — a regra de segurança do Firestore garante isso. */

export async function getPublicProposal(uid, id) {
  const snap = await getDoc(doc(db, 'users', uid, 'proposals', id))
  if (!snap.exists()) return null
  return hydrateMediaRefs(uid, id, { id: snap.id, ...snap.data() })
}

export async function getPublicSettings(uid) {
  const snap = await getDoc(doc(db, 'users', uid))
  const data = snap.exists() ? snap.data() : {}
  return { companyName: '', professionalName: '', registration: '', city: '', logoDataUrl: '', instagram: '', whatsapp: '', ...(data.settings || {}) }
}

export async function getPublicTemplateContent(uid) {
  const snap = await getDoc(doc(db, 'users', uid))
  const content = snap.exists() ? (snap.data().content || {}) : {}
  return hydrateValue(uid, null, content, new Map())
}

/* ---------------- COMPROMISSOS AVULSOS DA AGENDA (não ligados a nenhuma proposta) ---------------- */

export async function listEvents() {
  const uid = requireUid()
  const snap = await getDocs(collection(db, 'users', uid, 'events'))
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

export async function saveEvent(event) {
  const uid = requireUid()
  const { id, ...data } = event
  if (id) {
    await updateDoc(doc(db, 'users', uid, 'events', id), data)
    return { id, ...data }
  }
  const ref = await addDoc(collection(db, 'users', uid, 'events'), data)
  return { id: ref.id, ...data }
}

export async function deleteEvent(id) {
  const uid = requireUid()
  await deleteDoc(doc(db, 'users', uid, 'events', id))
}

/* ---------------- VÍDEO (Firebase Storage — sem limite prático de tamanho, ao contrário do Firestore) ---------------- */

/**
 * Envia um vídeo para o Firebase Storage (não para o Firestore, que tem limite de 1MB
 * por documento — era por isso que vídeos grandes travavam ou sumiam ao atualizar a página).
 * Retorna a URL final para salvar no campo videoUrl da proposta ou do slide.
 */
export function uploadVideo(file, onProgress) {
  const uid = requireUid()
  const path = `users/${uid}/videos/${Date.now()}-${file.name.replace(/[^\w.\-]/g, '_')}`
  const storageRef = ref(storage, path)
  const task = uploadBytesResumable(storageRef, file)
  return new Promise((resolve, reject) => {
    task.on(
      'state_changed',
      (snap) => onProgress?.(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
      (err) => reject(err),
      async () => {
        const url = await getDownloadURL(task.snapshot.ref)
        resolve({ url, path })
      }
    )
  })
}

export async function deleteVideo(path) {
  if (!path) return
  try { await deleteObject(ref(storage, path)) } catch { /* já pode ter sido removido — ignora */ }
}

/* ---------------- IMAGENS (sem usar o Firebase Storage, que só está no plano pago) ----------------
 * Em vez de embutir a foto (base64) direto no documento da proposta — o que estourava o limite
 * de 1MB por documento do Firestore quando havia várias fotos, e fazia o salvamento falhar
 * silenciosamente — cada foto vira um DOCUMENTO SEPARADO, pequeno, numa subcoleção da própria
 * proposta ("media"). O documento principal da proposta guarda só uma referência curta
 * (ex: "firestoremedia://abc123"), nunca a foto em si — então ele nunca mais fica grande demais.
 * O Firestore no plano gratuito não cobra nem limita a QUANTIDADE de documentos, só o tamanho
 * de cada um — por isso isso resolve o problema sem precisar do Storage (que é pago). */

const MEDIA_PREFIX = 'firestoremedia://'
/* Fotos que valem para VÁRIAS propostas (uma tipologia inteira, ou todas) não podem morar
 * dentro da subcoleção de uma proposta — se a proposta for apagada, ou se outra proposta
 * precisar da mesma foto, a referência quebra. Por isso existe uma segunda biblioteca, da
 * CONTA inteira (users/{uid}/media), usada pelo "conteúdo do modelo". */
const SHARED_MEDIA_PREFIX = 'sharedmedia://'

/** Comprime (no navegador) e salva uma foto como um novo documento na subcoleção "media" da
 *  proposta, e devolve a referência curta que deve ser guardada no lugar da foto (em
 *  slideOverrides, feedbacks, etc). A referência é sempre resolvida de volta pra foto de
 *  verdade automaticamente ao carregar a proposta (ver hydrateMediaRefs). */
export async function saveImageAsMedia(proposalId, dataUrl) {
  const uid = requireUid()
  // ~1MB é o limite por documento do Firestore; a foto (base64) fica bem abaixo disso graças
  // à compressão feita antes de chamar essa função — isso aqui é só uma trava de segurança
  if (dataUrl.length > 900000) {
    throw new Error('Imagem grande demais mesmo depois de comprimida — tente uma foto menor.')
  }
  const colRef = collection(db, 'users', uid, 'proposals', proposalId, 'media')
  const docRef = await addDoc(colRef, { dataUrl, createdAt: serverTimestamp() })
  return `${MEDIA_PREFIX}${docRef.id}`
}

/** Igual à de cima, mas guarda a foto na biblioteca da CONTA (users/{uid}/media) em vez de
 *  dentro de uma proposta — é assim que uma mesma imagem pode aparecer em várias propostas
 *  (de uma tipologia, ou de todas) sem precisar ser reenviada em cada uma. */
export async function saveSharedImage(dataUrl) {
  const uid = requireUid()
  if (dataUrl.length > 900000) {
    throw new Error('Imagem grande demais mesmo depois de comprimida — tente uma foto menor.')
  }
  const colRef = collection(db, 'users', uid, 'media')
  const docRef = await addDoc(colRef, { dataUrl, createdAt: serverTimestamp() })
  return `${SHARED_MEDIA_PREFIX}${docRef.id}`
}

/** Percorre um objeto trocando toda foto em base64 por uma referência curta da biblioteca
 *  da conta. Usada antes de gravar o conteúdo do modelo, que fica no documento do usuário
 *  (e, como qualquer documento do Firestore, não pode passar de 1MB). */
async function replaceDataUrlsWithSharedMedia(value) {
  if (Array.isArray(value)) return Promise.all(value.map(replaceDataUrlsWithSharedMedia))
  if (value && typeof value === 'object' && value.constructor === Object) {
    const keys = Object.keys(value)
    const resolved = await Promise.all(keys.map((k) => replaceDataUrlsWithSharedMedia(value[k])))
    const next = { ...value }
    keys.forEach((k, i) => { next[k] = resolved[i] })
    return next
  }
  if (typeof value === 'string' && value.startsWith('data:image')) return saveSharedImage(value)
  return value
}

function isMediaRef(v) {
  return typeof v === 'string' && v.startsWith(MEDIA_PREFIX)
}

function isSharedMediaRef(v) {
  return typeof v === 'string' && v.startsWith(SHARED_MEDIA_PREFIX)
}

/** Percorre um objeto/array (recursivamente) trocando toda referência "firestoremedia://..."
 *  pela foto de verdade (buscada na subcoleção "media"), com cache pra nunca buscar a mesma
 *  foto duas vezes numa mesma chamada. Usada ao carregar a proposta, pra o resto do app nunca
 *  precisar saber que essa camada existe — ele recebe a foto pronta, como sempre recebeu. */
async function hydrateValue(uid, proposalId, value, cache) {
  if (Array.isArray(value)) {
    return Promise.all(value.map((v) => hydrateValue(uid, proposalId, v, cache)))
  }
  // só entra em objetos "comuns" (literais) — um Timestamp do Firestore (createdAt/updatedAt)
  // também é um objeto, mas não deve ser desmontado feito um {toDate, seconds, ...} qualquer,
  // senão vira um objeto comum e quebra quem espera um Timestamp de verdade (ex: .toDate())
  if (value && typeof value === 'object' && value.constructor === Object) {
    const keys = Object.keys(value)
    const resolved = await Promise.all(keys.map((k) => hydrateValue(uid, proposalId, value[k], cache)))
    const next = { ...value }
    keys.forEach((k, i) => { next[k] = resolved[i] })
    return next
  }
  if (isSharedMediaRef(value)) {
    const mediaId = value.slice(SHARED_MEDIA_PREFIX.length)
    const key = `shared:${mediaId}`
    if (cache.has(key)) return cache.get(key)
    try {
      const snap = await getDoc(doc(db, 'users', uid, 'media', mediaId))
      const dataUrl = snap.exists() ? snap.data().dataUrl : ''
      cache.set(key, dataUrl)
      return dataUrl
    } catch {
      return ''
    }
  }
  if (isMediaRef(value)) {
    if (!proposalId) return '' // ref de proposta encontrada fora de uma proposta — não há onde buscar
    const mediaId = value.slice(MEDIA_PREFIX.length)
    if (cache.has(mediaId)) return cache.get(mediaId)
    try {
      const snap = await getDoc(doc(db, 'users', uid, 'proposals', proposalId, 'media', mediaId))
      const dataUrl = snap.exists() ? snap.data().dataUrl : ''
      cache.set(mediaId, dataUrl)
      return dataUrl
    } catch {
      return '' // se não conseguir buscar (ex: sem permissão), some a foto em vez de quebrar a tela
    }
  }
  return value
}

async function hydrateMediaRefs(uid, proposalId, proposalData) {
  return hydrateValue(uid, proposalId, proposalData, new Map())
}

/* ---------------- CONFIGURAÇÕES DA EMPRESA ---------------- */

export async function getSettings() {
  const uid = requireUid()
  const snap = await getDoc(doc(db, 'users', uid))
  const data = snap.exists() ? snap.data() : {}
  return {
    companyName: '', professionalName: '', registration: '', bio: '',
    city: '', logoDataUrl: '', instagram: '', whatsapp: '',
    savedSwatches: [], savedPalettes: [],
    ...(data.settings || {}),
  }
}

export async function saveSettings(settings) {
  const uid = requireUid()
  await setDoc(doc(db, 'users', uid), { settings }, { merge: true })
  return settings
}

/** Adiciona uma cor à cesta de cores salvas (quadradinhos), sem duplicar */
export async function addSavedSwatch(hex) {
  const settings = await getSettings()
  const set = new Set(settings.savedSwatches || [])
  set.add(hex.toUpperCase())
  const next = { ...settings, savedSwatches: [...set].slice(-24) }
  return saveSettings(next)
}

/** Salva a paleta atual (3 cores) como um modelo nomeado, reutilizável em qualquer proposta */
export async function addSavedPalette(name, palette) {
  const settings = await getSettings()
  const list = [...(settings.savedPalettes || []), { id: Date.now().toString(), name, palette }]
  const next = { ...settings, savedPalettes: list }
  await saveSettings(next)
  return next
}

export async function removeSavedPalette(paletteId) {
  const settings = await getSettings()
  const next = { ...settings, savedPalettes: (settings.savedPalettes || []).filter((p) => p.id !== paletteId) }
  await saveSettings(next)
  return next
}

/* ---------------- CONTEÚDO DO MODELO (textos + imagens padrão) ---------------- */

export async function getTemplateContent() {
  const uid = requireUid()
  const snap = await getDoc(doc(db, 'users', uid))
  const data = snap.exists() ? snap.data() : {}
  if (!data.content) return null // null = usar os padrões definidos em lib/content.js
  // troca as referências curtas de volta pelas fotos de verdade (biblioteca da conta)
  return hydrateValue(uid, null, data.content, new Map())
}

export async function saveTemplateContent(content) {
  const uid = requireUid()
  const toSave = await replaceDataUrlsWithSharedMedia(content)
  await setDoc(doc(db, 'users', uid), { content: toSave }, { merge: true })
  // devolve a versão com as fotos de verdade, pra tela continuar mostrando na hora
  return content
}


/**
 * Apaga TUDO do espaço de quem está logado: propostas (com as fotos), agenda, biblioteca de
 * imagens da conta e o conteúdo/configurações.
 *
 * Quem executa é o aplicativo da própria pessoa, não o da administradora — ela nunca recebe
 * permissão de leitura sobre os dados de ninguém, e é isso que sustenta a promessa de que
 * cada conta é um espaço isolado. Por isso a limpeza acontece no login seguinte de quem foi
 * marcado, e não no momento em que a administradora clica.
 */
export async function apagarTodosOsDadosDaConta() {
  const uid = requireUid()

  const propostas = await getDocs(collection(db, 'users', uid, 'proposals'))
  for (const prop of propostas.docs) {
    await apagarFotosDaProposta(uid, prop.id)
    await deleteDoc(prop.ref).catch(() => {})
  }

  const biblioteca = await getDocs(collection(db, 'users', uid, 'media'))
  await Promise.all(biblioteca.docs.map((d) => deleteDoc(d.ref).catch(() => {})))

  const eventos = await getDocs(collection(db, 'users', uid, 'events'))
  await Promise.all(eventos.docs.map((d) => deleteDoc(d.ref).catch(() => {})))

  await setDoc(doc(db, 'users', uid), { content: null, settings: null }, { merge: true }).catch(() => {})
}


/**
 * Mede quanto espaço as fotos desta conta estão ocupando.
 *
 * O Firebase não mostra esse número no plano gratuito ("Os custos do produto não estão
 * disponíveis para o plano Spark"), e ele é justamente o limite mais apertado: 1 GiB para a
 * conta inteira.
 *
 * O jeito de contar importa muito aqui. A primeira versão pedia a coleção inteira de fotos e
 * pesava as três primeiras — só que pedir a coleção já BAIXA todas elas. Como cada foto é
 * meio megabyte de texto, a medição baixava a biblioteca inteira: travava a tela, levava
 * minutos e gastava justamente a cota que a gente quer poupar.
 *
 * Agora são duas perguntas por grupo:
 *   - getCountFromServer: quantas fotos existem, contado NO SERVIDOR, sem baixar nenhuma;
 *   - limit(amostra): baixa só duas ou três fotos, para saber o peso médio.
 *
 * O total é a contagem multiplicada por esse peso médio — uma estimativa, mas que custa
 * alguns poucos KB em vez de dezenas de MB.
 */
export async function medirEspacoUsado({ amostraPorGrupo = 3, aoProgredir } = {}) {
  const uid = requireUid()
  let falhas = 0

  // um grupo que não puder ser lido não derruba a medição inteira: é contado como falha e o
  // resto do número continua valendo
  async function pesarGrupo(ref) {
    try {
      const total = (await getCountFromServer(ref)).data().count
      if (!total) return { quantidade: 0, bytes: 0 }
      const amostra = await getDocs(query(ref, limit(amostraPorGrupo)))
      const soma = amostra.docs.reduce((acc, d) => acc + (d.data().dataUrl?.length || 0), 0)
      const media = amostra.empty ? 0 : soma / amostra.size
      return { quantidade: total, bytes: Math.round(media * total) }
    } catch (err) {
      console.error('medição: não consegui ler', ref.path, err)
      falhas++
      return { quantidade: 0, bytes: 0 }
    }
  }

  const biblioteca = await pesarGrupo(collection(db, 'users', uid, 'media'))

  const propostas = await getDocs(query(collection(db, 'users', uid, 'proposals'), orderBy('updatedAt', 'desc')))
  const porProposta = []
  let feitas = 0
  for (const prop of propostas.docs) {
    const dados = prop.data()
    const medida = await pesarGrupo(collection(db, 'users', uid, 'proposals', prop.id, 'media'))
    feitas++
    aoProgredir?.(feitas, propostas.size)
    if (medida.quantidade === 0) continue
    porProposta.push({ id: prop.id, nome: dados.name || 'Sem nome', encerrada: !!dados.closed, ...medida })
  }
  porProposta.sort((a, b) => b.bytes - a.bytes)

  const totalFotos = biblioteca.quantidade + porProposta.reduce((n, p) => n + p.quantidade, 0)
  const totalBytes = biblioteca.bytes + porProposta.reduce((n, p) => n + p.bytes, 0)

  return { biblioteca, porProposta, totalFotos, totalBytes, propostas: propostas.size, falhas, em: new Date().toISOString() }
}

/**
 * Medição do espaço rodando em segundo plano.
 *
 * A medição percorre todas as propostas e demora. Guardar o andamento aqui, num módulo, e não
 * dentro da tela, permite sair de "Suporte" e voltar depois: a medição continua e o resultado
 * está esperando. O último resultado também fica salvo no navegador por 24 horas, para não
 * precisar medir de novo (e gastar cota) só para reconferir um número que não mudou.
 */
const CHAVE_MEDICAO = 'propostaplus:medicaoEspaco'
const VALIDADE_MEDICAO_MS = 24 * 60 * 60 * 1000

let medicaoEmAndamento = null
let progressoDaMedicao = { feitas: 0, total: 0 }

export function lerProgressoMedicao() {
  return progressoDaMedicao
}

export function lerMedicaoSalva() {
  try {
    const bruto = localStorage.getItem(CHAVE_MEDICAO)
    if (!bruto) return null
    const dados = JSON.parse(bruto)
    if (!dados?.em || Date.now() - new Date(dados.em).getTime() > VALIDADE_MEDICAO_MS) return null
    return dados
  } catch { return null }
}

export function medicaoEstaRodando() {
  return !!medicaoEmAndamento
}

/** Inicia a medição, ou devolve a que já está rodando (para dois cliques não duplicarem). */
export function iniciarMedicaoEspaco(aoProgredir) {
  if (medicaoEmAndamento) return medicaoEmAndamento
  progressoDaMedicao = { feitas: 0, total: 0 }
  medicaoEmAndamento = medirEspacoUsado({
    aoProgredir: (feitas, total) => { progressoDaMedicao = { feitas, total }; aoProgredir?.(feitas, total) },
  })
    .then((dados) => {
      try { localStorage.setItem(CHAVE_MEDICAO, JSON.stringify(dados)) } catch { /* sem storage */ }
      return dados
    })
    .finally(() => { medicaoEmAndamento = null })
  return medicaoEmAndamento
}
