"use client";

import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, Cell } from "recharts";

export function TrendChart({ data }: { data: { label: string; cut: number }[] }) {
  const max = Math.max(...data.map((d) => d.cut), 1);
  return (
    <ResponsiveContainer width="100%" height={150}>
      <BarChart data={data} margin={{ top: 8, right: 0, left: 0, bottom: 0 }} barCategoryGap="28%">
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 10, fill: "#9aa3b2" }}
          dy={4}
        />
        <Tooltip
          cursor={{ fill: "rgba(99,102,241,0.06)" }}
          contentStyle={{
            borderRadius: 10,
            border: "1px solid #eceef1",
            fontSize: 12,
            boxShadow: "0 8px 24px rgba(20,23,40,.12)",
          }}
          formatter={(v: number) => [v.toLocaleString("en-US"), "Cut qty"]}
        />
        <Bar dataKey="cut" radius={[5, 5, 0, 0]}>
          {data.map((d, i) => (
            <Cell key={i} fill={d.cut === max ? "#4f46e5" : "#a5b4fc"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
