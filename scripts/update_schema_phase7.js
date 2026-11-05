const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const schemaPath = path.join(__dirname, '../prisma/schema.prisma');
let content = fs.readFileSync(schemaPath, 'utf8');

// 1. Add dispatchedAt to Announcement
if (!content.includes('dispatchedAt')) {
  content = content.replace(
    'model Announcement {',
    'model Announcement {\n  dispatchedAt      DateTime?'
  );
  console.log('Added dispatchedAt to model Announcement');
}

// 2. Add relation fields to College model if not already present
if (!content.includes('uploadReservations UploadReservation[]')) {
  content = content.replace(
    'model College {',
    `model College {
  uploadReservations        UploadReservation[]
  timetableProfiles         TimetableProfile[]
  canteenItems              CanteenItem[]
  cashierShifts             CashierShift[]
  canteenOrders             CanteenOrder[]
  cashDrawerTransactions    CashDrawerTransaction[]
  mealAccounts              StudentMealAccount[]
  mealAccountTransactions   MealAccountTransaction[]`
  );
  console.log('Added Phase 7 relation fields to model College');
}

// 3. Append Phase 7 models if not present
const phase7Models = `
// =============================================================================
// PHASE 7: NEW SERVICES & CORE INFRASTRUCTURE
// =============================================================================

// 7A: File Vault & Storage Quotas
model UploadReservation {
  id                String   @id @default(uuid())
  college_id        String
  category          String   @default("general")
  originalFilename  String
  declaredSizeBytes BigInt
  storageKey        String   @unique
  expiresAt         DateTime
  status            String   @default("PENDING") // PENDING, FINALIZED, ABANDONED
  createdAt         DateTime @default(now())

  college           College  @relation(fields: [college_id], references: [id], onDelete: Cascade)

  @@index([college_id, status, expiresAt])
}

// 7B: Circulars & Push Delivery
model CircularReadReceipt {
  id         String   @id @default(uuid())
  circularId String
  userId     String
  readAt     DateTime @default(now())
  college_id String

  @@unique([circularId, userId])
  @@index([college_id, circularId])
}

// 7C: Timetable Profile Isolation
model TimetableProfile {
  id         String   @id @default(uuid())
  college_id String
  name       String
  type       String   @default("STANDARD") // STANDARD, RAMADAN, EXAM
  isActive   Boolean  @default(false)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  periods    TimetablePeriod[]
  entries    TimetableEntry[]

  college    College  @relation(fields: [college_id], references: [id], onDelete: Cascade)
  @@index([college_id, type, isActive])
}

model TimetablePeriod {
  id           String   @id @default(uuid())
  profile_id   String
  periodNumber Int
  startTime    String   // HH:MM
  endTime      String   // HH:MM
  isBreak      Boolean  @default(false)

  profile      TimetableProfile @relation(fields: [profile_id], references: [id], onDelete: Cascade)
  @@unique([profile_id, periodNumber])
}

model TimetableEntry {
  id         String   @id @default(uuid())
  college_id String
  profile_id String
  dayOfWeek  Int      // 1=Mon .. 7=Sun
  periodNumber Int
  subjectId  String
  teacherId  String
  roomId     String?
  batchKey   String   @default("ALL") // ALL or specific batch

  profile    TimetableProfile @relation(fields: [profile_id], references: [id], onDelete: Cascade)
  sections   TimetableEntrySection[]

  @@index([college_id, profile_id, dayOfWeek, periodNumber])
  @@index([college_id, teacherId, dayOfWeek, periodNumber])
}

model TimetableEntrySection {
  id           String   @id @default(uuid())
  entryId      String
  college_id   String   // denormalized
  profile_id   String   // denormalized
  section_id   String
  dayOfWeek    Int      // denormalized
  periodNumber Int      // denormalized

  entry        TimetableEntry @relation(fields: [entryId], references: [id], onDelete: Cascade)
  @@unique([college_id, profile_id, section_id, dayOfWeek, periodNumber])
  @@index([entryId])
}

// 7D: Canteen POS & Sales Ledger
model CanteenItem {
  id              String   @id @default(uuid())
  college_id      String
  name            String
  barcode         String?
  category        String   @default("general")
  sellingPricePkr Int
  costPricePkr    Int
  stockQuantity   Int      @default(0)
  lowStockAlert   Int      @default(10)
  isActive        Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  college         College  @relation(fields: [college_id], references: [id], onDelete: Cascade)
  orderItems      CanteenOrderItem[]

  @@index([college_id, isActive])
}

model CashierShift {
  id                     String    @id @default(uuid())
  college_id             String
  cashierId              String
  openedAt               DateTime  @default(now())
  closedAt               DateTime?
  openingCashPkr         Int       @default(0)
  declaredClosingCashPkr Int?
  expectedClosingCashPkr Int?
  systemCashSalesPkr     Int?
  systemCashTopupsPkr    Int?
  systemCashRefundsPkr   Int?
  discrepancyPkr         Int?
  status                 String    @default("OPEN") // OPEN, CLOSED
  notes                  String?
  createdAt              DateTime  @default(now())

  college                College   @relation(fields: [college_id], references: [id], onDelete: Cascade)
  orders                 CanteenOrder[]
  cashDrawerTransactions CashDrawerTransaction[]

  @@index([college_id, cashierId, openedAt(sort: Desc)])
}

model CanteenOrder {
  id            String   @id @default(uuid())
  college_id    String
  clientOrderId String   // Client UUID idempotency
  orderNumber   String
  student_id    String?
  customerType  String   // STUDENT, STAFF, WALK_IN
  paymentMethod String   // CASH, WALLET
  status        String   @default("COMPLETED") // COMPLETED, VOIDED
  subtotalPkr   Int
  discountPkr   Int      @default(0)
  totalPkr      Int
  cashTendered  Int?
  changeGiven   Int?
  cashierId     String
  shiftId       String?
  voidShiftId   String?
  voidedAt      DateTime?
  createdAt     DateTime @default(now())

  college       College  @relation(fields: [college_id], references: [id], onDelete: Cascade)
  shift         CashierShift? @relation(fields: [shiftId], references: [id], onDelete: SetNull)
  items         CanteenOrderItem[]

  @@unique([college_id, clientOrderId])
  @@index([college_id, createdAt])
  @@index([shiftId])
}

model CanteenOrderItem {
  id           String @id @default(uuid())
  order_id     String
  item_id      String
  quantity     Int
  unitPricePkr Int
  costPricePkr Int
  subtotalPkr  Int

  order        CanteenOrder @relation(fields: [order_id], references: [id], onDelete: Cascade)
  item         CanteenItem  @relation(fields: [item_id], references: [id], onDelete: Restrict)

  @@index([order_id])
  @@index([item_id])
}

model CashDrawerTransaction {
  id         String   @id @default(uuid())
  college_id String
  shiftId    String
  cashierId  String
  type       String   // SALE, TOPUP, VOID_REFUND, FLOAT_ADJUST
  amountPkr  Int      // Positive = inflow, negative = disbursement
  order_id   String?
  notes      String?
  createdAt  DateTime @default(now())

  college    College      @relation(fields: [college_id], references: [id], onDelete: Cascade)
  shift      CashierShift @relation(fields: [shiftId], references: [id], onDelete: Restrict)

  @@index([college_id, shiftId, createdAt])
}

model StudentMealAccount {
  id                    String   @id @default(uuid())
  college_id            String
  student_id            String   @unique
  balancePkr            Int      @default(0)
  dailySpendingLimitPkr Int      @default(1000)
  status                String   @default("ACTIVE")
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  college               College  @relation(fields: [college_id], references: [id], onDelete: Cascade)

  @@index([college_id, student_id])
}

model MealAccountTransaction {
  id              String   @id @default(uuid())
  college_id      String
  student_id      String
  type            String   // PURCHASE, TOPUP, REFUND
  amountPkr       Int
  balanceAfterPkr Int
  order_id        String?
  cashierId       String
  notes           String?
  createdAt       DateTime @default(now())

  college         College  @relation(fields: [college_id], references: [id], onDelete: Cascade)

  @@index([college_id, student_id, createdAt])
}
`;

if (!content.includes('model UploadReservation')) {
  content += phase7Models;
  fs.writeFileSync(schemaPath, content, 'utf8');
  console.log('Appended Phase 7 models to schema.prisma');
} else {
  console.log('Phase 7 models already present in schema.prisma');
}

console.log('Running npx prisma generate...');
try {
  execSync('npx prisma generate', { cwd: path.join(__dirname, '..'), stdio: 'inherit' });
  console.log('Prisma generate complete!');
} catch (e) {
  console.error('Prisma generate failed:', e.message);
  process.exit(1);
}

