/**
 * SCREEN_EVIDENCE Remotion component (P0-2, 2026-09-15). Renders a
 * plausible phone-frame with a fake page inside it, filling the 1080x1920
 * canonical canvas. No network, no real service, no real personal data —
 * every value is supplied by the caller (see
 * src/jobs/contentPipeline/screenEvidenceCompose.ts).
 *
 * The component is intentionally self-contained: five hard-coded templates,
 * plain HTML/CSS, no external assets. That way it renders correctly under
 * Remotion's Chromium regardless of the runtime's font/image state.
 */
import React from "react";
import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import type { ScreenEvidenceProps } from "./types";

const OFF_WHITE = "#F6F4EF";
const INK = "#1a1a1a";
const ACCENT = "#A00223";
const HL = "rgba(240, 165, 0, 0.35)";
const CARD = "#ffffff";

const phoneFrameStyle: React.CSSProperties = {
  position: "absolute",
  left: "10%",
  top: "8%",
  width: "80%",
  height: "84%",
  background: "#0b0b0b",
  borderRadius: 72,
  padding: 22,
  boxShadow: "0 40px 80px rgba(0,0,0,0.4), inset 0 0 0 3px #222",
};

const screenStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  background: "#f7f7f9",
  borderRadius: 52,
  overflow: "hidden",
  fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  color: INK,
  position: "relative",
};

function HighlightPulse({ label, values, highlight }: { label: string; values: Record<string, string>; highlight?: string[] }) {
  const frame = useCurrentFrame();
  const highlighted = highlight?.includes(label);
  const pulse = highlighted ? interpolate(frame % 60, [0, 30, 60], [0.15, 0.5, 0.15]) : 0;
  return (
    <span style={{ background: highlighted ? `rgba(240,165,0,${pulse})` : "transparent", padding: "2px 6px", borderRadius: 6 }}>
      {values[label] ?? ""}
    </span>
  );
}

const FinancingQuote: React.FC<{ v: Record<string, string>; hl?: string[] }> = ({ v, hl }) => (
  <div style={{ padding: 32 }}>
    <div style={{ fontSize: 28, fontWeight: 600, marginBottom: 24 }}>Simulação de financiamento</div>
    <div style={{ fontSize: 22, opacity: 0.7, marginBottom: 40 }}>{v.car}</div>
    <div style={{ background: CARD, padding: 28, borderRadius: 20, boxShadow: "0 4px 16px rgba(0,0,0,0.06)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, fontSize: 24 }}>
        <span>Entrada</span><b>R$ <HighlightPulse label="entrada" values={v} highlight={hl} /></b>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, fontSize: 34 }}>
        <span>Parcela</span><b style={{ color: ACCENT }}>R$ <HighlightPulse label="parcela" values={v} highlight={hl} /> × <HighlightPulse label="n" values={v} highlight={hl} /></b>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, fontSize: 24 }}>
        <span>CET</span><b><HighlightPulse label="cet" values={v} highlight={hl} /></b>
      </div>
      <div style={{ borderTop: `1px solid #eee`, marginTop: 20, paddingTop: 20, display: "flex", justifyContent: "space-between", fontSize: 22 }}>
        <span>Total pago</span><b>R$ <HighlightPulse label="total" values={v} highlight={hl} /></b>
      </div>
    </div>
    <button style={{ marginTop: 40, width: "100%", padding: 24, fontSize: 28, background: ACCENT, color: "#fff", border: 0, borderRadius: 16 }}>Contratar</button>
  </div>
);

const ListingPage: React.FC<{ v: Record<string, string>; hl?: string[] }> = ({ v, hl }) => (
  <div style={{ padding: 24 }}>
    <div style={{ background: CARD, borderRadius: 20, padding: 20, boxShadow: "0 4px 16px rgba(0,0,0,0.06)" }}>
      <div style={{ width: "100%", height: 260, background: "linear-gradient(135deg, #d1d5db, #9ca3af)", borderRadius: 14, marginBottom: 20 }} />
      <div style={{ fontSize: 30, fontWeight: 700 }}><HighlightPulse label="car" values={v} highlight={hl} /></div>
      <div style={{ fontSize: 40, color: ACCENT, fontWeight: 800, margin: "12px 0" }}><HighlightPulse label="price" values={v} highlight={hl} /></div>
      <div style={{ fontSize: 22, opacity: 0.8 }}><HighlightPulse label="km" values={v} highlight={hl} /> · <HighlightPulse label="location" values={v} highlight={hl} /></div>
      <div style={{ fontSize: 20, opacity: 0.6, marginTop: 8 }}>Vendedor: {v.seller}</div>
    </div>
  </div>
);

