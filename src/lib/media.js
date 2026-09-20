/**
 * Carregamento das fotos SOB DEMANDA.
 *
 * Antes, abrir uma proposta baixava todas as fotos de uma vez: a proposta era lida e, junto
 * com ela, cada referência "firestoremedia://…" virava uma ida ao banco. Numa apresentação de
 * 25 fotos eram 25 downloads de algumas centenas de KB cada, mesmo que a pessoa só fosse
 * olhar os três primeiros slides — e tudo de novo na abertura seguinte, porque o navegador
 * não enxerga isso como "imagem", e sim como texto dentro de um documento.
 *
 * Agora a proposta chega com as referências intactas e quem pede a foto é a tela, slide a
 * slide. Cada foto baixada fica guardada em dois lugares:
 *   - na memória, para o resto da sessão;
 *   - no IndexedDB do navegador, para as próximas aberturas virem sem tocar no banco.
 *
 * Isso corta a transferência (a cota mais apertada do plano gratuito, junto com o espaço) e
 * o tempo de espera ao abrir uma proposta.
 */

const MEDIA_PREFIX = 'firestoremedia://'
const SHARED_MEDIA_PREFIX = 'sharedmedia://'

const DB_NOME = 'proposta-plus-fotos'
const LOJA = 'fotos'

/** cache em memória: chave da referência -> foto em base64 */
const memoria = new Map()
/** downloads em andamento, pra duas telas não baixarem a mesma foto duas vezes */
const emVoo = new Map()

export function isMediaRef(v) {
  return typeof v === 'string' && (v.startsWith(MEDIA_PREFIX) || v.startsWith(SHARED_MEDIA_PREFIX))
}

/* ---------------- cache no navegador (IndexedDB) ---------------- */

let dbPromise = null
function abrirDb() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const req = indexedDB.open(DB_NOME, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(LOJA)) db.createObjectStore(LOJA)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch { resolve(null) }
  })
  return dbPromise
}

async function lerDoCache(chave) {
  const db = await abrirDb()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const req = db.transaction(LOJA, 'readonly').objectStore(LOJA).get(chave)
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => resolve(null)
    } catch { resolve(null) }
  })
}

async function gravarNoCache(chave, dataUrl) {
  const db = await abrirDb()
  if (!db || !dataUrl) return
  try {
    db.transaction(LOJA, 'readwrite').objectStore(LOJA).put(dataUrl, chave)
  } catch { /* cache cheio ou bloqueado: segue sem cache, só fica mais lento */ }
}

/** Apaga o cache local. Usado quando o dono da conta sai — o cache é por navegador, então
 *  não faz sentido manter fotos de uma conta guardadas para a próxima pessoa que logar. */
export async function limparCacheLocal() {
  memoria.clear()
  const db = await abrirDb()
  if (!db) return
  try { db.transaction(LOJA, 'readwrite').objectStore(LOJA).clear() } catch { /* ignora */ }
}

/* ---------------- resolução das referências ---------------- */

/** chave única da foto no cache, considerando de qual conta e de qual proposta ela veio */
function chaveDe(uid, proposalId, ref) {
  if (ref.startsWith(SHARED_MEDIA_PREFIX)) return `${uid}|conta|${ref.slice(SHARED_MEDIA_PREFIX.length)}`
  return `${uid}|${proposalId}|${ref.slice(MEDIA_PREFIX.length)}`
}

/** O que já está em memória. Sem ida ao banco — é o que a tela usa a cada desenho. */
export function fotoEmCache(uid, proposalId, ref) {
  if (!isMediaRef(ref)) return ref
  return memoria.get(chaveDe(uid, proposalId, ref)) ?? null
}

/**
 * Garante que as referências pedidas estejam em memória, buscando primeiro no cache do
 * navegador e só depois no banco. Devolve true se alguma foto nova entrou (pra tela saber
 * que precisa se redesenhar).
 */
export async function carregarFotos(refs, { uid, proposalId, buscarNoBanco }) {
  const pendentes = [...new Set(refs.filter(isMediaRef))]
    .filter((ref) => !memoria.has(chaveDe(uid, proposalId, ref)))
  if (!pendentes.length) return false

  await Promise.all(pendentes.map(async (ref) => {
    const chave = chaveDe(uid, proposalId, ref)
    if (emVoo.has(chave)) return emVoo.get(chave)
    const tarefa = (async () => {
      const doCache = await lerDoCache(chave)
      if (doCache) { memoria.set(chave, doCache); return }
      const dataUrl = await buscarNoBanco(ref)
      memoria.set(chave, dataUrl || '')
      if (dataUrl) gravarNoCache(chave, dataUrl)
    })()
    emVoo.set(chave, tarefa)
    try { await tarefa } finally { emVoo.delete(chave) }
  }))
  return true
}

/** Percorre um objeto e junta todas as referências de foto que existem dentro dele. */
export function coletarRefs(value, saida = []) {
  if (Array.isArray(value)) { value.forEach((v) => coletarRefs(v, saida)); return saida }
  if (value && typeof value === 'object' && value.constructor === Object) {
    Object.values(value).forEach((v) => coletarRefs(v, saida))
    return saida
  }
  if (isMediaRef(value)) saida.push(value)
  return saida
}

/**
 * Troca as referências pelas fotos que já estão em memória. As que ainda não chegaram viram
 * string vazia — o slide desenha o espaço delas em branco e se redesenha quando a foto chega.
 */
export function aplicarFotos(value, uid, proposalId) {
  if (Array.isArray(value)) return value.map((v) => aplicarFotos(v, uid, proposalId))
  if (value && typeof value === 'object' && value.constructor === Object) {
    const next = {}
    Object.keys(value).forEach((k) => { next[k] = aplicarFotos(value[k], uid, proposalId) })
    return next
  }
  if (isMediaRef(value)) return fotoEmCache(uid, proposalId, value) ?? ''
  return value
}
