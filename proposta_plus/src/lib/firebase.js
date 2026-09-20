import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { initializeFirestore } from 'firebase/firestore'
import { getStorage } from 'firebase/storage'

// Chaves do projeto Firebase "proposta-575f3".
// Não são secretas — é normal (e esperado) que fiquem visíveis no código do site.
const firebaseConfig = {
  apiKey: 'AIzaSyDhTqdjBsuKDKtqPENyQESes0-k91MyHC4',
  authDomain: 'proposta-575f3.firebaseapp.com',
  projectId: 'proposta-575f3',
  storageBucket: 'proposta-575f3.firebasestorage.app',
  messagingSenderId: '302008009666',
  appId: '1:302008009666:web:44af78ba3e97766578cc5b',
}

export const app = initializeApp(firebaseConfig)
export const auth = getAuth(app)
// ignoreUndefinedProperties: evita que um campo "undefined" (ex: acceptedValue ao marcar uma
// proposta como recusada) quebre o salvamento silenciosamente — era a causa do botão "Recusada" não funcionar
export const db = initializeFirestore(app, { ignoreUndefinedProperties: true })
export const storage = getStorage(app)
export const googleProvider = new GoogleAuthProvider()
