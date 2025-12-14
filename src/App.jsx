import { BrowserRouter, Routes, Route } from "react-router-dom";

import AdminGenerateQR from "./components/AdminGenerateQr";
import StudentGenerateQR from "./components/StudentGenerateQr";
import QRPaymentVerifier from "./components/QRPaymentVerifier";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<StudentGenerateQR />} />
        <Route path="/admin" element={<AdminGenerateQR />} />
        <Route path="/scan" element={<QRPaymentVerifier />} />
      </Routes>
    </BrowserRouter>
  );
}
