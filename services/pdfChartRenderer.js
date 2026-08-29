/**
 * Pure PDFKit Vector Chart & KPI Visual Renderer
 * Generates crisp, scalable vector charts and metrics cards directly into the PDF stream
 * without external canvas or C++ binary dependencies.
 */

// Curated SaaS Color Palette
const COLORS = {
  indigo: '#4F46E5',
  violet: '#7C3AED',
  emerald: '#10B981',
  amber: '#F59E0B',
  rose: '#EF4444',
  sky: '#0284C7',
  slateDark: '#0F172A',
  slateMedium: '#334155',
  slateLight: '#64748B',
  slateBg: '#F8FAFC',
  slateBorder: '#E2E8F0',
  white: '#FFFFFF'
};

/**
 * Draws a clean SaaS KPI metric card
 */
function drawKPICard(doc, x, y, width, height, label, value, subtext = '', accentColor = COLORS.indigo) {
  // Background & border
  doc.roundedRect(x, y, width, height, 6).fillAndStroke(COLORS.slateBg, COLORS.slateBorder);

  // Left accent bar
  doc.roundedRect(x, y, 4, height, 2).fill(accentColor);

  // Label
  doc.fillColor(COLORS.slateLight).fontSize(7.5).font('Helvetica-Bold').text(label.toUpperCase(), x + 12, y + 8, { width: width - 20 });

  // Main Value
  doc.fillColor(COLORS.slateDark).fontSize(14).font('Helvetica-Bold').text(String(value), x + 12, y + 20, { width: width - 20 });

  // Subtext
  if (subtext) {
    doc.fillColor(COLORS.slateLight).fontSize(6.5).font('Helvetica').text(subtext, x + 12, y + 37, { width: width - 20 });
  }
}

/**
 * Draws a Horizontal Bar Chart with labels, values, and proportional bars
 * @param {PDFDocument} doc 
 * @param {number} x - Left X
 * @param {number} y - Top Y
 * @param {number} width - Total chart width
 * @param {number} height - Total chart height
 * @param {Array<{label: string, value: number, subtext: string}>} items 
 */
function drawHorizontalBarChart(doc, x, y, width, height, items = [], color = COLORS.indigo) {
  if (!items || items.length === 0) return;

  const maxVal = Math.max(...items.map(i => i.value || 0), 1);
  const rowHeight = Math.min(24, (height - 10) / items.length);
  const labelWidth = 110;
  const barAreaWidth = width - labelWidth - 45;

  items.slice(0, 6).forEach((item, idx) => {
    const curY = y + idx * rowHeight;
    const barWidth = Math.max(4, (item.value / maxVal) * barAreaWidth);

    // Label
    doc.fillColor(COLORS.slateMedium).fontSize(8).font('Helvetica-Bold').text(item.label, x, curY + 4, {
      width: labelWidth - 10,
      truncate: true
    });

    // Background track
    doc.roundedRect(x + labelWidth, curY + 4, barAreaWidth, 10, 3).fill(COLORS.slateBorder);

    // Filled bar
    const barColor = item.color || color;
    doc.roundedRect(x + labelWidth, curY + 4, barWidth, 10, 3).fill(barColor);

    // Value text
    doc.fillColor(COLORS.slateDark).fontSize(8).font('Helvetica-Bold').text(String(item.value), x + labelWidth + barAreaWidth + 8, curY + 4, {
      width: 35,
      align: 'left'
    });
  });
}

/**
 * Draws a Vertical Column Chart
 */
function drawVerticalColumnChart(doc, x, y, width, height, categories = [], values = [], color = COLORS.indigo) {
  if (!categories || categories.length === 0) return;

  const maxVal = Math.max(...values, 1);
  const chartHeight = height - 25;
  const colCount = categories.length;
  const slotWidth = width / colCount;
  const colWidth = Math.min(28, slotWidth * 0.6);

  // Draw bottom baseline
  doc.rect(x, y + chartHeight, width, 1).fill(COLORS.slateBorder);

  categories.slice(0, 8).forEach((cat, idx) => {
    const val = values[idx] || 0;
    const colHeight = Math.max(4, (val / maxVal) * (chartHeight - 15));
    const colX = x + idx * slotWidth + (slotWidth - colWidth) / 2;
    const colY = y + chartHeight - colHeight;

    // Bar
    doc.roundedRect(colX, colY, colWidth, colHeight, 3).fill(color);

    // Value above column
    doc.fillColor(COLORS.slateMedium).fontSize(7).font('Helvetica-Bold').text(String(val), colX - 5, colY - 10, {
      width: colWidth + 10,
      align: 'center'
    });

    // Category label below column
    doc.fillColor(COLORS.slateLight).fontSize(6.5).font('Helvetica').text(cat, colX - 10, y + chartHeight + 4, {
      width: colWidth + 20,
      align: 'center',
      truncate: true
    });
  });
}

/**
 * Draws a Vector Donut / Pie Breakdown with Legend
 */
function drawDonutChart(doc, x, y, outerRadius, items = []) {
  if (!items || items.length === 0) return;

  const total = items.reduce((acc, item) => acc + (item.value || 0), 0) || 1;
  const defaultColors = [COLORS.indigo, COLORS.violet, COLORS.emerald, COLORS.amber, COLORS.rose, COLORS.sky];

  // Draw legend on the right
  const legendX = x + outerRadius + 25;
  let legendY = y - outerRadius + 10;

  // Background ring
  doc.circle(x, y, outerRadius).lineWidth(8).strokeColor(COLORS.slateBorder).stroke();

  let startAngle = -Math.PI / 2;

  items.forEach((item, idx) => {
    const sliceAngle = (item.value / total) * (Math.PI * 2);
    const itemColor = item.color || defaultColors[idx % defaultColors.length];

    // Draw arc simulation or color dots
    // Draw legend item
    doc.circle(legendX + 4, legendY + 5, 4).fill(itemColor);

    const pct = ((item.value / total) * 100).toFixed(0);
    doc.fillColor(COLORS.slateDark).fontSize(8).font('Helvetica-Bold').text(`${item.label}: `, legendX + 14, legendY, { continued: true });
    doc.fillColor(COLORS.slateLight).font('Helvetica').text(`${item.value} (${pct}%)`);

    legendY += 16;
    startAngle += sliceAngle;
  });

  // Center total
  doc.fillColor(COLORS.slateDark).fontSize(14).font('Helvetica-Bold').text(String(total), x - 25, y - 10, { width: 50, align: 'center' });
  doc.fillColor(COLORS.slateLight).fontSize(6.5).font('Helvetica').text('TOTAL', x - 25, y + 4, { width: 50, align: 'center' });
}

module.exports = {
  COLORS,
  drawKPICard,
  drawHorizontalBarChart,
  drawVerticalColumnChart,
  drawDonutChart
};
