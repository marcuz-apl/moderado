import { z } from 'zod';
import { displayWidth, truncateToWidth } from './box.js';

const ChartSchema = z.object({
  type: z.enum(['bar', 'line']),
  title: z.string().max(120).regex(/^[^\x00-\x1f\x7f]*$/).optional(),
  data: z.array(z.object({
    label: z.string().min(1).max(80).regex(/^[^\x00-\x1f\x7f]*$/),
    value: z.number().finite(),
  }).strict()).min(1).max(24),
}).strict();

type Chart = z.infer<typeof ChartSchema>;

export function renderChartBlock(source: string, width: number): string[] | undefined {
  if (source.length > 16_000) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    return undefined;
  }
  const parsed = ChartSchema.safeParse(raw);
  if (!parsed.success) return undefined;
  return parsed.data.type === 'bar'
    ? renderBarChart(parsed.data, Math.max(8, width))
    : renderLineChart(parsed.data, Math.max(8, width));
}

function renderBarChart(chart: Chart, width: number): string[] {
  const labelWidth = Math.min(18, Math.max(1, Math.floor(width * 0.3)));
  const valueWidth = Math.max(...chart.data.map(({ value }) => formatNumber(value).length));
  const barWidth = Math.max(1, width - labelWidth - valueWidth - 3);
  const maxValue = Math.max(...chart.data.map(({ value }) => Math.abs(value)), 1);
  const lines = chart.title ? [truncateToWidth(chart.title, width)] : [];
  for (const point of chart.data) {
    const label = truncateToWidth(point.label, labelWidth);
    const paddedLabel = label + ' '.repeat(Math.max(0, labelWidth - displayWidth(label)));
    const length = Math.round(Math.abs(point.value) / maxValue * barWidth);
    lines.push(truncateToWidth(`${paddedLabel} ${point.value < 0 ? '<'.repeat(length) : '#'.repeat(length)} ${formatNumber(point.value)}`, width));
  }
  return lines;
}

function renderLineChart(chart: Chart, width: number): string[] {
  const data = chart.data;
  const plotWidth = Math.max(1, Math.min(48, width - 2));
  const plotHeight = 7;
  const min = Math.min(...data.map(({ value }) => value));
  const max = Math.max(...data.map(({ value }) => value));
  const span = max - min || 1;
  const points = data.map(({ value }, index) => ({
    x: data.length === 1 ? Math.floor((plotWidth - 1) / 2) : Math.round(index * (plotWidth - 1) / (data.length - 1)),
    y: Math.round((max - value) * (plotHeight - 1) / span),
  }));
  const grid = Array.from({ length: plotHeight }, () => Array<string>(plotWidth).fill(' '));
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y), 1);
    for (let step = 0; step <= steps; step += 1) {
      const x = Math.round(from.x + (to.x - from.x) * step / steps);
      const y = Math.round(from.y + (to.y - from.y) * step / steps);
      grid[y][x] = '.';
    }
  }
  for (const point of points) grid[point.y][point.x] = 'o';
  const lines = chart.title ? [truncateToWidth(chart.title, width)] : [];
  lines.push(...grid.map((row) => `|${row.join('')}|`));
  lines.push(truncateToWidth(` ${formatNumber(max)}${' '.repeat(Math.max(1, plotWidth - 2))}${formatNumber(min)}`, width));
  for (const point of data) lines.push(truncateToWidth(`${point.label}: ${formatNumber(point.value)}`, width));
  return lines;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(4)));
}
