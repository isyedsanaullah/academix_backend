const { generateTimetableSchedule, runBenchmark } = require('../services/timetableGenerator.service');
const { generateResponse } = require('../services/aiService');

// ─── 1. Generate Timetable Draft ─────────────────────────────────────────────
exports.generateDraft = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { sessionId, options = {} } = req.body;

    // Load data from tenant DB
    const [sections, subjects, teacherSubjects, constraints, combinedClasses] = await Promise.all([
      tenantDb.section.findMany({
        where: { college_id: req.collegeId },
        select: { id: true, name: true, code: true, class: true, group: true }
      }),
      tenantDb.subject.findMany({
        where: { college_id: req.collegeId },
        select: { id: true, name: true, code: true, isPractical: true, weeklyLoad: true, teacher_id: true }
      }),
      tenantDb.teacherSubject.findMany({
        where: { college_id: req.collegeId }
      }),
      tenantDb.timetableConstraint.findMany({
        where: {
          college_id: req.collegeId,
          ...(sessionId ? { OR: [{ session_id: sessionId }, { session_id: null }] } : {})
        }
      }),
      tenantDb.combinedClass ? tenantDb.combinedClass.findMany({
        where: { college_id: req.collegeId, isActive: true }
      }) : []
    ]);

    // Execute CSP scheduling algorithm
    const result = generateTimetableSchedule({
      sections,
      subjects,
      teacherSubjects,
      constraints,
      combinedClasses,
      options: {
        periodsPerDay: options.periodsPerDay || 8,
        workingDays: options.workingDays,
        timeLimitMs: options.timeLimitMs || 20000
      }
    });

    // Store generated draft
    const draft = await tenantDb.timetableDraft.create({
      data: {
        college_id: req.collegeId,
        session_id: sessionId || null,
        name: options.name || `Draft ${new Date().toLocaleDateString('en-CA')}`,
        hardScore: result.hardScore,
        softScore: result.softScore,
        unplacedPeriods: result.unplacedPeriods,
        clashes: [],
        grid: result.grid,
        options,
        status: 'draft',
        createdBy: req.user.id
      }
    });

    res.status(201).json({
      success: true,
      draftId: draft.id,
      data: {
        ...draft,
        _id: draft.id,
        stats: result.stats
      }
    });
  } catch (error) { next(error); }
};

// ─── 2. Get Draft by ID ──────────────────────────────────────────────────────
exports.getDraft = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const draft = await tenantDb.timetableDraft.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!draft) return res.status(404).json({ success: false, message: 'Draft not found' });

    res.json({ success: true, data: { ...draft, _id: draft.id } });
  } catch (error) { next(error); }
};

// ─── 3. List All Drafts ──────────────────────────────────────────────────────
exports.listDrafts = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const drafts = await tenantDb.timetableDraft.findMany({
      where: { college_id: req.collegeId },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ success: true, data: drafts.map(d => ({ ...d, _id: d.id })) });
  } catch (error) { next(error); }
};

// ─── 4. Apply Draft to Live Timetable with Diff ───────────────────────────────
exports.applyDraft = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const draft = await tenantDb.timetableDraft.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!draft) return res.status(404).json({ success: false, message: 'Draft not found' });

    if (draft.hardScore > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot apply draft with hard constraint violations'
      });
    }

    const grid = draft.grid || [];

    // Calculate diff against current live timetable
    const currentTimetables = await tenantDb.timetable.findMany({
      where: { college_id: req.collegeId, isActive: true }
    });

    const currentMap = new Map();
    currentTimetables.forEach(t => {
      currentMap.set(`${t.class}_${t.section}_${t.day}`, t);
    });

    let addedEntries = 0;
    let modifiedEntries = 0;
    const diff = [];

    grid.forEach(item => {
      const key = `${item.class}_${item.section}_${item.day}`;
      const existing = currentMap.get(key);
      if (!existing) {
        addedEntries++;
        diff.push({ type: 'added', class: item.class, section: item.section, day: item.day, periodsCount: item.periods.length });
      } else {
        modifiedEntries++;
        diff.push({ type: 'modified', class: item.class, section: item.section, day: item.day, oldId: existing.id });
      }
    });

    // Check if dry run was requested
    if (req.query?.dryRun === 'true' || req.body?.dryRun) {
      return res.json({
        success: true,
        dryRun: true,
        diff: {
          addedEntries,
          modifiedEntries,
          totalEntries: grid.length,
          changes: diff
        }
      });
    }

    // Apply inside transaction
    await tenantDb.$transaction(async (tx) => {
      for (const item of grid) {
        // Delete existing timetable for class, section and day
        await tx.timetable.deleteMany({
          where: {
            college_id: req.collegeId,
            class: item.class,
            section: item.section,
            day: item.day
          }
        });

        // Create new live timetable entry
        await tx.timetable.create({
          data: {
            college_id: req.collegeId,
            class: item.class,
            section: item.section,
            group: item.group || null,
            day: item.day,
            periods: item.periods || [],
            isActive: true,
            createdBy: req.user.id
          }
        });
      }

      // Mark draft as applied
      await tx.timetableDraft.update({
        where: { id: draft.id },
        data: {
          status: 'applied',
          appliedAt: new Date(),
          appliedBy: req.user.id
        }
      });
    });

    res.json({
      success: true,
      message: 'Draft successfully applied to live timetable',
      diff: {
        appliedCount: grid.length,
        addedEntries,
        modifiedEntries
      }
    });
  } catch (error) { next(error); }
};

