import React, { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import {
  collection,
  query,
  where,
  getDocs,
  runTransaction,
} from "firebase/firestore";
// IMPORTANT: You must ensure 'db' is correctly exported from your firebase setup file
// Example: import { db } from "../firebase";
import { db } from "../firebase"; // Assuming this path is correct

// --- 1. FIREBASE VERIFICATION LOGIC (REVISED) ---
/**
 * Verifies the QR token against Firestore, checks usage status,
 * and atomically marks it as used if it's the first scan.
 * @param {string} token - The unique token scanned from the QR code.
 * @returns {{status: 'success'|'used'|'invalid'|'error', data?: object}}
 */
const verifyQRToken = async (token) => {
  try {
    const q = query(
      collection(db, "qrTokens"),
      where("token", "==", token)
    );

    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      return { status: "invalid" }; // Token not found in database
    }

    const qrDocRef = snapshot.docs[0].ref;

    return await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(qrDocRef);

      if (!snap.exists()) {
        return { status: "invalid" }; // Should not happen if initial query passed
      }

      const data = snap.data();

      // Check the 'used' status for THIS specific token (going/returning)
      if (data.used === true) {
        return { 
            status: "used", 
            data: data // Return data for displaying when it was used
        }; 
      }

      // ✅ TOKEN IS VALID AND UNUSED: Mark as used (ATOMIC operation)
      transaction.update(qrDocRef, {
        used: true,
        usedAt: new Date().toISOString(), // Use ISO string for consistent storage
      });

      return {
        status: "success",
        data, // Return the full document data
      };
    });
  } catch (err) {
    console.error("Firebase Transaction Error:", err);
    return { status: "error", error: err.message };
  }
};


// --- 2. REACT COMPONENT (FIXED SCANNING & UI) ---

