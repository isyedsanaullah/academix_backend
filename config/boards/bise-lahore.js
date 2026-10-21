// config/boards/bise-lahore.js
// Configuration and CSV/gazette column mappings for Board of Intermediate & Secondary Education (BISE), Lahore.

module.exports = {
  key: 'bise-lahore',
  name: 'BISE Lahore',
  fullName: 'Board of Intermediate and Secondary Education, Lahore',
  province: 'Punjab',
  classes: ['FSC Part 1', 'FSC Part 2', 'FA Part 1', 'FA Part 2'],
  candidateTypes: ['regular', 'private', 'improvement', 'compartment'],

  defaultFees: {
    registration: 1400,
    examAdmissionPart1: 2100,
    examAdmissionPart2: 2400,
    improvementPerSubject: 1100
  },

  passingCriteria: {
    minimumSubjectPercent: 33,
    minimumTotalPercent: 33,
    minimumAttendancePercent: 75
  },

  gradeRanges: [
    { min: 80, grade: 'A+', remark: 'Outstanding' },
    { min: 70, grade: 'A', remark: 'Excellent' },
    { min: 60, grade: 'B', remark: 'Very Good' },
    { min: 50, grade: 'C', remark: 'Good' },
    { min: 40, grade: 'D', remark: 'Fair' },
    { min: 33, grade: 'E', remark: 'Satisfactory' },
    { min: 0, grade: 'F', remark: 'Fail' }
  ],

  columnAliases: {
    boardRollNumber: [
      'rollno', 'roll_no', 'roll number', 'roll_number', 'board_roll_no', 'roll'
    ],
    boardRegistrationNo: [
      'regno', 'reg_no', 'registration_no', 'registration number', 'reg_num', 'reg'
    ],
    name: [
      'student_name', 'name', 'candidate_name', 'student'
    ],
    fatherName: [
      'father_name', 'father', 'parent_name'
    ],
    group: [
      'group', 'stream', 'discipline'
    ],
    totalMarks: [
      'total_marks', 'total', 'max_marks'
    ],
    totalObtained: [
      'total_obtained', 'obtained_marks', 'obtained', 'marks_obtained', 'marks'
    ],
    percentage: [
      'percentage', 'percent', '%'
    ],
    grade: [
      'grade', 'final_grade'
    ],
    status: [
      'status', 'result', 'result_status', 'remarks'
    ],
    part: [
      'part', 'part_no', 'year'
    ]
  },

  calculateGrade(percentage) {
    if (percentage == null || isNaN(percentage)) return 'F';
    for (const range of this.gradeRanges) {
      if (percentage >= range.min) return range.grade;
    }
    return 'F';
  }
};