const WhatsappThread: React.FC<{ v: Record<string, string>; hl?: string[] }> = ({ v }) => (
  <div style={{ background: "#e5ddd5", height: "100%", padding: 24, boxSizing: "border-box" }}>
    <div style={{ background: "#075e54", color: "#fff", padding: "14px 20px", borderRadius: 14, marginBottom: 24, fontSize: 22 }}>
      {v.seller}
    </div>
    {[v.line1, v.line2, v.line3].filter(Boolean).map((line, i) => (
      <div key={i} style={{ background: "#fff", padding: "14px 18px", borderRadius: 14, marginBottom: 12, maxWidth: "85%", fontSize: 22, boxShadow: "0 1px 2px rgba(0,0,0,0.1)" }}>
        {line}
      </div>
    ))}
  </div>
);

const PixReceipt: React.FC<{ v: Record<string, string>; hl?: string[] }> = ({ v, hl }) => (
  <div style={{ padding: 40 }}>
    <div style={{ fontSize: 22, opacity: 0.6 }}>Transferência PIX</div>
    <div style={{ fontSize: 56, fontWeight: 800, margin: "16px 0", color: ACCENT }}>R$ <HighlightPulse label="amount" values={v} highlight={hl} /></div>
    <div style={{ fontSize: 22, opacity: 0.7, marginBottom: 32 }}>Para: {v.to}</div>
    <div style={{ background: CARD, padding: 24, borderRadius: 20, fontSize: 22 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}><span>Status</span><b style={{ color: "#0a8f42" }}>{v.status}</b></div>
      <div style={{ display: "flex", justifyContent: "space-between" }}><span>Data</span><b>{v.date}</b></div>
    </div>
  </div>
);

const Invoice: React.FC<{ v: Record<string, string>; hl?: string[] }> = ({ v, hl }) => (
  <div style={{ padding: 32 }}>
    <div style={{ fontSize: 24, fontWeight: 600 }}>Nota de serviço</div>
    <div style={{ fontSize: 20, opacity: 0.6, marginBottom: 24 }}>{v.date}</div>
    <div style={{ background: CARD, padding: 24, borderRadius: 20, boxShadow: "0 4px 16px rgba(0,0,0,0.06)" }}>
      <div style={{ fontSize: 22, marginBottom: 14 }}>{v.service}</div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, opacity: 0.7 }}><span>Peças</span><span>{v.parts}</span></div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10, opacity: 0.7 }}><span>Mão-de-obra</span><span>{v.labor}</span></div>
      <div style={{ borderTop: "1px solid #eee", marginTop: 16, paddingTop: 16, display: "flex", justifyContent: "space-between", fontSize: 32 }}>
        <b>Total</b><b style={{ color: ACCENT }}><HighlightPulse label="total" values={v} highlight={hl} /></b>
      </div>
    </div>
  </div>
);

export const ScreenEvidence: React.FC<ScreenEvidenceProps> = (props) => {
  const { template, values, highlight } = props;
  const body = (() => {
    switch (template) {
      case "FINANCING_QUOTE": return <FinancingQuote v={values} hl={highlight} />;
      case "LISTING_PAGE":    return <ListingPage    v={values} hl={highlight} />;
      case "WHATSAPP_THREAD": return <WhatsappThread v={values} hl={highlight} />;
      case "PIX_RECEIPT":     return <PixReceipt     v={values} hl={highlight} />;
      case "INVOICE":         return <Invoice        v={values} hl={highlight} />;
      default:                return null;
    }
  })();
  return (
    <AbsoluteFill style={{ backgroundColor: OFF_WHITE }}>
      <div style={phoneFrameStyle}>
        <div style={screenStyle}>{body}</div>
      </div>
    </AbsoluteFill>
  );
};
