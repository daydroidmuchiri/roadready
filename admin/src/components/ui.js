import React from 'react';

import { C } from '../theme';

export function Badge({ label, color }) {
  const colors = {
    orange: { bg: 'rgba(232,99,26,.15)', text: C.orange },
    blue: { bg: 'rgba(26,122,232,.15)', text: C.blue },
    green: { bg: 'rgba(0,168,112,.15)', text: C.green },
    gray: { bg: 'rgba(100,100,100,.15)', text: C.muted },
  };
  const cv = colors[color] || colors.gray;
  return (
    <span style={{ background: cv.bg, color: cv.text, padding: '2px 8px', borderRadius: 5, fontSize: 10, fontWeight: 500 }}>
      {label}
    </span>
  );
}

export function StatCard({ label, value, delta }) {
  return (
    <div style={{ flex: 1, background: 'rgba(255,255,255,.04)', border: `1px solid ${C.border}`, borderRadius: 9, padding: '8px 10px' }}>
      <div style={{ fontSize: 13, fontWeight: 500, color: C.text }}>{value}</div>
      <div style={{ fontSize: 10, color: C.muted }}>{label}</div>
      {delta && <div style={{ fontSize: 11, color: C.green, marginTop: 2 }}>{delta}</div>}
    </div>
  );
}
