#### 7C: #78 Universal Master Timetable (Standard Tier)

* **Institutional Job:** Conflict-free institution-wide timetable grid coordinating classes, subjects, faculty availability and rooms on a single screen.
* **Reconciliation of existing tables:** unifies #4 Timetable (legacy JSON slots), #76 `TimetableSubstitution` and #97 `TimetableDraft`.
* **Relational schema (replaces unstructured JSON slots):**
  * `TimetableProfile`: `id`, `college_id`, `name`, `type` (NORMAL, FRIDAY, RAMADAN, SUMMER, SHIFT_MORNING, SHIFT_EVENING), `effectiveFrom`, `effectiveTo?`, `version Int @default(1)`, `isDraft Boolean @default(true)`, `isActive Boolean @default(false)`.
    * **Multi-profile coexistence:** profiles of different types can be active simultaneously (e.g. NORMAL Mon–Thu/Sat and FRIDAY on Friday). At most one `isActive = true` profile per `(college_id, type)`. Publishing deactivates only the prior active profile of the **same type**. The query layer resolves the applicable schedule from day-of-week and date range.
  * `TimetablePeriod`: `id`, `college_id`, `profile_id`, `periodNumber`, `name`, `startTime` (HH:mm), `endTime` (HH:mm), `isBreak`. `@@unique([profile_id, periodNumber])`.
  * `TimetableEntry`: `id`, `college_id`, `profile_id`, `period_id`, `dayOfWeek` (1=Mon … 6=Sat), `periodNumber`, `subject_id`, `teacher_id`, `room_id?`.
    * FK `period → TimetablePeriod` with `onDelete: Cascade`.
    * `@@unique([college_id, profile_id, dayOfWeek, periodNumber, teacher_id])` (a teacher cannot teach two classes at once).
    * `@@unique([college_id, profile_id, dayOfWeek, periodNumber, room_id])` (a room cannot hold two classes at once).
    * `@@unique([id, college_id, profile_id, dayOfWeek, periodNumber])` (target of the composite FK below).
  * `TimetableEntrySection` (join table with denormalized schedule keys):
    ```prisma
    model TimetableEntrySection {
      id           String @id @default(uuid())
      entry_id     String
      section_id   String
      batchKey     String @default("ALL")
      college_id   String
      profile_id   String
      dayOfWeek    Int
      periodNumber Int

      entry TimetableEntry @relation(fields: [entry_id, college_id, profile_id, dayOfWeek, periodNumber], references: [id, college_id, profile_id, dayOfWeek, periodNumber], onDelete: Cascade, onUpdate: Cascade)
      @@unique([college_id, profile_id, dayOfWeek, periodNumber, section_id, batchKey])
      @@index([entry_id])
    }
    ```
    * **Section-clash index and drift prevention:** denormalizing the schedule keys enables a compound unique index that prevents section collisions. The **composite foreign key** with `ON UPDATE CASCADE` stops the denormalized fields drifting from the parent entry.
* **Entry swapping (built behaviour):** unique constraints are non-deferrable and Prisma cannot declare `DEFERRABLE INITIALLY DEFERRED`. Swaps are therefore executed using **temporary negative `periodNumber` values inside a single transaction** (e.g. `entryA.periodNumber = -periodNumberA`, `entryB.periodNumber = periodNumberA`, `entryA.periodNumber = periodNumberB`). This preserves entry IDs and cascaded relations without deleting records.
* **Per-profile advisory lock on edits:** every write to a profile first runs `SELECT pg_advisory_xact_lock(hashtext('timetable_profile_' || <profile_id>))` (transaction-scoped, safe behind the Neon pooler). This serializes concurrent edits and makes the `batchKey` exclusivity check race-free.
* **Combined classes (#8) and practical batches (#46):**
  * Combined: several `TimetableEntrySection` rows attach to one entry (e.g. Sections A and B share Islamic Studies in Lecture Hall 1, `batchKey = 'ALL'`).
  * Practical batches: several entries can share a period for the same section with different `batchKey` values (Batch-A in Physics Lab, Batch-B in Chemistry Lab).
  * **Batch exclusivity:** `batchKey = 'ALL'` is exclusive for a section in a slot. If an `'ALL'` entry exists, adding another entry for that section/period is rejected; if split batches exist, adding `'ALL'` is rejected.
* **Leave clashes are warnings, not blocks:** periods that overlap approved staff leave produce a `LEAVE_CLASH_WARNING` in the publish report and a substitution suggestion (#76). They never block publishing.
* **Draft and publish with optimistic versioning:** edits happen in draft profiles. Publishing takes the advisory lock, checks `profile.version === expectedVersion`, verifies zero hard conflicts, then atomically deactivates the prior same-type profile and sets `isActive = true, isDraft = false`.
* **Qualification and substitution integration:**
  * Teacher qualification is validated against #18 `TeacherSubject`.
  * **Substitution migration (#76):** existing `TimetableSubstitution` rows reference a string `slotKey`. A migration maps `slotKey` to `TimetableEntry.id` best-effort and adds a nullable `timetableEntry_id` FK.
  * **Legacy JSON adapter (OD-08):** `getLegacyTimetableSlots(collegeId, profileId)` converts relational entries back to the legacy slot JSON for #19, #20, #76 and #97 until they migrate.
* **Pure conflict service:** `backend/services/timetableConflictService.js` exposes `detectConflicts(entries, constraints, leaves)` returning deterministic conflict objects. It is reusable by Phase 13 #102.
* **Generator integration and exempt PDF export:** #97 output feeds a draft `TimetableProfile`. Master-timetable PDFs use category `REPORTS` (server-written, quota-exempt, TTL-purged) so exports work in read-only or over-quota states.
* **Definition of Done for 7C:**
  - [x] Relational `TimetableEntry` (with `period_id` FK) plus denormalized `TimetableEntrySection` replace JSON slots.
  - [x] Composite FK prevents denormalized drift.
  - [x] Swap executes using temporary negative periodNumber values in one transaction.
  - [x] Teacher, room and section clash prevention enforced by unique constraints.
  - [x] Combined classes and practical batches supported with advisory lock plus `batchKey` exclusivity.
  - [x] Multi-profile coexistence enforced per `(college_id, type)`.
  - [x] Leave clashes warn without blocking.
  - [x] Legacy JSON adapter implemented.
  - [x] Substitution `slotKey → timetableEntry_id` migration.
  - [x] Timetable PDF export consumes no tenant storage quota.
  - [x] Pure conflict service ready for #102.