// ─── 5. Delete Draft ─────────────────────────────────────────────────────────
exports.deleteDraft = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const draft = await tenantDb.timetableDraft.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!draft) return res.status(404).json({ success: false, message: 'Draft not found' });

    await tenantDb.timetableDraft.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Draft deleted successfully' });
  } catch (error) { next(error); }
};

// ─── 6. AI Assist: Explain Unplaced Periods (Anonymised) ─────────────────────
exports.explainDraft = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const draft = await tenantDb.timetableDraft.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!draft) return res.status(404).json({ success: false, message: 'Draft not found' });

    const unplaced = draft.unplacedPeriods || [];

    // Anonymise IDs (only T1, T2, S1, etc. — NEVER names, phones, or student data)
    const teacherMap = new Map();
    let teacherCounter = 1;

    const anonymisedUnplaced = unplaced.map(u => {
      let anonT = 'Unassigned';
      if (u.teacherId) {
        if (!teacherMap.has(u.teacherId)) {
          teacherMap.set(u.teacherId, `Teacher_T${teacherCounter++}`);
        }
        anonT = teacherMap.get(u.teacherId);
      }

      return {
        subject: u.subjectName || 'Subject',
        teacherRef: anonT,
        isPractical: !!u.isPractical,
        isDouble: !!u.isDouble,
        ruleReason: u.reason || 'Conflict with teacher availability or section capacity'
      };
    });

    // Rule-based explanation (default / fallback)
    const ruleBasedReasons = unplaced.length === 0
      ? ['All periods successfully placed without conflict.']
      : anonymisedUnplaced.map(item =>
          `${item.subject} (${item.teacherRef}): ${item.ruleReason}`
        );

    const defaultSuggestions = [
      'Assign an additional co-teacher via TeacherSubject mapping to distribute peak period loads.',
      'Allow single-period distribution instead of consecutive double-periods for practical sessions.',
      'Relax teacher unavailability constraints on constrained working days.'
    ];

    let aiExplanation = null;
    let suggestions = defaultSuggestions;

    // Try invoking AI service if unplaced periods exist
    if (unplaced.length > 0) {
      try {
        const prompt = `You are a high school timetable scheduling assistant.
Explain the following anonymised scheduling conflicts concisely and provide 3 concrete suggestions to resolve them:
Unplaced Periods Summary:
${JSON.stringify(anonymisedUnplaced, null, 2)}

Provide your response in JSON format with two keys:
"summary": "plain language explanation of the scheduling bottleneck",
"suggestions": ["Suggestion 1", "Suggestion 2", "Suggestion 3"]`;

        const responseText = await generateResponse({
          collegeId: req.collegeId,
          userId: req.user.id,
          systemPrompt: 'You are an academic scheduling expert. Output only valid JSON.',
          userMessage: prompt
        });

        if (responseText) {
          const cleaned = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
          const parsed = JSON.parse(cleaned);
          if (parsed.summary) aiExplanation = parsed.summary;
          if (Array.isArray(parsed.suggestions) && parsed.suggestions.length >= 3) {
            suggestions = parsed.suggestions;
          }
        }
      } catch (aiErr) {
        // Fall back to rule-based reasons only if AI is unavailable or quota depleted
        aiExplanation = null;
      }
    }

    res.json({
      success: true,
      data: {
        unplacedCount: unplaced.length,
        anonymisedSummary: anonymisedUnplaced,
        reasons: ruleBasedReasons,
        explanation: aiExplanation || (unplaced.length === 0
          ? 'Draft timetable achieved 100% placement with zero constraint violations.'
          : ruleBasedReasons.join(' ')),
        suggestions
      }
    });
  } catch (error) { next(error); }
};

// ─── 7. Constraints CRUD (for Constraints Screen) ────────────────────────────
exports.getConstraints = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { kind, sessionId } = req.query;

    const where = { college_id: req.collegeId };
    if (kind) where.kind = kind;
    if (sessionId) where.session_id = sessionId;

    const constraints = await tenantDb.timetableConstraint.findMany({ where, orderBy: { createdAt: 'desc' } });
    res.json({ success: true, data: constraints.map(c => ({ ...c, _id: c.id })) });
  } catch (error) { next(error); }
};

exports.createConstraint = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const { session_id, kind, teacher_id, subject_id, section_id, data } = req.body;

    if (!kind || !data) {
      return res.status(400).json({ success: false, message: 'kind and data are required' });
    }

    const constraint = await tenantDb.timetableConstraint.create({
      data: {
        college_id: req.collegeId,
        session_id: session_id || null,
        kind,
        teacher_id: teacher_id || null,
        subject_id: subject_id || null,
        section_id: section_id || null,
        data: data || {}
      }
    });

    res.status(201).json({ success: true, data: { ...constraint, _id: constraint.id } });
  } catch (error) { next(error); }
};

exports.deleteConstraint = async (req, res, next) => {
  try {
    const tenantDb = req.tenantClient;
    const existing = await tenantDb.timetableConstraint.findFirst({
      where: { id: req.params.id, college_id: req.collegeId }
    });
    if (!existing) return res.status(404).json({ success: false, message: 'Constraint not found' });

    await tenantDb.timetableConstraint.delete({ where: { id: req.params.id } });
    res.json({ success: true, message: 'Constraint deleted' });
  } catch (error) { next(error); }
};

// ─── 8. Benchmark Endpoint (Phase 16 Deliverable) ─────────────────────────────
exports.getBenchmark = async (req, res, next) => {
  try {
    const benchmarkResults = runBenchmark();
    res.json({ success: true, data: benchmarkResults });
  } catch (error) { next(error); }
};
