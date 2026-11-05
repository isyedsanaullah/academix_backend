#### 7D: #98 Canteen POS & Sales Ledger (Premium Tier; Add-on on Standard for PKR 800/mo)

* **Institutional Job:** Front-counter point-of-sale with barcode scanning, student meal accounts, cash handling and daily sales ledgers.
* **Data models:**
  ```prisma
  model CanteenOrder {
    id            String    @id @default(uuid())
    college_id    String
    clientOrderId String    // client-generated UUID for idempotency
    orderNumber   String    // ORD-YYYYMMDD-XXXX
    student_id    String?
    customerType  String    // STUDENT, STAFF, WALK_IN
    paymentMethod String    // CASH, STUDENT_ACCOUNT
    status        String    @default("COMPLETED") // COMPLETED, VOIDED
    subtotalPkr   Int
    discountPkr   Int       @default(0)
    totalPkr      Int
    cashTendered  Int?
    changeGiven   Int?
    cashierId     String    // derived strictly from req.user.id
    shiftId       String?   // shift under which the sale occurred
    voidShiftId   String?   // shift that disbursed a cash refund if voided later
    voidedAt      DateTime?
    createdAt     DateTime  @default(now())

    items CanteenOrderItem[]
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
    costPricePkr Int    // purchase-cost snapshot for margin reports
    subtotalPkr  Int

    order CanteenOrder @relation(fields: [order_id], references: [id], onDelete: Cascade)
    item  CanteenItem  @relation(fields: [item_id], references: [id])
    @@index([order_id])
    @@index([item_id])
  }

  model CashierShift {
    id                     String    @id @default(uuid())
    college_id             String
    cashierId              String
    openedAt               DateTime  @default(now())
    closedAt               DateTime?
    openingCashPkr         Int
    declaredClosingCashPkr Int?
    expectedClosingCashPkr Int?      // opening + cashSales + cashTopups - cashRefunds
    systemCashSalesPkr     Int?
    systemCashTopupsPkr    Int?
    systemCashRefundsPkr   Int?
    discrepancyPkr         Int?      // declared - expected
    status                 String    @default("OPEN") // OPEN, CLOSED
    notes                  String?
    createdAt              DateTime  @default(now())

    @@index([college_id, cashierId, openedAt(sort: Desc)])
  }

  model CashDrawerTransaction {
    id         String   @id @default(uuid())
    college_id String
    shiftId    String
    cashierId  String
    type       String   // SALE, TOPUP, VOID_REFUND, FLOAT_ADJUST
    amountPkr  Int      // positive = inflow, negative = disbursement
    order_id   String?
    notes      String?
    createdAt  DateTime @default(now())

    shift CashierShift @relation(fields: [shiftId], references: [id], onDelete: Restrict)
    @@index([college_id, shiftId, createdAt])
  }

  model MealAccountTransaction {
    id           String   @id @default(uuid())
    college_id   String
    student_id   String
    type         String   // TOPUP, PURCHASE, REFUND, ADJUSTMENT
    amountPkr    Int      // positive = credit, negative = purchase
    balanceAfter Int
    order_id     String?
    cashierId    String
    reason       String?
    createdAt    DateTime @default(now())

    @@index([college_id, student_id, createdAt])
  }

  model CanteenOrderCounter {
    college_id String
    dateKey    String   // YYYYMMDD in Asia/Karachi
    lastSeq    Int      @default(0)
    @@id([college_id, dateKey])
  }
  ```
* **Raw SQL (Prisma cannot express these):**
  ```sql
  -- one open shift per cashier
  CREATE UNIQUE INDEX "one_open_shift_per_cashier"
    ON "CashierShift" ("college_id", "cashierId") WHERE status = 'OPEN';

  -- non-negative meal balance
  ALTER TABLE "StudentMealAccount"
    ADD CONSTRAINT chk_meal_balance_non_neg CHECK ("balancePkr" >= 0);

  -- immutable meal ledger
  CREATE OR REPLACE FUNCTION prevent_meal_txn_mutation() RETURNS TRIGGER AS $$
  BEGIN
    RAISE EXCEPTION 'MealAccountTransaction rows are immutable';
  END;
  $$ LANGUAGE plpgsql;

  CREATE TRIGGER meal_txn_immutable
    BEFORE UPDATE OR DELETE ON "MealAccountTransaction"
    FOR EACH ROW EXECUTE FUNCTION prevent_meal_txn_mutation();
  CREATE TRIGGER meal_txn_no_truncate
    BEFORE TRUNCATE ON "MealAccountTransaction"
    FOR EACH STATEMENT EXECUTE FUNCTION prevent_meal_txn_mutation();
  ```
  *(PostgreSQL does not allow `TRUNCATE` in a row-level trigger; it needs the separate statement-level trigger shown.)*
