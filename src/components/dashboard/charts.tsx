"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartTooltip } from "@/components/shared/chart-tooltip";

const METHOD_COLORS: Record<string, string> = {
  MPESA: "var(--color-brand-500)",
  CASH: "var(--chart-2)",
  CARD: "var(--chart-4)",
  BANK_TRANSFER: "var(--chart-5)",
  CREDIT: "var(--chart-3)",
};

const axisProps = {
  stroke: "var(--color-border)",
  fontSize: 11,
  tickLine: false as const,
  axisLine: false as const,
};

export function RevenueAreaChart({ data }: { data: { date: string; revenue: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="revenueFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-brand-500)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--color-brand-500)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis dataKey="date" {...axisProps} />
        <YAxis {...axisProps} tickFormatter={(v: number) => (v >= 1000 ? `${v / 1000}k` : `${v}`)} width={36} />
        <Tooltip content={<ChartTooltip />} cursor={{ stroke: "var(--color-border)" }} />
        <Area
          type="monotone"
          dataKey="revenue"
          name="Revenue"
          stroke="var(--color-brand-500)"
          strokeWidth={2}
          fill="url(#revenueFill)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function PaymentMethodDonut({ data }: { data: { name: string; value: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius={60}
          outerRadius={90}
          paddingAngle={3}
          stroke="var(--color-card)"
        >
          {data.map((entry) => (
            <Cell key={entry.name} fill={METHOD_COLORS[entry.name] ?? "var(--chart-1)"} />
          ))}
        </Pie>
        <Tooltip content={<ChartTooltip />} />
        <Legend
          iconType="circle"
          iconSize={8}
          formatter={(value: string) => (
            <span className="text-xs text-muted-foreground">
              {value === "MPESA" ? "M-Pesa" : value.toLowerCase()}
            </span>
          )}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function MonthlyPnlChart({
  data,
}: {
  data: { month: string; revenue: number; expenses: number; profit: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis dataKey="month" {...axisProps} />
        <YAxis {...axisProps} tickFormatter={(v: number) => (v >= 1000 ? `${v / 1000}k` : `${v}`)} width={36} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--color-muted)", opacity: 0.4 }} />
        <Legend
          iconType="circle"
          iconSize={8}
          formatter={(value: string) => (
            <span className="text-xs text-muted-foreground">{value}</span>
          )}
        />
        <Bar dataKey="revenue" name="Revenue" fill="var(--color-brand-500)" radius={[4, 4, 0, 0]} maxBarSize={28} />
        <Bar dataKey="expenses" name="Expenses" fill="var(--chart-3)" radius={[4, 4, 0, 0]} maxBarSize={28} />
        <Line
          type="monotone"
          dataKey="profit"
          name="Profit"
          stroke="var(--chart-2)"
          strokeWidth={2}
          dot={{ r: 3, fill: "var(--chart-2)" }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function ExpensesByCategoryChart({ data }: { data: { category: string; value: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 4, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
        <XAxis type="number" {...axisProps} tickFormatter={(v: number) => (v >= 1000 ? `${v / 1000}k` : `${v}`)} />
        <YAxis type="category" dataKey="category" {...axisProps} width={110} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--color-muted)", opacity: 0.4 }} />
        <Bar dataKey="value" name="Amount" fill="var(--chart-3)" radius={[0, 4, 4, 0]} maxBarSize={20} />
      </BarChart>
    </ResponsiveContainer>
  );
}
