import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import * as XLSX from "xlsx";


const PAID_KEY = "pv_paid_list";
const USED_KEY = "pv_used_list";
const OP_KEY = "pv_operator";
const TABLE_KEY = "scan_table";

/**
 * Helper to safely parse JSON from localStorage
 */
function safeLoad(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed === null ? fallback : parsed;
  } catch (e) {
    console.warn("safeLoad failed for", key, e);
    return fallback;
  }
}

// Parse QR value: "<enroll>+<date>+<session>"
function parseQRValue(raw) {
  const cleaned = String(raw || "").trim();
  if (!cleaned) return null;

  const parts = cleaned.split("+");
  const enrollment = (parts[0] || "").trim();
  const date = (parts[1] || "").trim();
  const session = (parts[2] || "").trim(); // Morning / Afternoon

  return {
    raw: cleaned,
    enrollment,
    date,
    session,
  };
}

export default function QRPaymentVerifier() {
  // initialize state from localStorage
  const [paidList, setPaidList] = useState(() => safeLoad(PAID_KEY, []));
  const [usedMap, setUsedMap] = useState(() => safeLoad(USED_KEY, {}));
  const [operator, setOperator] = useState(() => safeLoad(OP_KEY, ""));
  const [scanTable, setScanTable] = useState(() => safeLoad(TABLE_KEY, []));

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

  /* persist to localStorage */
  useEffect(() => {
    try {
      localStorage.setItem(PAID_KEY, JSON.stringify(paidList));
    } catch (e) {
      console.warn(e);
    }
  }, [paidList]);

  useEffect(() => {
    try {
      localStorage.setItem(USED_KEY, JSON.stringify(usedMap));
    } catch (e) {
      console.warn(e);
    }
  }, [usedMap]);

  useEffect(() => {
    try {
      localStorage.setItem(OP_KEY, operator);
    } catch (e) {
      console.warn(e);
    }
  }, [operator]);

  useEffect(() => {
    try {
      localStorage.setItem(TABLE_KEY, JSON.stringify(scanTable));
    } catch (e) {
      console.warn(e);
    }
  }, [scanTable]);

  /* ---------- helpers ---------- */
  const normalizeNum = (s) => (s || "").replace(/\D/g, "").trim();

  /* ---------- CSV parse & load ---------- */
  const parseCSV = (text) => {
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
    return lines.map((line) => {
      const parts = [];
      let cur = "";
      let inQ = false;
      for (let c of line) {
        if (c === '"') inQ = !inQ;
        else if (c === "," && !inQ) {
          parts.push(cur.trim());
          cur = "";
        } else cur += c;
      }
      parts.push(cur.trim());
      return parts;
    });
  };

  const loadFromRows = (rows) => {
    if (!Array.isArray(rows) || rows.length === 0) {
      alert("No rows found in file/text.");
      return;
    }
    const header = rows[0].map((h) => String(h).toLowerCase());
    const hasHeader = header.some((h) => /enroll|roll|reg|phone|name/.test(h));
    const start = hasHeader ? 1 : 0;
    const out = [];
    for (let i = start; i < rows.length; i++) {
      const r = rows[i];
      out.push({
        enrollment: String(r[0] || "").trim(),
        phone: normalizeNum(r[1] || ""),
        name: String(r[2] || "").trim(),
      });
    }
    setPaidList(out);
    setResult({ type: "info", msg: `Loaded ${out.length} records` });
  };

  /* ---------- excel upload ---------- */
  const handleExcelUpload = (file) => {
    try {
      const reader = new FileReader();
      reader.onload = (evt) => {
        const workbook = XLSX.read(evt.target.result, { type: "binary" });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        loadFromRows(rows);
      };
      reader.readAsBinaryString(file);
    } catch (e) {
      alert("Failed to read Excel file: " + e.message);
    }
  };

  /* ---------- find student by enrollment/phone ---------- */
  const findStudent = (qrOrEnrollment) => {
    const num = normalizeNum(qrOrEnrollment || "");
    if (!num) return null;

    const byEnroll = paidList.find((p) => normalizeNum(p.enrollment) === num);
    if (byEnroll) return byEnroll;

    const byPhone = paidList.find((p) => p.phone === num);
    if (byPhone) return byPhone;

    return paidList.find(
      (p) =>
        normalizeNum(p.enrollment).endsWith(num) ||
        (p.phone && p.phone.endsWith(num))
    );
  };

  
  /* ---------- mark as used ---------- */
  const markUsed = (rec, meta) => {
    const base = normalizeNum(rec.enrollment);
    if (!base) return;

    const date = meta?.date || "";
    const session = meta?.session || "";
    const key = `${base}|${date}|${session}`; // per enrollment+date+session
    const nowISO = new Date().toISOString();

    setUsedMap((prev) => {
      if (prev[key]) return prev; // already used for this date+session
      return {
        ...prev,
        [key]: {
          ...rec,
          operator,
          when: nowISO,
          examDate: date,
          session,
          raw: meta?.raw || "",
        },
      };
    });

    setResult({
      type: "paid",
      msg: `${rec.name || rec.enrollment} verified`,
      rec,
      when: nowISO,
      examDate: date,
      session,
    });
  };

  /* ---------- table operations ---------- */
  const addToTable = (rec, meta) => {
    if (!rec || !rec.enrollment) return;
    const date = meta?.date || "";
    const session = meta?.session || "";

    // allow same student multiple times, but not same date+session twice
    const exists = scanTable.some(
      (r) =>
        r.enrollment === rec.enrollment &&
        r.examDate === date &&
        r.session === session
    );
    if (exists) return;

    const entry = {
      id: scanTable.length + 1,
      enrollment: rec.enrollment,
      name: rec.name || "",
      phone: rec.phone || "",
      time: new Date().toLocaleString(),
      examDate: date,
      session,
    };
    setScanTable((prev) => [...prev, entry]);
  };

  /* ---------- process scanned value ---------- */
  const processScan = (raw) => {
    stopCamera();

    const parsed = parseQRValue(raw);
    if (!parsed || !parsed.enrollment) {
      setResult({
        type: "notpaid",
        msg: "Invalid or empty QR",
        raw: raw,
      });
      setScanData(null);
      return;
    }

    const rec = findStudent(parsed.enrollment);

    // Not found in paid list
    if (!rec) {
      setResult({
        type: "notpaid",
        msg: "Not found",
        raw: parsed.raw,
      });
      setScanData(null);
      return;
    }

    const baseKey = normalizeNum(rec.enrollment);
    const date = parsed.date || "";
    const session = parsed.session || "";
    const sessionKey = `${baseKey}|${date}|${session}`;

    // Check if this specific enrollment+date+session was already scanned
    let used = usedMap && usedMap[sessionKey];

    // Fallback: legacy key that used only enrollment
    if (!used && usedMap && usedMap[baseKey]) {
      used = usedMap[baseKey];
    }

    if (used) {
      setResult({
        type: "used",
        msg: `${rec.name || rec.enrollment} already scanned`,
        rec,
        when: used.when,
        examDate: used.examDate || date,
        session: used.session || session,
      });
      setScanData({
        ...rec,
        examDate: used.examDate || date,
        session: used.session || session,
      });
      return;
    }

    // valid first-time scan for this date+session
    addToTable(rec, parsed);
    setScanData({
      ...rec,
      examDate: date,
      session,
    });
    markUsed(rec, parsed);
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
    if (!videoRef.current || !videoRef.current.videoWidth) return;
    if (detector.current) {
      try {
        const codes = await detector.current.detect(videoRef.current);
        if (codes && codes.length) processScan(codes[0].rawValue);
        return;
      } catch (e) {}
    }
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(img.data, img.width, img.height);
    if (code && code.data) processScan(code.data);
  };

  /* ---------- export used ---------- */
  const exportUsed = () => {
    const arr = Object.values(usedMap || {});
    if (!arr.length) {
      alert("No used records");
      return;
    }
    const csv = [
      "enrollment,phone,name,when,operator,examDate,session,raw",
      ...arr.map((u) =>
        [
          u.enrollment,
          u.phone,
          u.name,
          u.when,
          u.operator || "",
          u.examDate || "",
          u.session || "",
          u.raw || "",
        ].join(",")
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "used_records.csv";
    a.click();
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
        <div style={{ fontSize: 13, color: "#4b5563", marginTop: 4 }}>
          Verify paid students • Works best on Chrome (HTTPS)
        </div>
      </header>

      {/* TOP ROW: Load + Scanner stacked on mobile */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        {/* Load List Card */}
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
              fontWeight: 600,
              marginBottom: 4,
              fontSize: 15,
            }}
          >
            1. Load Student List
          </div>
          <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 4 }}>
            Upload CSV / Excel (enrollment, phone, name) before scanning.
          </div>
          <textarea
            id="csvInput"
            placeholder="Paste CSV here: enrollment,phone,name"
            style={{
              width: "100%",
              minHeight: 70,
              padding: 8,
              borderRadius: 8,
              border: "1px solid #e5e7eb",
              fontSize: 12,
            }}
          />
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 8,
              marginTop: 8,
            }}
          >
            <button
              onClick={() => {
                const txt = document.getElementById("csvInput").value;
                if (!txt) return alert("Paste CSV first");
                try {
                  loadFromRows(parseCSV(txt));
                } catch (e) {
                  alert("Failed to parse CSV: " + e.message);
                }
              }}
              style={{
                flex: 1,
                minWidth: 120,
                padding: "8px 10px",
                borderRadius: 999,
                border: "none",
                background: "#2563eb",
                color: "#fff",
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              Load CSV
            </button>

            <label
              style={{
                flex: 1,
                minWidth: 140,
                padding: "8px 10px",
                borderRadius: 999,
                textAlign: "center",
                background: "#16a34a",
                color: "#fff",
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
              }}
            >
              Upload File
              <input
                type="file"
                accept=".csv,.xlsx,.xls"
                style={{ display: "none" }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.name.endsWith(".csv")) {
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                      try {
                        loadFromRows(parseCSV(ev.target.result));
                      } catch {
                        alert("Invalid CSV");
                      }
                    };
                    reader.readAsText(file);
                  } else {
                    handleExcelUpload(file);
                  }
                }}
              />
            </label>

            <button
              onClick={() => {
                if (
                  confirm(
                    "Clear loaded student list AND all scanned history (table + used records)?"
                  )
                ) {
                  setPaidList([]);
                  setUsedMap({});
                  setScanTable([]);
                  setScanData(null);
                  setResult(null);
                  try {
                    localStorage.removeItem(PAID_KEY);
                    localStorage.removeItem(USED_KEY);
                    localStorage.removeItem(TABLE_KEY);
                  } catch (e) {
                    console.warn("Failed to clear storage", e);
                  }
                }
              }}
              style={{
                flex: 1,
                minWidth: 140,
                padding: "8px 10px",
                borderRadius: 999,
                border: "none",
                background: "#dc2626",
                color: "#fff",
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              Clear All
            </button>
          </div>

          <div
            style={{
              fontSize: 12,
              color: "#4b5563",
              marginTop: 6,
            }}
          >
            Loaded students:{" "}
            <span style={{ fontWeight: 600 }}>{paidList.length}</span>
          </div>
        </section>

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
              <div>Name: {result.rec?.enrollment}</div>
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
    <div
      style={{
        fontWeight: 700,
        marginBottom: 6,
        fontSize: 15,
        color: "#065f46",
      }}
    >
      ✅ {scanData.enrollment} scanned successfully
    </div>

    <div style={{ fontSize: 13 }}>
      <div>
        <strong>Name:</strong> {scanData.enrollment}
      </div>
      <div>
        <strong>Phone:</strong> {scanData.phone}
      </div>
      {scanData.examDate && (
        <div>
          <strong>Date of Exam:</strong> {scanData.examDate}
        </div>
      )}
      {scanData.session && (
        <div>
          <strong>Session:</strong> {scanData.session}
        </div>
      )}
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
                  Name
                </th>
                <th style={{ border: "1px solid #e5e7eb", padding: 6 }}>
                  Phone
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

  {/* Name (stored in enrollment) */}
  <td style={{ border: "1px solid #e5e7eb", padding: 6 }}>
    {r.enrollment}
  </td>

  {/* Phone */}
  <td style={{ border: "1px solid #e5e7eb", padding: 6 }}>
    {r.phone}
  </td>

  {/* Date */}
  <td style={{ border: "1px solid #e5e7eb", padding: 6 }}>
    {r.examDate || "-"}
  </td>

  {/* Session */}
  <td style={{ border: "1px solid #e5e7eb", padding: 6 }}>
    {r.session || "-"}
  </td>

  {/* Time */}
  <td style={{ border: "1px solid #e5e7eb", padding: 6 }}>
    {r.time}
  </td>
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
