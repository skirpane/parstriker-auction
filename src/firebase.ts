// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyD3k2c_0oX3C3f1nAqDRYidKYNCGJgF7I4",
  authDomain: "parstriker-auction.firebaseapp.com",
  databaseURL: "https://parstriker-auction-default-rtdb.firebaseio.com",
  projectId: "parstriker-auction",
  storageBucket: "parstriker-auction.firebasestorage.app",
  messagingSenderId: "1400458016",
  appId: "1:1400458016:web:b19f0b8d854f5a9df02545",
  measurementId: "G-K3DN5P60EC"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
