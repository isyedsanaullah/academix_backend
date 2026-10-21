// config/boards/fbise.js
// Configuration and CSV/gazette column mappings for Federal Board of Intermediate and Secondary Education (FBISE), Islamabad.

module.exports = {
  key: 'fbise',
  name: 'FBISE Islamabad',
  fullName: 'Federal Board of Intermediate and Secondary Education, Islamabad',
  province: 'Federal Capital / National',
  classes: ['FSC Part 1', 'FSC Part 2', 'HSSC Part 1', 'HSSC Part 2'],
  candidateTypes: ['regular', 'private', 'improvement', 'compartment'],
  
  // Default fee structure for FBISE
  defaultFees: {
    registration: 1500,
    examAdmissionPart1: 2200,
    examAdmissionPart2: 2500,
    improvementPerSubject: 1200
  },

  // Minimum passing percentage per subject and overall
  passingCriteria: {
    minimumSubjectPercent: 33,
    minimumTotalPercent: 33,
    minimumAttendancePercent: 75
  },

  // Grades calculation rules
  gradeRanges: [
    { min: 80, grade: 'A+', remark: 'Outstanding' },
    { min: 70, grade: 'A', remark: 'Excellent' },
    { min: 60, grade: 'B', remark: 'Very Good' },
    { min: 50, grade: 'C', remark: 'Good' },
    { min: 40, grade: 'D', remark: 'Fair' },
    { min: 33, grade: 'E', remark: 'Satisfactory' },
    { min: 0, grade: 'F', remark: 'Fail' }
  ],

  // Column aliases for CSV/Gazette import mapping
  columnAliases: {
    boardRollNumber: [
      'rollno', 'roll_no', 'roll number', 'roll_number', 'board_roll_no', 'board_roll_number', 'roll'
    ],
    boardRegistrationNo: [
      'regno', 'reg_no', 'registration_no', 'registration number', 'reg_num', 'reg'
    ],
    name: [
      'student_name', 'name', 'candidate_name', 'student'
    ],
    fatherName: [
      'father_name', 'father', 'parent_name', 'guardian_name'
    ],
    group: [
      'group', 'stream', 'discipline', 'group_name'
    ],
    totalMarks: [
      'total_marks', 'total', 'max_marks', 'maximum_marks'
    ],
    totalObtained: [
      'total_obtained', 'obtained_marks', 'obtained', 'marks_obtained', 'marks'
    ],
    percentage: [
      'percentage', 'percent', '%'
    ],
    grade: [
      'grade', 'final_grade', 'letter_grade'
    ],
    status: [
      'status', 'result', 'result_status', 'remarks'
    ],
    part: [
      'part', 'part_no', 'year', 'exam_part'
    ]
  },

  // Helper to compute grade from percentage
  calculateGrade(percentage) {
    if (percentage == null || isNaN(percentage)) return 'F';
    for (const range of this.gradeRanges) {
      if (percentage >= range.min) return range.grade;
    }
    return 'F';
  }
};
