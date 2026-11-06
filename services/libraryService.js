'use strict';

const { getSystemClient } = require('../config/prismaManager');
const prisma = getSystemClient();

class LibraryService {
  /**
   * Create or register a new book title in the catalog.
   */
  async createTitle({ collegeId, campusId = null, title, author, isbn = null, edition = null, publisher = null, category = 'TEXTBOOK', ddcClass = null, totalCopies = 1 }) {
    if (!collegeId || !title || !author) {
      const err = new Error('collegeId, title, and author are required');
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    return await prisma.bookTitle.create({
      data: {
        college_id: collegeId,
        campus_id: campusId,
        isbn,
        title,
        author,
        edition,
        publisher,
        category,
        ddcClass,
        totalCopies: Number(totalCopies) || 1,
      },
    });
  }

  /**
   * Add a physical copy with unique accession number & barcode.
   */
  async addCopy({ collegeId, titleId, accessionNumber, barcode, condition = 'GOOD', status = 'AVAILABLE' }) {
    const title = await prisma.bookTitle.findFirst({
      where: { id: titleId, college_id: collegeId },
    });
    if (!title) {
      const err = new Error('Book title not found');
      err.code = 'NOT_FOUND';
      throw err;
    }

    const copy = await prisma.bookCopy.create({
      data: {
        titleId,
        accessionNumber,
        barcode,
        condition,
        status,
      },
    });

    // Update totalCopies on BookTitle
    const totalCount = await prisma.bookCopy.count({ where: { titleId } });
    await prisma.bookTitle.update({
      where: { id: titleId },
      data: { totalCopies: totalCount },
    });

    return copy;
  }

  /**
   * Get title details with strictly derived available copies count.
   */
  async getTitleWithAvailability({ collegeId, titleId }) {
    const title = await prisma.bookTitle.findFirst({
      where: { id: titleId, college_id: collegeId },
      include: {
        copies: true,
      },
    });
    if (!title) {
      const err = new Error('Book title not found');
      err.code = 'NOT_FOUND';
      throw err;
    }

    // Available copies: totalCopies - copies with active issues (returnedAt IS NULL)
    const activeIssuesCount = await prisma.bookIssueRecord.count({
      where: {
        college_id: collegeId,
        copy: { titleId },
        returnedAt: null,
      },
    });

    const availableCopies = Math.max(0, title.totalCopies - activeIssuesCount);
    return {
      ...title,
      availableCopies,
      issuedCopies: activeIssuesCount,
    };
  }

  /**
   * Issue a book copy to a student or staff member.
   * Enforces max active loans per student.
   */
  async issueBook({
    collegeId,
    campusId = null,
    copyId,
    studentId = null,
    userId = null,
    borrowerType = 'STUDENT',
    daysToReturn = 14,
    issuedById,
  }) {
    if (!collegeId || !copyId || !issuedById) {
      const err = new Error('collegeId, copyId, and issuedById are required');
      err.code = 'VALIDATION_ERROR';
      throw err;
    }

    const copy = await prisma.bookCopy.findUnique({
      where: { id: copyId },
      include: { title: true },
    });

    if (!copy || copy.title.college_id !== collegeId) {
      const err = new Error('Book copy not found');
      err.code = 'NOT_FOUND';
      throw err;
    }

    if (copy.status !== 'AVAILABLE') {
      const err = new Error(`Book copy is not available (current status: ${copy.status})`);
      err.code = 'COPY_NOT_AVAILABLE';
      throw err;
    }

    // Check college settings for student loan limit
    if (borrowerType === 'STUDENT' && studentId) {
      const college = await prisma.college.findUnique({
        where: { id: collegeId },
        select: { settings: true },
      });
      const maxBooks = (college && college.settings && college.settings.maxBooksPerStudent) ? Number(college.settings.maxBooksPerStudent) : 2;

      const activeStudentLoans = await prisma.bookIssueRecord.count({
        where: {
          college_id: collegeId,
          student_id: studentId,
          returnedAt: null,
        },
      });

      if (activeStudentLoans >= maxBooks) {
        const err = new Error(`Student has reached maximum active book loan limit of ${maxBooks}`);
        err.code = 'MAX_LOANS_EXCEEDED';
        throw err;
      }
    }

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + Number(daysToReturn));

    return await prisma.$transaction(async (tx) => {
      // Mark copy as ISSUED
      await tx.bookCopy.update({
        where: { id: copyId },
        data: { status: 'ISSUED' },
      });

      // Create issue record
      return await tx.bookIssueRecord.create({
        data: {
          college_id: collegeId,
          campus_id: campusId,
          copyId,
          student_id: studentId,
          userId,
          borrowerType,
          dueDate,
          issuedById,
        },
      });
    });
  }

  /**
   * Return a book copy and calculate overdue fine if applicable.
   */
  async returnBook({ collegeId, issueRecordId, returnDate = new Date() }) {
    const issue = await prisma.bookIssueRecord.findFirst({
      where: { id: issueRecordId, college_id: collegeId },
      include: { copy: true },
    });

    if (!issue) {
      const err = new Error('Issue record not found');
      err.code = 'NOT_FOUND';
      throw err;
    }

    if (issue.returnedAt) {
      const err = new Error('Book has already been returned');
      err.code = 'ALREADY_RETURNED';
      throw err;
    }

    const college = await prisma.college.findUnique({
      where: { id: collegeId },
      select: { settings: true },
    });
    const finePerDay = (college && college.settings && college.settings.libraryFinePerDay) ? Number(college.settings.libraryFinePerDay) : 10;

    const actualReturn = new Date(returnDate);
    const due = new Date(issue.dueDate);
    let fineAmountPkr = 0;
    let fineStatus = 'NONE';

    if (actualReturn > due) {
      const diffMs = actualReturn.getTime() - due.getTime();
      const overdueDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      if (overdueDays > 0) {
        fineAmountPkr = overdueDays * finePerDay;
        fineStatus = 'PENDING';
      }
    }

    return await prisma.$transaction(async (tx) => {
      // Mark copy as AVAILABLE
      await tx.bookCopy.update({
        where: { id: issue.copyId },
        data: { status: 'AVAILABLE' },
      });

      // Update issue record
      return await tx.bookIssueRecord.update({
        where: { id: issueRecordId },
        data: {
          returnedAt: actualReturn,
          fineAmountPkr,
          fineStatus,
        },
      });
    });
  }

  /**
   * List active loans for a student or college.
   */
  async listActiveLoans({ collegeId, studentId = null }) {
    const where = {
      college_id: collegeId,
      returnedAt: null,
    };
    if (studentId) where.student_id = studentId;

    return await prisma.bookIssueRecord.findMany({
      where,
      include: {
        copy: {
          include: { title: true },
        },
      },
      orderBy: { dueDate: 'asc' },
    });
  }
}

module.exports = new LibraryService();

