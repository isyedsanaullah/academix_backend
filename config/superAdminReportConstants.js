/**
 * Canonical Constants & Allowlists for Super Admin PDF Report Engine
 * Enforces strict security boundaries on AI-generated report specifications.
 */

const ALLOWED_DATA_SOURCES = [
  'platform_summary',
  'colleges_list',
  'subscription_breakdown',
  'expiring_subscriptions',
  'activity_audit',
  'college_detail'
];

const ALLOWED_SECTION_TYPES = [
  'kpi_grid',
  'table',
  'chart',
  'notice_box',
  'text_summary'
];

const ALLOWED_CHART_TYPES = [
  'donut',
  'horizontal_bar',
  'vertical_column'
];

const ALLOWED_SCOPES = [
  'global',
  'single_college',
  'multi_college'
];

const ALLOWED_COLUMNS = {
  colleges_list: [
    'code',
    'name',
    'city',
    'plan',
    'status',
    'students_count',
    'staff_count',
    'created_at',
    'expires_at'
  ],
  expiring_subscriptions: [
    'code',
    'name',
    'plan',
    'status',
    'expires_at',
    'days_remaining',
    'email'
  ],
  activity_audit: [
    'action',
    'actor',
    'category',
    'title',
    'created_at'
  ]
};

const ALLOWED_SORT_FIELDS = {
  colleges_list: ['name', 'code', 'city', 'students_count', 'staff_count', 'created_at', 'plan', 'status'],
  expiring_subscriptions: ['expires_at', 'name', 'plan'],
  activity_audit: ['created_at', 'action']
};

module.exports = {
  ALLOWED_DATA_SOURCES,
  ALLOWED_SECTION_TYPES,
  ALLOWED_CHART_TYPES,
  ALLOWED_SCOPES,
  ALLOWED_COLUMNS,
  ALLOWED_SORT_FIELDS
};