* **Idempotent checkout:** the POS sends a unique `clientOrderId`. On retry, if the id exists the server compares line items and `totalPkr`. A different payload returns 409 `IDEMPOTENCY_PAYLOAD_MISMATCH`; an identical payload returns the stored order with no re-processing and no second stock decrement.
* **Race-proof stock decrement:**
  ```sql
  UPDATE "CanteenItem" SET "stockQuantity" = "stockQuantity" - $qty
  WHERE id = $itemId AND "stockQuantity" >= $qty;
  ```
  If the affected row count is not 1, the transaction rolls back with 409 `INSUFFICIENT_STOCK`.
* **Daily spending limit (PKT day boundaries):** the meal account row is locked (`SELECT … FROM "StudentMealAccount" WHERE student_id = $1 FOR UPDATE`). Spend is computed over the half-open interval `[startOfDay, nextStartOfDay)` in `Asia/Karachi`. `todaySpent = SUM(purchases) − SUM(refunds)`. The sale is rejected if `todaySpent + orderTotal > dailySpendingLimitPkr`.
* **Void and reversal (within 15 minutes):**
  * `STUDENT_ACCOUNT`: write a `REFUND` `MealAccountTransaction`, restore stock, credit the balance, set `status = 'VOIDED'`.
  * `CASH`: restore stock and mark `VOIDED`. If the original shift is still `OPEN`, the refund is recorded against it. If it is `CLOSED`, cash is disbursed from the **current** cashier's drawer: an `OPEN` shift is required, a `VOID_REFUND` `CashDrawerTransaction` is written under it and `voidShiftId` is set. With no open shift the void fails with 422 `NO_OPEN_SHIFT_FOR_CASH_REFUND`.
* **Shift close reconciliation (computed from immutable rows in one transaction):**
  * `systemCashSales = SUM(amount WHERE type = 'SALE')`; `systemCashTopups = SUM(… 'TOPUP')`; `systemCashRefunds = ABS(SUM(… 'VOID_REFUND'))`.
  * `expectedClosingCash = openingCashPkr + systemCashSales + systemCashTopups − systemCashRefunds`.
  * `discrepancyPkr = declaredClosingCashPkr − expectedClosingCash`, stored permanently.
* **Cashier identity and cash-only top-ups:** `cashierId` always comes from the verified JWT. Counter top-ups are strictly cash-only (`{ studentId, amountPkr }`, requires an `OPEN` shift, writes both a `CashDrawerTransaction(TOPUP)` and a `MealAccountTransaction(TOPUP)`). Online top-ups are deferred until a payment gateway exists (#82 is `coming_soon`).
* **Read-only and add-on lapse:** open shifts may still be closed and reconciled, and history stays viewable. `subscriptionGate('canteen-pos')` blocks **new** shift opens and **new** orders only.
* **APIs:**
  - `GET /api/canteen/items`
  - `POST /api/canteen/shifts/open`
  - `POST /api/canteen/shifts/:id/close`
  - `POST /api/canteen/orders`
  - `GET /api/canteen/student-account/:studentId`
  - `POST /api/canteen/student-account/topup`
  - `POST /api/canteen/orders/:id/void`
  - `GET /api/canteen/daily-report`
* **Frontend (`/canteen/pos`):** touchscreen category grid with search/barcode input, shift open/close reconciliation modal with printable receipt, tender keypad with change calculator, student-card scan showing photo, balance and daily allowance, and a daily revenue and restock summary for the accountant.
* **Definition of Done for 7D:**
  - [x] `CanteenOrder` has `clientOrderId` (unique per college), `status`, `shiftId`, `voidShiftId`.
  - [x] `CanteenOrderItem` captures a `costPricePkr` snapshot.
  - [x] Partial unique index limits each cashier to one `OPEN` shift.
  - [x] `CashDrawerTransaction` separates drawer cash from meal-card ledgers.
  - [x] Immutable `MealAccountTransaction` ledger with non-negative balance check.
  - [x] Idempotent orders with 409 on payload mismatch.
  - [x] Atomic conditional stock decrement.
  - [x] Half-open PKT day interval; refunds net out of daily spend.
  - [x] Cash void disburses from the open shift and logs a drawer transaction.
  - [x] Shift close computes expected cash dynamically.
  - [x] Shift close and history permitted in read-only mode.
  - [x] Gated by `subscriptionGate('canteen-pos')` with a "without add-on" contract test.

