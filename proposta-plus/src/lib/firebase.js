import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
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
export const db = getFirestore(app)
export const storage = getStorage(app)
export const googleProvider = new GoogleAuthProvider()
