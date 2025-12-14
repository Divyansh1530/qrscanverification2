import React, { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

import {
  collection,
  query,
  where,
  getDocs,
  updateDoc,
  doc,
} from "firebase/firestore";
import { db } from "../firebase";
import { runTransaction } from "firebase/firestore";



const verifyQRToken = async (token) => {
  try {
    const q = query(
      collection(db, "qrTokens"),
      where("token", "==", token)
    );

    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      return { status: "invalid" };
    }

    const qrDocRef = snapshot.docs[0].ref;

    return await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(qrDocRef);

      if (!snap.exists()) {
        return { status: "invalid" };
      }

      const data = snap.data();

      if (data.used === true) {
        return { status: "used" };
      }

      // ✅ READ + WRITE TOGETHER (ATOMIC)
      transaction.update(qrDocRef, {
        used: true,
        usedAt: new Date(),
      });

      return {
        status: "success",
        data,
      };
    });
  } catch (err) {
    console.error(err);
    return { status: "error" };
  }
};



/**
 * Helper to safely parse JSON from localStorage
 */



export default function QRPaymentVerifier() {
const scanLockedRef = useRef(false);

  // initialize state from localStorage
  const [students, setStudents] = useState([]);

  const [scanTable, setScanTable] = useState([])

  // UI state
  const [result, setResult] = useState(null);
  const [supportMsg, setSupportMsg] = useState("");
  const [scanData, setScanData] = useState(null);

  // refs for camera
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const scanTimer = useRef(null);
  const detector = useRef(null);
  const parseCSV = (text) => {
  return text
    .split(/\r?\n/)
    .map(r => r.trim())
    .filter(Boolean)
    .slice(1)
    .map(r => {
      const [phone, name] = r.split(",");
      return {
        phone: (phone || "").replace(/\D/g, ""),
        name: (name || "").trim(),
      };
    });
};


  
  /* ---------- process scanned value ---------- */
const processScan = async (raw) => {
  if (scanLockedRef.current) return;
  scanLockedRef.current = true;

  stopCamera();

  const token = String(raw || "").trim();
  if (!token) return;

  const res = await verifyQRToken(token);

  if (res.status === "invalid") {
    setResult({ type: "notpaid", msg: "INVALID QR" });
  } else if (res.status === "used") {
    setResult({ type: "used", msg: "QR ALREADY USED" });
  } else {
    setScanTable((prev) => [
      ...prev,
      {
        id: prev.length + 1,
        enrollment: res.data.contact,
        examDate: res.data.examDate,
        session: res.data.tripType,
        time: new Date().toLocaleString(),
      },
    ]);

    setResult({
      type: "paid",
      msg: "ENTRY ALLOWED",
      rec: { enrollment: res.data.contact },
      examDate: res.data.examDate,
      session: res.data.tripType,
      when: new Date().toISOString(),
    });
  }

  // ✅ unlock for NEXT student (but DO NOT restart camera)
  setTimeout(() => {
    scanLockedRef.current = false;
  }, 1500);
};







  /* ---------- scanning (camera) ---------- */
  const initDetector = async () => {
    if ("BarcodeDetector" in window) {
      try {
        detector.current = new BarcodeDetector({ formats: ["qr_code"] });
        setSupportMsg("Native BarcodeDetector available");
        return;
      } catch (e) {
        detector.current = null;
      }
    }
    detector.current = null;
    setSupportMsg("Using jsQR fallback (works in most browsers)");
  };

  const startCamera = async () => {
    console.log("startCamera called");

    scanLockedRef.current = false;


    await initDetector();

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setSupportMsg(
        "Camera API unavailable. Open app over HTTPS and use Chrome/Edge."
      );
      alert(
        "Camera API unavailable. Open app over HTTPS and use Chrome/Edge."
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      if (scanTimer.current) clearInterval(scanTimer.current);
      scanTimer.current = setInterval(() => {
        scanFrame().catch((e) => console.warn("scanFrame failed", e));
      }, 300);
      setSupportMsg("Camera started");
    } catch (e) {
      console.warn("startCamera failed", e);
      setSupportMsg(
        "Camera permission denied or device error: " + (e.message || e)
      );
      alert("Camera permission denied or device error: " + (e.message || e));
    }
  };

  const stopCamera = () => {
    if (scanTimer.current) {
      clearInterval(scanTimer.current);
      scanTimer.current = null;
    }
    if (streamRef.current) {
      try {
        streamRef.current.getTracks().forEach((t) => t.stop());
      } catch (e) {}
      streamRef.current = null;
    }
    if (videoRef.current) {
      try {
        videoRef.current.pause();
        videoRef.current.srcObject = null;
      } catch (e) {}
    }
    setSupportMsg("Camera stopped");
  };

 const scanFrame = async () => {
  console.log("scanFrame running");

  if (scanLockedRef.current) return;
  if (!videoRef.current || !videoRef.current.videoWidth) return;

  // Native detector
  if (detector.current) {
    try {
      const codes = await detector.current.detect(videoRef.current);
      if (codes && codes.length) {
        scanLockedRef.current = true;     // 🔒 LOCK
        clearInterval(scanTimer.current); // ⛔ STOP LOOP IMMEDIATELY
        scanTimer.current = null;
        console.log("QR DETECTED:", codes[0].rawValue);
        console.log("QR DETECTED:", code.data);

console.log("QR RAW VALUE:", code.data);

        processScan(codes[0].rawValue);
      }
      return;
    } catch {}
  }

  // jsQR fallback
  const video = videoRef.current;
  const canvas = canvasRef.current;
  const ctx = canvas.getContext("2d");

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  ctx.drawImage(video, 0, 0);

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const code = jsQR(img.data, img.width, img.height);

  if (code?.data) {
     console.log("QR DETECTED RAW:", JSON.stringify(code.data));
    scanLockedRef.current = true;         // 🔒 LOCK
    clearInterval(scanTimer.current);     // ⛔ STOP LOOP IMMEDIATELY
    scanTimer.current = null;
    processScan(code.data);
  }
};


  /* ---------- export used ---------- */
 const exportUsed = () => {
  alert("Export will be added later from Firebase");
};


  /* ---------- UI ---------- */
  return (
    <div
    
      style={{
        maxWidth: 900,
        margin: "8px auto",
        padding: "8px 12px 16px",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        background: "#f3f4f6",
      }}
    >
    

      {/* Header */}
      
      <header
        style={{
          marginBottom: 10,
          textAlign: "center",
        }}
      >
        <h1 style={{ fontSize: 22, margin: 0 }}>Exam Bus QR Scanner</h1>
      </header>

        <textarea id="csvInput" placeholder="phone,name" />
<button
  onClick={() => {
    const txt = document.getElementById("csvInput").value;
    setStudents(parseCSV(txt));
  }}
>
  Load CSV
</button>
      {/* TOP ROW: Load + Scanner stacked on mobile */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        
        {/* Scanner Card */}
        <section
          style={{
            flex: 1,
            minWidth: 260,
            borderRadius: 12,
            background: "#ffffff",
            padding: 12,
            boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 6,
              alignItems: "center",
              marginBottom: 8,
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 15 }}>
              2. Scan QR Code
            </div>
            
          </div>

          <div style={{ marginBottom: 8 }}>
            <video
              ref={videoRef}
              style={{
                width: "100%",
                borderRadius: 10,
                background: "#000",
                maxHeight: 260,
                objectFit: "cover",
              }}
              playsInline
            />
            <canvas ref={canvasRef} style={{ display: "none" }} />
          </div>

          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              marginBottom: 6,
            }}
          >
            <button
              onClick={startCamera}
              style={{
                flex: 1,
                minWidth: 140,
                padding: "10px 10px",
                borderRadius: 999,
                border: "none",
                background: "#16a34a",
                color: "#fff",
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              ▶ Start Camera
            </button>
            <button
              onClick={stopCamera}
              style={{
                flex: 1,
                minWidth: 100,
                padding: "10px 10px",
                borderRadius: 999,
                border: "1px solid #e5e7eb",
                background: "#f9fafb",
                color: "#111827",
                fontSize: 14,
                fontWeight: 500,
              }}
            >
              ⏹ Stop
            </button>
          </div>

          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              marginBottom: 8,
            }}
          >
            <button
              onClick={() => {
                const v = prompt("Paste QR value:");
                if (v) processScan(v);
              }}
              style={{
                flex: 1,
                minWidth: 140,
                padding: "8px 10px",
                borderRadius: 999,
                border: "1px solid #e5e7eb",
                background: "#ffffff",
                fontSize: 13,
              }}
            >
              Paste QR Manually
            </button>
            <button
              onClick={exportUsed}
              style={{
                flex: 1,
                minWidth: 140,
                padding: "8px 10px",
                borderRadius: 999,
                border: "none",
                background: "#0f766e",
                color: "#fff",
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              Export Used CSV
            </button>
          </div>

          <div
            style={{
              fontSize: 11,
              color: "#6b7280",
              minHeight: 16,
            }}
          >
            {supportMsg}
          </div>
        </section>
      </div>

      {/* Result & Scanned Data */}
      {result && (
        <section
          style={{
            marginTop: 10,
            borderRadius: 12,
            background: "#ffffff",
            padding: 10,
            boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
          }}
        >
          {result.type === "paid" && (
            <div
              style={{
                borderLeft: "4px solid #16a34a",
                paddingLeft: 10,
                color: "#065f46",
                fontSize: 14,
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 2 }}>
                ✅ {result.msg}
              </div>
              <div>Contact: {result.rec?.enrollment}</div>
              <div>Name: {result.rec?.name}</div>
              {result.examDate && <div>Date: {result.examDate}</div>}
              {result.session && <div>Session: {result.session}</div>}
              <div>
                Time: {new Date(result.when).toLocaleTimeString()}{" "}
                {new Date(result.when).toLocaleDateString()}
              </div>
            </div>
          )}
          {result.type === "used" && (
            <div
              style={{
                borderLeft: "4px solid #f97316",
                paddingLeft: 10,
                color: "#7c2d12",
                fontSize: 14,
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 2 }}>
                ⚠ {result.msg}
              </div>
              {result.examDate && <div>Date: {result.examDate}</div>}
              {result.session && <div>Session: {result.session}</div>}
              <div>
                Already Used: {new Date(result.when).toLocaleTimeString()}{" "}
                {new Date(result.when).toLocaleDateString()}
              </div>
            </div>
          )}
          {result.type === "notpaid" && (
            <div
              style={{
                borderLeft: "4px solid #dc2626",
                paddingLeft: 10,
                color: "#7f1d1d",
                fontSize: 14,
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 2 }}>
                ❌ {result.msg}
              </div>
              <div>Scanned: {result.raw}</div>
            </div>
          )}
          {result.type === "info" && (
            <div
              style={{
                borderLeft: "4px solid #6b7280",
                paddingLeft: 10,
                color: "#374151",
                fontSize: 14,
              }}
            >
              {result.msg}
            </div>
          )}
        </section>
      )}

      {scanData && (
        <section
          style={{
            marginTop: 8,
            borderRadius: 12,
            background: "#ecfeff",
            padding: 10,
            border: "1px solid #bae6fd",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4, fontSize: 14 }}>
            Last Scanned
          </div>
          <div style={{ fontSize: 13 }}>
            <div>Contact: {scanData.enrollment}</div>
            <div>Name: {scanData.name}</div>
            
            {scanData.examDate && <div>Date of Exam: {scanData.examDate}</div>}
            {scanData.session && <div>Session: {scanData.session}</div>}
          </div>
        </section>
      )}

      {/* Table */}
      <section
        style={{
          marginTop: 10,
          borderRadius: 12,
          background: "#ffffff",
          padding: 10,
          boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
        }}
      >
        <div
          style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 6,
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 15 }}>
            3. Scanned Entries ({scanTable.length})
          </div>
          <button
            onClick={() => {
              if (confirm("Clear scanned table?")) setScanTable([]);
            }}
            style={{
              padding: "6px 10px",
              borderRadius: 999,
              border: "none",
              background: "#dc2626",
              color: "#fff",
              fontSize: 12,
              fontWeight: 500,
            }}
          >
            Clear Table
          </button>
        </div>

        <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>
          Scroll horizontally on phone to see all columns.
        </div>

        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 12,
            }}
          >
            <thead style={{ background: "#f3f4f6" }}>
              <tr>
                <th style={{ border: "1px solid #e5e7eb", padding: 6 }}>#</th>
                <th style={{ border: "1px solid #e5e7eb", padding: 6 }}>
                  Contact
                </th>
                <th style={{ border: "1px solid #e5e7eb", padding: 6 }}>
                  Name
                </th>
                <th style={{ border: "1px solid #e5e7eb", padding: 6 }}>
                  Semester
                </th>
                <th style={{ border: "1px solid #e5e7eb", padding: 6 }}>
                  Date
                </th>
                <th style={{ border: "1px solid #e5e7eb", padding: 6 }}>
                  Session
                </th>
                <th style={{ border: "1px solid #e5e7eb", padding: 6 }}>
                  Time
                </th>
              </tr>
            </thead>
            <tbody>
              {scanTable.map((r) => (
                <tr key={r.id}>
                  <td
                    style={{
                      border: "1px solid #e5e7eb",
                      padding: 6,
                      textAlign: "center",
                    }}
                  >
                    {r.id}
                  </td>
                  <td style={{ border: "1px solid #e5e7eb", padding: 6 }}>
                    {r.enrollment}
                  </td>
                  <td style={{ border: "1px solid #e5e7eb", padding: 6 }}>
                    {r.name}
                  </td>
                  <td style={{ border: "1px solid #e5e7eb", padding: 6 }}>
                    {r.phone}
                  </td>
                  <td style={{ border: "1px solid #e5e7eb", padding: 6 }}>
                    {r.examDate || "-"}
                  </td>
                  <td style={{ border: "1px solid #e5e7eb", padding: 6 }}>
                    {r.session || "-"}
                  </td>
                  <td style={{ border: "1px solid #e5e7eb", padding: 6 }}>
                    {r.time}
                  </td>
                </tr>
              ))}
              {scanTable.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    style={{
                      textAlign: "center",
                      padding: 8,
                      color: "#9ca3af",
                    }}
                  >
                    No scans yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
