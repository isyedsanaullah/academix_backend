// Shared Announcement Constants & Enums

const ANNOUNCEMENT_CATEGORIES = [
  'Emergency',
  'Holiday',
  'Academic',
  'Examination',
  'Fee',
  'Admission',
  'Event',
  'Administration',
  'General'
];

const ANNOUNCEMENT_PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];

const ANNOUNCEMENT_AUDIENCES = [
  'All Users',
  'All Students',
  'All Teachers',
  'Parents',
  'Staff',
  'Faculty',
  'Specific Department',
  'Specific Class'
];

const ANNOUNCEMENT_STATUSES = ['Draft', 'Scheduled', 'Published', 'Archived'];

const REFINEMENT_ACTIONS = ['enhance', 'formal', 'simplify', 'shorten', 'expand', 'rewrite'];

module.exports = {
  ANNOUNCEMENT_CATEGORIES,
  ANNOUNCEMENT_PRIORITIES,
  ANNOUNCEMENT_AUDIENCES,
  ANNOUNCEMENT_STATUSES,
  REFINEMENT_ACTIONS
};
