const {
  ALLOWED_DATA_SOURCES,
  ALLOWED_SECTION_TYPES,
  ALLOWED_CHART_TYPES,
  ALLOWED_SCOPES,
  ALLOWED_COLUMNS,
  ALLOWED_SORT_FIELDS
} = require('../config/superAdminReportConstants');

/**
 * Validates and sanitizes an AI-generated Report Specification
 * Ensures AI cannot execute arbitrary database queries or inject unapproved parameters.
 * 
 * @param {object} spec - Raw JSON output from Gemini AI
 * @returns {object} - Sanitized and validated specification
 */
function validateReportSpec(spec) {
  if (!spec || typeof spec !== 'object') {
    throw new Error('Report specification must be a valid JSON object');
  }

  // 1. Validate Report Title & Subtitle
  const reportTitle = typeof spec.reportTitle === 'string' && spec.reportTitle.trim()
    ? spec.reportTitle.trim().substring(0, 100)
    : 'Super Admin Executive Platform Report';

  const reportSubtitle = typeof spec.reportSubtitle === 'string' && spec.reportSubtitle.trim()
    ? spec.reportSubtitle.trim().substring(0, 200)
    : 'System Operational & Institutional Intelligence Summary';

  // 2. Validate Scope
  const rawScope = spec.scope || {};
  const scopeType = ALLOWED_SCOPES.includes(rawScope.type) ? rawScope.type : 'global';
  const collegeId = typeof rawScope.collegeId === 'string' ? rawScope.collegeId.trim() : null;
  const collegeIds = Array.isArray(rawScope.collegeIds)
    ? rawScope.collegeIds.filter(id => typeof id === 'string').slice(0, 20)
    : [];

  const scope = {
    type: scopeType,
    collegeId,
    collegeIds,
    dateRange: null
  };

  if (rawScope.dateRange && typeof rawScope.dateRange === 'object') {
    const start = rawScope.dateRange.startDate ? new Date(rawScope.dateRange.startDate) : null;
    const end = rawScope.dateRange.endDate ? new Date(rawScope.dateRange.endDate) : null;
    if (start && !isNaN(start.getTime()) && end && !isNaN(end.getTime()) && start <= end) {
      scope.dateRange = {
        startDate: start.toISOString(),
        endDate: end.toISOString()
      };
    }
  }

  // 3. Validate Sections
  if (!Array.isArray(spec.sections) || spec.sections.length === 0) {
    throw new Error('Report specification must contain at least one section');
  }

  // Limit max sections to prevent unbounded PDF growth
  const sanitizedSections = [];
  const maxSections = 10;

  for (const rawSec of spec.sections.slice(0, maxSections)) {
    if (!rawSec || typeof rawSec !== 'object') continue;

    // Validate Section Type
    const type = ALLOWED_SECTION_TYPES.includes(rawSec.type) ? rawSec.type : 'text_summary';

    // Validate Data Source
    if (!ALLOWED_DATA_SOURCES.includes(rawSec.dataSource)) {
      throw new Error(`Data source "${rawSec.dataSource}" is not in the allowed data sources list`);
    }
    const dataSource = rawSec.dataSource;

    const title = typeof rawSec.title === 'string' && rawSec.title.trim()
      ? rawSec.title.trim().substring(0, 80)
      : 'Report Section';

    const sec = {
      id: rawSec.id || `sec_${sanitizedSections.length + 1}`,
      title,
      type,
      dataSource
    };

    // Specific validation per section type
    if (type === 'kpi_grid') {
      sec.kpiKeys = Array.isArray(rawSec.kpiKeys)
        ? rawSec.kpiKeys.filter(k => typeof k === 'string').slice(0, 8)
        : [];
    } else if (type === 'chart') {
      sec.chartType = ALLOWED_CHART_TYPES.includes(rawSec.chartType) ? rawSec.chartType : 'horizontal_bar';
      sec.metric = typeof rawSec.metric === 'string' ? rawSec.metric.substring(0, 50) : 'count';
      sec.dimension = typeof rawSec.dimension === 'string' ? rawSec.dimension.substring(0, 50) : 'category';
    } else if (type === 'table') {
      const allowedCols = ALLOWED_COLUMNS[dataSource] || [];
      sec.columns = Array.isArray(rawSec.columns)
        ? rawSec.columns.filter(c => allowedCols.includes(c))
        : allowedCols.slice(0, 6);
      if (sec.columns.length === 0) sec.columns = allowedCols.slice(0, 6);

      const allowedSorts = ALLOWED_SORT_FIELDS[dataSource] || [];
      sec.sortBy = allowedSorts.includes(rawSec.sortBy) ? rawSec.sortBy : allowedSorts[0] || 'created_at';
      sec.sortOrder = rawSec.sortOrder === 'asc' ? 'asc' : 'desc';
      sec.limit = typeof rawSec.limit === 'number' && rawSec.limit > 0 ? Math.min(Math.floor(rawSec.limit), 50) : 20;
    } else if (type === 'notice_box') {
      sec.severity = ['info', 'warning', 'urgent'].includes(rawSec.severity) ? rawSec.severity : 'info';
      sec.message = typeof rawSec.message === 'string' ? rawSec.message.substring(0, 300) : '';
    } else if (type === 'text_summary') {
      sec.content = typeof rawSec.content === 'string' ? rawSec.content.substring(0, 500) : '';
    }

    sanitizedSections.push(sec);
  }

  if (sanitizedSections.length === 0) {
    throw new Error('No valid sections could be constructed from the specification');
  }

  return {
    reportTitle,
    reportSubtitle,
    scope,
    sections: sanitizedSections
  };
}

module.exports = {
  validateReportSpec
};
