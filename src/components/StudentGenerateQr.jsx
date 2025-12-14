import React, { useState } from "react";
import QRCode from "react-qr-code";
import {
  collection,
  query,
  where,
  getDocs,
} from "firebase/firestore";
import { db } from "../firebase";

export default function StudentGenerateQR() {
  const [phone, setPhone] = useState("");
  const [examDate, setExamDate] = useState("");
  const [tripType, setTripType] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");

  const generateQR = async () => {
    setError("");
    setToken("");

    if (!phone || !examDate || !tripType) {
      setError("Fill all fields");
      return;
    }

    try {
      const q = query(
        collection(db, "qrTokens"),
        where("phone", "==", phone),
        where("examDate", "==", examDate),
        where("tripType", "==", tripType),
        where("used", "==", false)
      );

      const snap = await getDocs(q);

      if (snap.empty) {
        setError("No valid QR available. Contact admin.");
        return;
      }

      const doc = snap.docs[0];
      setToken(doc.data().token);

    } catch (err) {
      console.error(err);
      setError("Failed to generate QR");
    }
  };

  return (
    <div style={{ maxWidth: 400, margin: "40px auto", textAlign: "center" }}>
      <h2>Generate Bus QR</h2>

      <input
        placeholder="Phone number"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        style={{ width: "100%", marginBottom: 8 }}
      />

      <input
        type="date"
        value={examDate}
        onChange={(e) => setExamDate(e.target.value)}
        style={{ width: "100%", marginBottom: 8 }}
      />

      <select
        value={tripType}
        onChange={(e) => setTripType(e.target.value)}
        style={{ width: "100%", marginBottom: 8 }}
      >
        <option value="">Select Trip</option>
        <option value="going">Going</option>
        <option value="return">Return</option>
      </select>

      <button onClick={generateQR}>Generate QR</button>

      {error && <p style={{ color: "red" }}>{error}</p>}

      {token && (
        <div style={{ marginTop: 20 }}>
          <QRCode value={token} size={200} />
          <p>Show this QR to the bus conductor</p>
        </div>
      )}
    </div>
  );
}