export default function QRPaymentVerifier() {
  const scanLockedRef = useRef(false);

  // State initialization
  const [scanTable, setScanTable] = useState([]);
  const [result, setResult] = useState(null);
  const [supportMsg, setSupportMsg] = useState("");

  // Refs for camera/canvas
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const scanTimer = useRef(null);
  const detector = useRef(null);
  
  // --- LIFECYCLE HOOKS ---

  // 💡 FIX 1: Cleanup hook to stop camera and interval when component unmounts
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  // --- HELPER FUNCTIONS ---

  const pauseScanning = () => {
    if (scanTimer.current) {
      clearInterval(scanTimer.current);
      scanTimer.current = null;
    }
  };

  /**
   * Main function to process the decoded token.
   */
  const processScan = async (raw) => {
    // 🔒 lock immediately
    if (scanLockedRef.current) return;
    scanLockedRef.current = true;
    
    // Clear previous result immediately for visual feedback
    setResult(null); 

    const token = String(raw || "").trim();
    if (!token) {
        // Unlock immediately if token is empty
        setTimeout(() => { scanLockedRef.current = false; }, 100);
        return;
    }

    const res = await verifyQRToken(token);
    
    // UI Update logic based on verification result
    if (res.status === "invalid") {
      setResult({ type: "notpaid", msg: "INVALID QR OR NOT FOUND", raw: token });
    } 
    else if (res.status === "used") {
      setResult({ 
        type: "used", 
        msg: "QR ALREADY USED", 
        raw: token,
        examDate: res.data.examDate, 
        session: res.data.tripType,
        usedAt: res.data.usedAt // Display when it was used
      });
    } 
    else if (res.status === "success") {
      const scanTime = new Date().toLocaleString();
      
      // Add entry to the local scan table
      setScanTable(prev => [
        {
          id: prev.length + 1,
          contact: res.data.contact,
          name: res.data.name || 'N/A', // 💡 FIX 2: Added name
          examDate: res.data.examDate,
          session: res.data.tripType,
          time: scanTime,
        },
        ...prev, // Display newest scan at the top
      ]);

      // Set success result for the UI
      setResult({
        type: "paid",
        msg: "ENTRY ALLOWED",
        raw: token,
        rec: { 
            contact: res.data.contact, 
            name: res.data.name || 'N/A', 
        }, 
        examDate: res.data.examDate,
        session: res.data.tripType,
        when: new Date().toISOString(),
      });
    } else {
        setResult({ type: "error", msg: "VERIFICATION ERROR", raw: token });
    }

    // 🔓 unlock AFTER a short delay so the user can see the result
    setTimeout(() => {
      scanLockedRef.current = false;
    }, 1500); // 1.5 seconds delay
  };


  // --- CAMERA & SCANNING LOGIC ---

  const initDetector = async () => {
    if ("BarcodeDetector" in window) {
      try {
        // Initialize native detector for better performance if available
        detector.current = new BarcodeDetector({ formats: ["qr_code"] });
        setSupportMsg("Native BarcodeDetector available (faster)");
        return;
      } catch (e) {
        detector.current = null;
      }
    }
    detector.current = null;
    setSupportMsg("Using jsQR fallback (compatible across browsers)");
  };

  const startCamera = async () => {
    pauseScanning(); // Ensure old interval is stopped
    scanLockedRef.current = false;
    await initDetector();

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setSupportMsg("Camera API unavailable. Use secure connection (HTTPS).");
      return;
    }

    try {
      // Request rear camera for scanning
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      
      // Start the scan interval loop
      scanTimer.current = setInterval(() => {
        // Use a 300ms interval (or faster like 150ms)
        scanFrame().catch((e) => console.warn("scanFrame failed", e)); 
      }, 300); 
      setSupportMsg("Camera started. Scanning...");
    } catch (e) {
      console.warn("startCamera failed", e);
      setSupportMsg(
        "Camera permission denied or device error: " + (e.message || e)
      );
    }
  };

  const stopCamera = () => {
    pauseScanning();
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

  /**
   * Scans a single frame for a QR code.
   */
  const scanFrame = async () => {
    if (scanLockedRef.current) return;
    if (!videoRef.current || !videoRef.current.videoWidth) return;

    // --- 3. FIX: Rely on lock, not interval clear ---

    // 1. Native detector (High priority)
    if (detector.current) {
      try {
        const codes = await detector.current.detect(videoRef.current);
        if (codes && codes.length) {
          // If detected, lock and process. Interval keeps running but exits on lock.
          scanLockedRef.current = true; 
          processScan(codes[0].rawValue);
        }
        return;
      } catch {}
    }

    // 2. jsQR fallback
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    // Set canvas dimensions and draw video frame
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(img.data, img.width, img.height);

    if (code?.data) {
      // If detected, lock and process. Interval keeps running but exits on lock.
      scanLockedRef.current = true; 
      processScan(code.data);
    }
  };


  const handleManualPaste = () => {
    const v = prompt("Paste QR value (e.g., UUID token):");
    if (!v) return;

    // Force unlock and process the token
    scanLockedRef.current = false;
    processScan(v);
  };
  
  const exportUsed = () => {
     // NOTE: A proper implementation would query Firestore for all `used: true` documents
     // and generate a CSV from that data.
     alert("Export functionality to fetch used tokens from Firebase will be implemented here.");
  };

  // --- UI RENDER (Kept largely the same for styling) ---
  
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
      <header
        style={{
          marginBottom: 10,
          textAlign: "center",
        }}
      >
        <h1 style={{ fontSize: 22, margin: 0 }}>🚌 Exam Bus QR Scanner</h1>
        <div style={{ fontSize: 12, color: '#6b7280' }}>
            Verification System for Paid Seat Holders
        </div>
      </header>

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
            1. Scan QR Code
          </div>
        </div>

        <div style={{ marginBottom: 8, position: 'relative' }}>
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
          {/* Visual indicator for scanning area/success */}
          {videoRef.current && videoRef.current.srcObject && (
              <div style={{
                  position: 'absolute',
                  top: '50%',
                  left: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: '80%',
                  height: '80%',
                  border: '2px solid',
                  borderColor: scanLockedRef.current ? '#16a34a' : '#facc15',
                  pointerEvents: 'none',
                  borderRadius: 8,
              }}></div>
          )}
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
            onClick={handleManualPaste}
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
          {/* Success */}
          {result.type === "paid" && (
            <div
              style={{
                borderLeft: "4px solid #16a34a",
                paddingLeft: 10,
                color: "#065f46",
                fontSize: 14,
                animation: 'fadein 0.5s', // Basic animation for visibility
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 2, fontSize: 16 }}>
                ✅ {result.msg}
              </div>
              <div>Contact: {result.rec?.contact}</div>
              <div>Name: {result.rec?.name}</div>
              {result.examDate && <div>Exam Date: {result.examDate}</div>}
              {result.session && <div>Trip Type: **{result.session.toUpperCase()}**</div>}
              <div>Time: {new Date(result.when).toLocaleTimeString()} {new Date(result.when).toLocaleDateString()}</div>
            </div>
          )}
          {/* Already Used */}
          {result.type === "used" && (
            <div
              style={{
                borderLeft: "4px solid #f97316",
                paddingLeft: 10,
                color: "#7c2d12",
                fontSize: 14,
                animation: 'fadein 0.5s',
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 2, fontSize: 16 }}>
                ⚠ {result.msg}
              </div>
              {result.examDate && <div>Exam Date: {result.examDate}</div>}
              {result.session && <div>Trip Type: **{result.session.toUpperCase()}**</div>}
              <div>Used At: {new Date(result.usedAt).toLocaleTimeString()} {new Date(result.usedAt).toLocaleDateString()}</div>
            </div>
          )}
          {/* Invalid/Not Paid */}
          {result.type === "notpaid" && (
            <div
              style={{
                borderLeft: "4px solid #dc2626",
                paddingLeft: 10,
                color: "#7f1d1d",
                fontSize: 14,
                animation: 'fadein 0.5s',
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 2, fontSize: 16 }}>
                ❌ {result.msg} - ACCESS DENIED
              </div>
              <div>Scanned Token: {result.raw}</div>
            </div>
          )}
          
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
            2. Scanned Entries ({scanTable.length})
          </div>
          <button
            onClick={() => {
              if (window.confirm("Clear scanned table? This does not undo usage in Firebase.")) setScanTable([]);
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
            Clear Local Table
          </button>
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
                <th style={{ border: "1px solid #e5e7eb", padding: 6 }}>Contact</th>
                <th style={{ border: "1px solid #e5e7eb", padding: 6 }}>Name</th>
                <th style={{ border: "1px solid #e5e7eb", padding: 6 }}>Date</th>
                <th style={{ border: "1px solid #e5e7eb", padding: 6 }}>Trip</th>
                <th style={{ border: "1px solid #e5e7eb", padding: 6 }}>Scan Time</th>
              </tr>
            </thead>
            <tbody>
              {scanTable.map((r, index) => (
                <tr key={r.id}>
                  <td
                    style={{
                      border: "1px solid #e5e7eb",
                      padding: 6,
                      textAlign: "center",
                      background: index === 0 ? '#ecfdf5' : 'white', // Highlight newest row
                    }}
                  >
                    {r.id}
                  </td>
                  <td style={{ border: "1px solid #e5e7eb", padding: 6 }}>{r.contact}</td>
                  <td style={{ border: "1px solid #e5e7eb", padding: 6 }}>{r.name}</td>
                  <td style={{ border: "1px solid #e5e7eb", padding: 6 }}>{r.examDate || "-"}</td>
                  <td style={{ border: "1px solid #e5e7eb", padding: 6, fontWeight: 700 }}>
                    {r.session === 'going' ? '➡️ GOING' : '⬅️ RETURN'}
                  </td>
                  <td style={{ border: "1px solid #e5e7eb", padding: 6 }}>{r.time}</td>
                </tr>
              ))}
              {scanTable.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
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