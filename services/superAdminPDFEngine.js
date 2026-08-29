const PDFDocument = require('pdfkit');
const crypto = require('crypto');
const {
  COLORS,
  drawKPICard,
  drawHorizontalBarChart,
  drawVerticalColumnChart,
  drawDonutChart
} = require('./pdfChartRenderer');

// Ephemeral in-memory report cache (Token -> { buffer, metadata, createdAt })
const REPORT_CACHE = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 Hour TTL

// Cleanup expired reports periodically
setInterval(() => {
  const now = Date.now();
  for (const [token, item] of REPORT_CACHE.entries()) {
    if (now - item.createdAt > CACHE_TTL_MS) {
      REPORT_CACHE.delete(token);
    }
  }
}, 15 * 60 * 1000);

/**
 * Builds a multi-section Super Admin PDF Report
 * 
 * @param {object} spec - Validated report specification
 * @param {object} dataBundle - Ground-truth data fetched by superAdminDataService
 * @returns {Promise<{ token: string, title: string, subtitle: string, pageCount: number, buffer: Buffer }>}
 */
async function generateSuperAdminPDF(spec, dataBundle) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });
      const chunks = [];
      let totalPages = 1;

      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const token = crypto.randomUUID();

        const metadata = {
          token,
          title: spec.reportTitle,
          subtitle: spec.reportSubtitle,
          pageCount: totalPages,
          createdAt: Date.now()
        };

        REPORT_CACHE.set(token, { buffer, metadata, createdAt: Date.now() });

        resolve({
          token,
          title: spec.reportTitle,
          subtitle: spec.reportSubtitle,
          pageCount: totalPages,
          buffer
        });
      });

      // ─── 1. COVER / HEADER BANNER ──────────────────────────────────────────
      const pageWidth = 515;
      let currentY = 40;

      // Dark Hero Header
      doc.roundedRect(40, currentY, pageWidth, 75, 8).fill('#0F172A');

      // Academix Branding Mark
      doc.roundedRect(55, currentY + 14, 28, 28, 6).fill(COLORS.indigo);
      doc.fillColor('#FFFFFF').fontSize(14).font('Helvetica-Bold').text('A', 55, currentY + 20, { width: 28, align: 'center' });

      // Title & System Subtitle
      doc.fillColor('#FFFFFF').fontSize(13).font('Helvetica-Bold').text(spec.reportTitle.toUpperCase(), 92, currentY + 16, { width: pageWidth - 110, truncate: true });
      doc.fillColor(COLORS.slateLight).fontSize(8).font('Helvetica').text(spec.reportSubtitle, 92, currentY + 34, { width: pageWidth - 110, truncate: true });

      // Generation Metadata bar inside header
      const dateStr = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      const scopeLabel = spec.scope?.type === 'single_college' ? 'Single Institution Audit' : 'Global Platform Scope';
      doc.fillColor('#94A3B8').fontSize(7.5).font('Helvetica-Bold').text(`ACADEMIX REPORT CENTER  |  Scope: ${scopeLabel}  |  Generated: ${dateStr}`, 92, currentY + 54);

      currentY += 88;

      // ─── 2. RENDER MULTIPLE SECTIONS ───────────────────────────────────────
      for (const section of spec.sections) {
        // Page break check if section doesn't fit
        if (currentY > 680) {
          doc.addPage();
          currentY = 45;
        }

        // Section Title Pill
        doc.roundedRect(40, currentY, pageWidth, 22, 4).fill(COLORS.slateBg);
        doc.fillColor(COLORS.slateDark).fontSize(9.5).font('Helvetica-Bold').text(section.title.toUpperCase(), 50, currentY + 6, { width: pageWidth - 20 });
        currentY += 28;

        // Render based on section type
        if (section.type === 'kpi_grid') {
          const kpis = dataBundle.platformSummary || {};
          const cards = [
            { label: 'Total Colleges', value: kpis.totalColleges ?? 0, sub: 'Registered on Platform', color: COLORS.indigo },
            { label: 'Active Institutions', value: kpis.activeColleges ?? 0, sub: `${kpis.suspendedColleges ?? 0} suspended`, color: COLORS.emerald },
            { label: 'Total Students', value: (kpis.totalStudents ?? 0).toLocaleString(), sub: 'Platform Enrolled', color: COLORS.violet },
            { label: 'Faculty & Staff', value: (kpis.totalStaff ?? 0).toLocaleString(), sub: 'Active Accounts', color: COLORS.amber }
          ];

          const cardWidth = (pageWidth - 24) / 4;
          const cardHeight = 52;

          cards.forEach((c, idx) => {
            drawKPICard(doc, 40 + idx * (cardWidth + 8), currentY, cardWidth, cardHeight, c.label, c.value, c.sub, c.color);
          });

          currentY += cardHeight + 14;
        } else if (section.type === 'chart') {
          const chartHeight = 110;

          if (section.chartType === 'donut' || section.dataSource === 'subscription_breakdown') {
            const subData = dataBundle.subscriptionBreakdown || { basic: 0, standard: 0, premium: 0 };
            const items = [
              { label: 'Basic Tier', value: subData.basic || 0, color: '#64748B' },
              { label: 'Standard Tier', value: subData.standard || 0, color: COLORS.indigo },
              { label: 'Premium Tier', value: subData.premium || 0, color: COLORS.violet }
            ];
            drawDonutChart(doc, 100, currentY + 45, 38, items);
          } else {
            // Horizontal Bar Chart of top colleges or status
            const colleges = dataBundle.collegesList || [];
            const barItems = colleges.slice(0, 5).map(c => ({
              label: c.name,
              value: c.students_count || 0
            }));
            drawHorizontalBarChart(doc, 45, currentY, pageWidth - 10, chartHeight, barItems, COLORS.indigo);
          }

          currentY += chartHeight + 12;
        } else if (section.type === 'table') {
          let rows = [];
          let colHeaders = [];
          let colKeys = section.columns || [];

          if (section.dataSource === 'colleges_list') {
            rows = dataBundle.collegesList || [];
            colHeaders = colKeys.map(k => k.replace('_', ' ').toUpperCase());
          } else if (section.dataSource === 'expiring_subscriptions') {
            rows = dataBundle.expiringSubscriptions || [];
            colKeys = ['code', 'name', 'plan', 'status', 'expires_at', 'days_remaining'];
            colHeaders = ['CODE', 'COLLEGE NAME', 'PLAN', 'STATUS', 'EXPIRY DATE', 'REMAINING'];
          } else if (section.dataSource === 'activity_audit') {
            rows = dataBundle.activityAudit || [];
            colKeys = ['created_at', 'actor', 'action', 'title'];
            colHeaders = ['TIMESTAMP', 'ACTOR', 'ACTION', 'DESCRIPTION'];
          }

          const colCount = Math.max(colKeys.length, 1);
          const colWidth = pageWidth / colCount;

          // Table Header
          doc.rect(40, currentY, pageWidth, 18).fill('#1E293B');
          doc.fillColor('#FFFFFF').fontSize(7.5).font('Helvetica-Bold');
          colHeaders.forEach((h, cIdx) => {
            doc.text(h, 45 + cIdx * colWidth, currentY + 5, { width: colWidth - 8, truncate: true });
          });
          currentY += 18;

          // Table Rows
          rows.slice(0, section.limit || 15).forEach((row, rIdx) => {
            if (currentY > 740) {
              doc.addPage();
              currentY = 45;
              // Repeat header on new page
              doc.rect(40, currentY, pageWidth, 18).fill('#1E293B');
              doc.fillColor('#FFFFFF').fontSize(7.5).font('Helvetica-Bold');
              colHeaders.forEach((h, cIdx) => {
                doc.text(h, 45 + cIdx * colWidth, currentY + 5, { width: colWidth - 8, truncate: true });
              });
              currentY += 18;
            }

            const bgColor = rIdx % 2 === 0 ? '#F8FAFC' : '#FFFFFF';
            doc.rect(40, currentY, pageWidth, 16).fill(bgColor);
            doc.fillColor(COLORS.slateMedium).fontSize(7.5).font('Helvetica');

            colKeys.forEach((key, cIdx) => {
              doc.text(String(row[key] ?? ''), 45 + cIdx * colWidth, currentY + 4, {
                width: colWidth - 8,
                truncate: true
              });
            });

            currentY += 16;
          });

          if (rows.length === 0) {
            doc.rect(40, currentY, pageWidth, 20).fill('#F8FAFC');
            doc.fillColor('#94A3B8').fontSize(8).font('Helvetica-Oblique').text('No records found for this data source.', 40, currentY + 6, { align: 'center', width: pageWidth });
            currentY += 20;
          }

          currentY += 14;
        } else if (section.type === 'notice_box') {
          const boxColor = section.severity === 'urgent' ? '#FEF2F2' : section.severity === 'warning' ? '#FFFBEB' : '#EFF6FF';
          const borderColor = section.severity === 'urgent' ? COLORS.rose : section.severity === 'warning' ? COLORS.amber : COLORS.indigo;
          const msg = section.message || 'System notification and administrative advisory.';

          doc.roundedRect(40, currentY, pageWidth, 36, 4).fillAndStroke(boxColor, borderColor);
          doc.fillColor(COLORS.slateDark).fontSize(8).font('Helvetica-Bold').text('ADMINISTRATIVE NOTICE: ', 50, currentY + 8, { continued: true });
          doc.font('Helvetica').text(msg, { width: pageWidth - 25 });

          currentY += 46;
        } else if (section.type === 'text_summary') {
          doc.fillColor(COLORS.slateMedium).fontSize(8.5).font('Helvetica').text(section.content || 'Report section summary.', 40, currentY, { width: pageWidth, lineGap: 3 });
          currentY += 30;
        }
      }

      // ─── 3. DYNAMIC FOOTER & PAGE NUMBERING ────────────────────────────────
      const range = doc.bufferedPageRange();
      if (range && range.count) {
        totalPages = range.count;
      }
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        doc.rect(40, 795, pageWidth, 1).fill(COLORS.slateBorder);
        doc.fillColor(COLORS.slateLight).fontSize(7.5).font('Helvetica').text(
          'Academix Educational Management Systems — Confidential Super Admin Report',
          40,
          805,
          { width: pageWidth - 100 }
        );
        doc.fillColor(COLORS.slateLight).fontSize(7.5).font('Helvetica-Bold').text(
          `Page ${i + 1} of ${range.count}`,
          pageWidth - 40,
          805,
          { width: 80, align: 'right' }
        );
      }

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

function getReportByToken(token) {
  if (!token || !REPORT_CACHE.has(token)) return null;
  return REPORT_CACHE.get(token);
}

module.exports = {
  generateSuperAdminPDF,
  getReportByToken
};
