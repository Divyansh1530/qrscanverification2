import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCFJLi0T704BRFQcNj5lkDxr3YdzKv3tKM",
  authDomain: "qr-bus-system.firebaseapp.com",
  projectId: "qr-bus-system",
  storageBucket: "qr-bus-system.firebasestorage.app",
  messagingSenderId: "486735244348",
  appId: "1:486735244348:web:03af9cab52a2412bb3e739"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
