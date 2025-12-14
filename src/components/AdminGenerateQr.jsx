import React, { useState } from "react";
import { collection, addDoc } from "firebase/firestore";
import { db } from "../firebase";
import { v4 as uuidv4 } from "uuid";

export default function AdminGenerateQR() {
  const [csvText, setCsvText] = useState("");
  const [status, setStatus] = useState("");

  // CHANGE EXAM DATES HERE
  const examDates = [
    "2025-12-16",
    "2025-12-18",
    "2025-12-20",
    "2025-12-22",
    "2025-12-24",
  ];

  const parseCSV = (text) => {
    return text
      .split(/\r?\n/)
      .map((r) => r.trim())
      .filter(Boolean)
      .slice(1)
      .map((row) => {
        const [phone, name, semester] = row.split(",");
        return {
          phone: phone?.replace(/\D/g, ""),
          name: name?.trim(),
          semester: semester?.trim(),
        };
      });
  };

  const generateTokens = async () => {
    try {
      setStatus("Processing...");
      const students = parseCSV(csvText);

      let count = 0;

      for (const student of students) {
        for (const examDate of examDates) {
          for (const tripType of ["going", "return"]) {
            await addDoc(collection(db, "qrTokens"), {
              token: uuidv4(),
              phone: student.phone,
              name: student.name,
              semester: student.semester,
              examDate,
              tripType,
              used: false,
              createdAt: new Date(),
            });
            count++;
          }
        }
      }

      setStatus(`✅ ${count} QR tokens generated successfully`);
    } catch (err) {
      console.error(err);
      setStatus("❌ Error generating tokens");
    }
  };

  return (
    <div style={{ padding: 20, maxWidth: 600 }}>
      <h2>Admin – Generate QR Tokens</h2>

      <p>CSV format: <b>phone,name,semester</b></p>

      <textarea
        rows={10}
        style={{ width: "100%", marginBottom: 10 }}
        placeholder="phone,name,semester"
        value={csvText}
        onChange={(e) => setCsvText(e.target.value)}
      />

      <button
        onClick={generateTokens}
        style={{
          padding: "10px 16px",
          background: "#16a34a",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          fontWeight: 600,
        }}
      >
        Generate QR Tokens
      </button>

      <div style={{ marginTop: 10 }}>{status}</div>
    </div>
  );
}
