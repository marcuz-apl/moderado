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
const CHART_COLORS = [21, 27, 33, 39, 45, 51, 50, 46, 82, 118, 154, 190, 226, 220, 214, 208, 202, 196];
const RESET = '\x1b[0m';

export function renderChartBlock(source: string, width: number, color = Boolean(process.stdout.isTTY && process.env.NO_COLOR === undefined)): string[] | undefined {
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
    ? renderBarChart(parsed.data, Math.max(8, width), color)
    : renderLineChart(parsed.data, Math.max(8, width), color);
}

function renderBarChart(chart: Chart, width: number, color: boolean): string[] {
  const labelWidth = Math.min(18, Math.max(1, Math.floor(width * 0.3)));
  const valueWidth = Math.max(...chart.data.map(({ value }) => formatNumber(value).length));
  const barWidth = Math.max(1, width - labelWidth - valueWidth - 3);
  const maxValue = Math.max(...chart.data.map(({ value }) => Math.abs(value)), 1);
  const lines = chart.title ? [truncateToWidth(chart.title, width)] : [];
  for (const point of chart.data) {
    const label = truncateToWidth(point.label, labelWidth);
    const paddedLabel = label + ' '.repeat(Math.max(0, labelWidth - displayWidth(label)));
    const length = Math.round(Math.abs(point.value) / maxValue * barWidth);
    const bar = point.value < 0 ? '<'.repeat(length) : '#'.repeat(length);
    const coloredBar = color && bar ? `${chartColor(magnitudeColor(point.value, maxValue))}${bar}${RESET}` : bar;
    lines.push(truncateToWidth(`${paddedLabel} ${coloredBar} ${formatNumber(point.value)}`, width));
  }
  return lines;
}

function renderLineChart(chart: Chart, width: number, color: boolean): string[] {
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
  const colorGrid = Array.from({ length: plotHeight }, () => Array<number>(plotWidth).fill(-1));
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y), 1);
    for (let step = 0; step <= steps; step += 1) {
      const x = Math.round(from.x + (to.x - from.x) * step / steps);
      const y = Math.round(from.y + (to.y - from.y) * step / steps);
      grid[y][x] = '.';
      colorGrid[y][x] = colorAt(index - 1 + step / steps, data.length);
    }
  }
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    grid[point.y][point.x] = 'o';
    colorGrid[point.y][point.x] = colorAt(index, data.length);
  }
  const lines = chart.title ? [truncateToWidth(chart.title, width)] : [];
  lines.push(...grid.map((row, y) => color
    ? `\x1b[38;5;240m|${RESET}${row.map((glyph, x) => colorGrid[y][x] < 0 || glyph === ' ' ? glyph : `${chartColor(colorGrid[y][x])}${glyph}${RESET}`).join('')}\x1b[38;5;240m|${RESET}`
    : `|${row.join('')}|`));
  lines.push(truncateToWidth(` ${formatNumber(max)}${' '.repeat(Math.max(1, plotWidth - 2))}${formatNumber(min)}`, width));
  for (const point of data) lines.push(truncateToWidth(`${point.label}: ${formatNumber(point.value)}`, width));
  return lines;
}

function chartColor(index: number): string {
  return `\x1b[38;5;${index}m`;
}

function colorAt(position: number, count: number): number {
  const step = count <= 1 ? 0 : position / (count - 1) * (CHART_COLORS.length - 1);
  return CHART_COLORS[Math.round(step)];
}

function magnitudeColor(value: number, max: number): number {
  return CHART_COLORS[Math.round(Math.abs(value) / max * (CHART_COLORS.length - 1))];
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(4)));
}
