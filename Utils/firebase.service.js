require("dotenv").config();
const admin = require("firebase-admin");

const firebaseServiceAccount = JSON.parse(
  Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT, 'base64').toString('utf8')
)

admin.initializeApp({
  credential: admin.credential.cert(firebaseServiceAccount),
});

const db = admin.firestore();

module.exports = { db };
