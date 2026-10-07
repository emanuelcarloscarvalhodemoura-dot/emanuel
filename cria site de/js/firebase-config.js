import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';

const firebaseConfig = {
  apiKey: 'AIzaSyCensKDznssDEvMGBsfxfoP8LSq2zTFA8o',
  authDomain: 'eduspace2.firebaseapp.com',
  projectId: 'eduspace2',
  storageBucket: 'eduspace2.firebasestorage.app',
  messagingSenderId: '75488224127',
  appId: '1:75488224127:web:4d41f9d5c259070fcd304a',
  measurementId: 'G-NGFJEBSHMY'
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);




