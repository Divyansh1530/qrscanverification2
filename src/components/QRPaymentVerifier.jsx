import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import * as XLSX from "xlsx";

const PAID_KEY = "pv_paid_list";
const USED_KEY = "pv_used_list";
const OP_KEY = "pv_operator";
const TABLE_KEY = "scan_table";

function safeLoad(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed === null ? fallback : parsed;
  } catch {
    return fallback;
  }
}

function parseQRValue(raw) {
  const cleaned = String(raw || "").trim();
  if (!cleaned) return null;
  const [enrollment, date, session] = cleaned.split("+").map(v => v?.trim());
  return { raw: cleaned, enrollment, date, session };
}

export default function QRPaymentVerifier() {
  const [paidList, setPaidList] = useState(() => safeLoad(PAID_KEY, []));
  const [usedMap, setUsedMap] = useState(() => safeLoad(USED_KEY, {}));
  const [scanTable, setScanTable] = useState(() => safeLoad(TABLE_KEY, []));
  const [result, setResult] = useState(null);
  const [scanData, setScanData] = useState(null);
  const [supportMsg, setSupportMsg] = useState("");

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const scanTimer = useRef(null);
  const detector = useRef(null);

  useEffect(() => {
    localStorage.setItem(PAID_KEY, JSON.stringify(paidList));
    localStorage.setItem(USED_KEY, JSON.stringify(usedMap));
    localStorage.setItem(TABLE_KEY, JSON.stringify(scanTable));
  }, [paidList, usedMap, scanTable]);

  const normalizeNum = (s) => (s || "").replace(/\D/g, "");

  const findStudent = (v) => {
    const n = normalizeNum(v);
    return paidList.find(
      p =>
        normalizeNum(p.enrollment) === n ||
        p.phone === n
    );
  };

  const addToTable = (rec, meta) => {
    const exists = scanTable.some(
      r =>
        r.enrollment === rec.enrollment &&
        r.examDate === meta.date &&
        r.session === meta.session
    );
    if (exists) return;

    setScanTable(prev => [
      ...prev,
      {
        id: prev.length + 1,
        enrollment: rec.enrollment,
        phone: rec.phone,
        examDate: meta.date,
        session: meta.session,
        time: new Date().toLocaleString()
      }
    ]);
  };

  const processScan = (raw) => {
    stopCamera();

    const parsed = parseQRValue(raw);
    if (!parsed?.enrollment) {
      setResult({ type: "notpaid", msg: "Invalid QR", raw });
      setScanData(null);
      return;
    }

    const rec = findStudent(parsed.enrollment);
    if (!rec) {
      setResult({ type: "notpaid", msg: "Not found", raw: parsed.raw });
      setScanData(null);
      return;
    }

    const key = `${normalizeNum(rec.enrollment)}|${parsed.date}|${parsed.session}`;
    const used = usedMap[key];

    if (used) {
      setResult({
        type: "used",
        msg: "QR already scanned",
        when: used.when,
        examDate: used.examDate,
        session: used.session
      });
      setScanData({ ...rec });
      return;
    }

    const now = new Date().toISOString();
    setUsedMap(prev => ({
      ...prev,
      [key]: {
        ...rec,
        when: now,
        examDate: parsed.date,
        session: parsed.session
      }
    }));

    addToTable(rec, parsed);
    setResult({ type: "paid" });
    setScanData({
      ...rec,
      examDate: parsed.date,
      session: parsed.session
    });
  };

  const startCamera = async () => {
    detector.current =
      "BarcodeDetector" in window
        ? new BarcodeDetector({ formats: ["qr_code"] })
        : null;

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" }
    });

    streamRef.current = stream;
    videoRef.current.srcObject = stream;
    await videoRef.current.play();

    scanTimer.current = setInterval(scanFrame, 300);
  };

  const stopCamera = () => {
    clearInterval(scanTimer.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
  };

  const scanFrame = async () => {
    if (!videoRef.current?.videoWidth) return;

    if (detector.current) {
      const codes = await detector.current.detect(videoRef.current);
      if (codes[0]) processScan(codes[0].rawValue);
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    ctx.drawImage(videoRef.current, 0, 0);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(img.data, img.width, img.height);
    if (code) processScan(code.data);
  };

  return (
    <div style={{ maxWidth: 900, margin: "auto", padding: 12 }}>
      <h2 style={{ textAlign: "center" }}>Exam Bus QR Scanner</h2>

      {/* SCANNER CARD */}
      <section style={{ background: "#fff", padding: 12, borderRadius: 12 }}>
        <h3>2. Scan QR Code</h3>

        <video
          ref={videoRef}
          style={{ width: "100%", maxHeight: 260, background: "#000" }}
          playsInline
        />
        <canvas ref={canvasRef} style={{ display: "none" }} />

        {/* 🔹 SUCCESS UI */}
        {scanData && result?.type === "paid" && (
          <div style={{ marginTop: 8, background: "#ecfeff", padding: 10 }}>
            <strong>✅ {scanData.enrollment} scanned successfully</strong>
            <div>Phone: {scanData.phone}</div>
            <div>Date: {scanData.examDate}</div>
            <div>Session: {scanData.session}</div>
          </div>
        )}

        {/* 🔸 DUPLICATE UI */}
        {scanData && result?.type === "used" && (
          <div style={{ marginTop: 8, background: "#fff7ed", padding: 10 }}>
            <strong>⚠ QR already scanned</strong>
            <div>Phone: {scanData.phone}</div>
            <div>Date: {result.examDate}</div>
            <div>Session: {result.session}</div>
            <div>
              First used:{" "}
              {new Date(result.when).toLocaleString()}
            </div>
          </div>
        )}

        <div style={{ marginTop: 10 }}>
          <button onClick={startCamera}>Start Camera</button>
          <button onClick={stopCamera} style={{ marginLeft: 8 }}>
            Stop
          </button>
        </div>
      </section>
    </div>
  );
}
