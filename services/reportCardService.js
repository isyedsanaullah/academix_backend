const PDFDocument = require('pdfkit');
const { getSystemClient } = require('../config/prismaManager');
const prisma = getSystemClient();

/**
 * Digital Report Card & Teacher Remarks Service (N28)
 */

/**
 * Upsert qualitative teacher remarks
 */
async function upsertRemarks({
  collegeId,
  campusId = null,
  studentId,
  sessionId,
  examId,
  classTeacherId,
  remarks,
  conductRating = 'GOOD',
  punctuality = 'REGULAR',
  boardReadiness = 'ON_TRACK',
  isPublished = false,
}) {
  return await prisma.studentReportCardRemark.upsert({
    where: {
      college_id_student_id_examId: {
        college_id: collegeId,
        student_id: studentId,
        examId,
      },
    },
    create: {
      college_id: collegeId,
      campus_id: campusId,
      student_id: studentId,
      session_id: sessionId,
      examId,
      classTeacherId,
      remarks,
      conductRating,
      punctuality,
      boardReadiness,
      isPublished,
      publishedAt: isPublished ? new Date() : null,
    },
    update: {
      classTeacherId,
      remarks,
      conductRating,
      punctuality,
      boardReadiness,
      isPublished,
      publishedAt: isPublished ? new Date() : null,
    },
  });
}

/**
 * Get comprehensive report card data
 */
async function getReportCardData({ collegeId, studentId, examId }) {
  const [student, exam, result, remark] = await Promise.all([
    prisma.student.findUnique({
      where: { id: studentId },
    }),
    prisma.exam.findUnique({
      where: { id: examId },
    }),
    prisma.result.findFirst({
      where: { college_id: collegeId, student_id: studentId, exam_id: examId },
    }),
    prisma.studentReportCardRemark.findUnique({
      where: {
        college_id_student_id_examId: {
          college_id: collegeId,
          student_id: studentId,
          examId,
        },
      },
    }),
  ]);

  if (!student) {
    throw { statusCode: 404, code: 'STUDENT_NOT_FOUND', message: 'Student not found.' };
  }

  // Attendance metrics
  const attendanceRecords = await prisma.attendance.findMany({
    where: {
      college_id: collegeId,
      student_id: studentId,
    },
    select: { status: true },
  });

  const totalMarked = attendanceRecords.length;
  const presentCount = attendanceRecords.filter((a) => a.status === 'PRESENT' || a.status === 'present').length;
  const attendanceRate = totalMarked > 0 ? Math.round((presentCount / totalMarked) * 100) : 100;

  return {
    student: {
      id: student.id,
      name: student.name,
      rollNumber: student.rollNumber,
      class: student.class,
      section: student.section,
      group: student.group,
      session: student.Session?.name || null,
    },
    exam: exam ? { id: exam.id, name: exam.name, type: exam.type } : null,
    result: result
      ? {
          marks: result.marks,
          totalObtained: result.totalObtained,
          totalMarks: result.totalMarks,
          percentage: result.percentage,
          grade: result.grade,
          position: result.position,
        }
      : null,
    attendance: {
      totalMarked,
      presentCount,
      attendanceRate,
    },
    remarks: remark || {
      remarks: 'No qualitative assessment entered yet.',
      conductRating: 'SATISFACTORY',
      punctuality: 'REGULAR',
      boardReadiness: 'ON_TRACK',
      isPublished: false,
    },
  };
}

/**
 * Generate PDF Report Card Document (server-exempt category REPORTS)
 */
async function generateReportCardPdf({ collegeId, studentId, examId }) {
  const cardData = await getReportCardData({ collegeId, studentId, examId });

  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      const buffers = [];

      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve({
          buffer: pdfData,
          contentType: 'application/pdf',
          cardData,
        });
      });

      // Header
      doc.fontSize(20).text('ACADEMIX COLLEGE PROGRESS REPORT', { align: 'center', bold: true });
      doc.moveDown(0.5);
      doc.fontSize(12).text(`Examination: ${cardData.exam?.name || 'Academic Terminal Exam'}`, { align: 'center' });
      doc.moveDown(1);

      // Student info box
      doc.fontSize(10).text(`Student Name: ${cardData.student.name}`);
      doc.text(`Roll Number:  ${cardData.student.rollNumber}`);
      doc.text(`Class & Group: ${cardData.student.class} (${cardData.student.group || 'General'})`);
      doc.moveDown(1);

      // Marks breakdown
      doc.fontSize(12).text('Subject Evaluation', { underline: true });
      doc.moveDown(0.5);
      if (cardData.result && cardData.result.marks && typeof cardData.result.marks === 'object') {
        for (const [subj, score] of Object.entries(cardData.result.marks)) {
          doc.fontSize(10).text(`${subj}: ${score} marks`);
        }
        doc.moveDown(0.5);
        doc.text(`Total Obtained: ${cardData.result.totalObtained} / ${cardData.result.totalMarks || 100}`);
        doc.text(`Percentage: ${Number(cardData.result.percentage || 0).toFixed(1)}%`);
        if (cardData.result.grade) doc.text(`Grade: ${cardData.result.grade}`);
        if (cardData.result.position) doc.text(`Class Position: ${cardData.result.position}`);
      } else {
        doc.fontSize(10).text('Marks evaluation pending entry.');
      }
      doc.moveDown(1);

      // Attendance
      doc.fontSize(12).text('Attendance Profile', { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(10).text(`Attendance Rate: ${cardData.attendance.attendanceRate}% (${cardData.attendance.presentCount} of ${cardData.attendance.totalMarked} days)`);
      doc.moveDown(1);

      // Teacher remarks
      doc.fontSize(12).text('Class Teacher Assessment', { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(10).text(`Conduct Rating: ${cardData.remarks.conductRating}`);
      doc.text(`Punctuality:    ${cardData.remarks.punctuality}`);
      doc.text(`Board Readiness: ${cardData.remarks.boardReadiness}`);
      doc.moveDown(0.5);
      doc.text(`Qualitative Remarks: "${cardData.remarks.remarks}"`, { italic: true });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = {
  upsertRemarks,
  getReportCardData,
  generateReportCardPdf,
};
