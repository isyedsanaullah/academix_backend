/**
 * Activity Presenter Service
 * Dynamically formats viewer-appropriate titles and descriptions for ActivityLog events.
 */

function formatActivityForViewer(activity, viewerUser) {
  if (!activity) return { title: 'System Event', description: '' };
  
  const viewerRole = viewerUser?.role || 'student';
  const viewerId = viewerUser?.id || viewerUser?._id;

  const {
    action,
    category,
    actorUserId,
    actorNameSnapshot,
    actorRoleSnapshot,
    targetUserId,
    metadata = {},
    status,
    title: fallbackTitle,
    description: fallbackDescription
  } = activity;

  const meta = metadata || {};
  const isActor = actorUserId === viewerId;
  const isTarget = targetUserId === viewerId;
  const actorName = actorNameSnapshot || 'System User';

  switch (action) {
    // ── Authentication ──
    case 'LOGIN':
      if (isActor) {
        return {
          title: 'Account Login',
          description: `You logged into your ${viewerRole} account.`
        };
      }
      return {
        title: 'User Login',
        description: `${actorName} (${actorRoleSnapshot || 'User'}) logged into the system.`
      };

    case 'LOGIN_FAILED':
      if (isActor) {
        return {
          title: 'Failed Login Attempt',
          description: 'A failed login attempt was detected on your account.'
        };
      }
      return {
        title: 'Failed User Login',
        description: `Failed login attempt for ${actorName}.`
      };

    // ── Academic & Study Materials ──
    case 'MATERIAL_UPLOADED':
      if (viewerRole === 'student') {
        return {
          title: '📚 New Study Material',
          description: `${actorName} uploaded new ${meta.subjectName || 'course'} notes.`
        };
      }
      return {
        title: '📚 Study Material Uploaded',
        description: `${meta.subjectName || 'Course'} notes "${meta.materialTitle || meta.title || 'Notes'}" were uploaded by ${actorName}.`
      };

    case 'MATERIAL_UPDATED':
      if (viewerRole === 'student') {
        return {
          title: '📚 Study Material Updated',
          description: `Study notes for ${meta.subjectName || 'your course'} were updated.`
        };
      }
      return {
        title: '📚 Material Updated',
        description: `Material "${meta.materialTitle || 'Notes'}" was updated.`
      };

    // ── Assignments ──
    case 'ASSIGNMENT_CREATED':
      if (viewerRole === 'student') {
        return {
          title: '📝 New Assignment',
          description: `${meta.subjectName ? meta.subjectName + ' ' : ''}Assignment "${meta.assignmentTitle || meta.title || 'Task'}" has been published. Due: ${meta.dueDate || 'Soon'}.`
        };
      }
      return {
        title: '📝 Assignment Created',
        description: `Assignment "${meta.assignmentTitle || meta.title || 'Task'}" created for ${meta.className || 'class'}.`
      };

    case 'ASSIGNMENT_SUBMITTED':
      if (viewerRole === 'teacher' || viewerRole === 'admin' || viewerRole === 'principal') {
        return {
          title: '👨🎓 Assignment Submission',
          description: `${actorName} submitted assignment "${meta.assignmentTitle || 'Assignment'}".`
        };
      }
      if (isActor) {
        return {
          title: '📝 Assignment Submitted',
          description: `You submitted "${meta.assignmentTitle || 'Assignment'}".`
        };
      }
      return {
        title: '📝 Assignment Submission',
        description: `Submission received for "${meta.assignmentTitle || 'Assignment'}".`
      };

    case 'ASSIGNMENT_GRADED':
      if (isTarget || viewerRole === 'student') {
        return {
          title: '🌟 Assignment Graded',
          description: `Your assignment "${meta.assignmentTitle || 'Assignment'}" has been graded: ${meta.grade || meta.score || 'Graded'}.`
        };
      }
      return {
        title: '📝 Assignment Graded',
        description: `Graded ${meta.studentName || 'student'}'s assignment "${meta.assignmentTitle || 'Task'}".`
      };

    // ── Exams & Results ──
    case 'EXAM_ANNOUNCED':
    case 'EXAM_CREATED':
      if (viewerRole === 'student') {
        return {
          title: '📅 Exam Announced',
          description: `${meta.examName || meta.title || 'Examination'} schedule has been published.`
        };
      }
      return {
        title: '📅 Exam Scheduled',
        description: `Exam "${meta.examName || meta.title || 'Examination'}" was announced by ${actorName}.`
      };

    case 'RESULT_PUBLISHED':
    case 'MARKS_ENTERED':
      if (viewerRole === 'student') {
        return {
          title: '📊 Result Published',
          description: `Results for ${meta.examName || 'examination'} have been published.`
        };
      }
      return {
        title: '📊 Result Published',
        description: `Results for ${meta.examName || 'exam'} published by ${actorName}.`
      };

    // ── Attendance ──
    case 'ATTENDANCE_SUBMITTED':
    case 'ATTENDANCE_UPDATED':
      if (viewerRole === 'student') {
        return {
          title: '📋 Attendance Marked',
          description: `Attendance updated for ${meta.date || 'today'}: ${meta.status || 'Marked'}.`
        };
      }
      return {
        title: '📋 Attendance Submitted',
        description: `Attendance for ${meta.className || 'class'} ${meta.sectionName || ''} submitted by ${actorName}.`
      };

    // ── Finance ──
    case 'FEE_GENERATED':
      if (isTarget || viewerRole === 'student') {
        return {
          title: '💰 Fee Voucher Generated',
          description: `Fee voucher generated for ${meta.month || 'current session'}: Rs. ${meta.amount?.toLocaleString() || ''}.`
        };
      }
      return {
        title: '🧾 Fee Invoice Generated',
        description: `Fee voucher generated for ${meta.studentName || meta.className || 'student'}.`
      };

    case 'FEE_PAYMENT_SUBMITTED':
      if (isActor) {
        return {
          title: '💰 Fee Payment Submitted',
          description: `Your payment of Rs. ${meta.amount?.toLocaleString() || ''} was submitted for verification.`
        };
      }
      return {
        title: '💰 Fee Payment Received',
        description: `Payment received from ${meta.studentName || actorName} (Rs. ${meta.amount?.toLocaleString() || ''}).`
      };

    case 'FEE_PAYMENT_VERIFIED':
      if (isTarget || viewerRole === 'student') {
        return {
          title: '💰 Fee Payment Verified',
          description: 'Your fee payment has been verified successfully.'
        };
      }
      return {
        title: '💰 Fee Payment Verified',
        description: `Fee payment verified for ${meta.studentName || 'student'}.`
      };

    case 'FEE_PAYMENT_REJECTED':
    case 'PAYMENT_VERIFICATION_FAILED':
      if (isTarget || viewerRole === 'student') {
        return {
          title: '⚠️ Payment Verification Issue',
          description: 'Your fee payment verification could not be completed. Please check details.'
        };
      }
      return {
        title: '⚠️ Payment Verification Issue',
        description: `Payment verification issue for ${meta.studentName || 'student'}.`
      };

    // ── Communication ──
    case 'ANNOUNCEMENT_CREATED':
    case 'ANNOUNCEMENT_PUBLISHED':
      return {
        title: '📢 New Announcement',
        description: meta.announcementTitle || meta.title || fallbackDescription || 'Important notice published.'
      };

    // ── Admissions & Registration ──
    case 'STUDENT_REGISTERED':
    case 'STUDENT_ENROLLED':
      if (viewerRole === 'registrar' || viewerRole === 'admin' || viewerRole === 'principal') {
        return {
          title: '👨🎓 Student Registered',
          description: `New student ${meta.studentName || actorName} registered in ${meta.className || 'program'}.`
        };
      }
      return {
        title: '👨🎓 Student Enrollment',
        description: `Enrollment updated for ${meta.studentName || 'student'}.`
      };

    case 'DOCUMENT_VERIFIED':
      return {
        title: '📄 Document Verified',
        description: `Admission documents verified for ${meta.studentName || 'student'}.`
      };

    // ── Administration & System ──
    case 'COLLEGE_SETTINGS_UPDATED':
      if (viewerRole === 'superAdmin') {
        return {
          title: '⚙️ College Settings Updated',
          description: `${meta.collegeName || 'College'} administration updated settings.`
        };
      }
      return {
        title: '⚙️ College Settings Updated',
        description: 'Academic session & college settings were updated.'
      };

    case 'COLLEGE_CREATED':
      return {
        title: '🏫 College Created',
        description: `New college "${meta.collegeName || 'Institution'}" registered in system.`
      };

    case 'COLLEGE_UPDATED':
      return {
        title: '🏫 College Updated',
        description: `College profile for "${meta.collegeName || 'Institution'}" updated.`
      };

    case 'PROFILE_UPDATED':
      if (isActor) {
        return {
          title: '👤 Profile Updated',
          description: 'You updated your profile information.'
        };
      }
      return {
        title: '👤 Profile Updated',
        description: `${actorName} updated their profile information.`
      };

    case 'USER_CREATED':
      return {
        title: '👤 New Account Created',
        description: `User account for ${meta.userName || 'new staff'} (${meta.role || 'user'}) was created.`
      };

    case 'ACTION_FAILED':
      return {
        title: '⚠️ System Warning',
        description: fallbackDescription || 'An operation failed or was cancelled.'
      };

    default:
      return {
        title: fallbackTitle || formatActionToTitle(action),
        description: fallbackDescription || `${actorName} performed ${action.toLowerCase().replace(/_/g, ' ')}.`
      };
  }
}

function formatActionToTitle(action) {
  if (!action) return 'Activity Event';
  return action
    .split('_')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

module.exports = {
  formatActivityForViewer,
};
