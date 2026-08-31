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
  collection, getDocs, query, orderBy,
  serverTimestamp, addDoc, updateDoc,
} from 'firebase/firestore'
import { auth, db, googleProvider } from './firebase'
import { defaultFieldsObject } from './fields'

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

function requireUid() {
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
  return snap.exists() ? { id: snap.id, ...snap.data() } : null
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

export async function deleteProposal(id) {
  const uid = requireUid()
  await deleteDoc(doc(db, 'users', uid, 'proposals', id))
}

/* ---------------- CONFIGURAÇÕES DA EMPRESA ---------------- */

export async function getSettings() {
  const uid = requireUid()
  const snap = await getDoc(doc(db, 'users', uid))
  const data = snap.exists() ? snap.data() : {}
  return {
    companyName: '', professionalName: '', registration: '', bio: '',
    city: '', logoDataUrl: '', instagram: '', whatsapp: '',
    ...(data.settings || {}),
  }
}

export async function saveSettings(settings) {
  const uid = requireUid()
  await setDoc(doc(db, 'users', uid), { settings }, { merge: true })
  return settings
}

/* ---------------- CONTEÚDO DO MODELO (textos + imagens padrão) ---------------- */

export async function getTemplateContent() {
  const uid = requireUid()
  const snap = await getDoc(doc(db, 'users', uid))
  const data = snap.exists() ? snap.data() : {}
  return data.content || null // null = usar os padrões definidos em lib/content.js
}

export async function saveTemplateContent(content) {
  const uid = requireUid()
  await setDoc(doc(db, 'users', uid), { content }, { merge: true })
  return content
}
