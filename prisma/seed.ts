/**
 * Demo seed — Kijani Fresh Foods, a Nairobi grocery & fresh produce shop.
 *
 * Creates a complete, realistic dataset: products, customers, 90 days of
 * sales (mostly M-Pesa), matching M-Pesa transactions, expenses and the
 * demo user. Run with:  npx prisma db seed
 */
import { Prisma, PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { addDays, format, setHours, setMinutes } from "date-fns";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }),
});

// Deterministic RNG so reseeding produces identical data.
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(42);
const pick = <T,>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
const between = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;

const PRODUCTS = [
  { name: "Sukuma Wiki (bunch)", category: "Fresh produce", unit: "bunch", cost: 15, sell: 25, stock: 40, threshold: 15 },
  { name: "Tomatoes (kg)", category: "Fresh produce", unit: "kg", cost: 45, sell: 70, stock: 18, threshold: 10 },
  { name: "Onions (kg)", category: "Fresh produce", unit: "kg", cost: 55, sell: 80, stock: 12, threshold: 10 },
  { name: "Maize Flour 2kg", category: "Staples", unit: "pkt", cost: 130, sell: 165, stock: 60, threshold: 20 },
  { name: "Cooking Oil 1L", category: "Staples", unit: "btl", cost: 220, sell: 265, stock: 24, threshold: 8 },
  { name: "Sugar 1kg", category: "Staples", unit: "pkt", cost: 140, sell: 170, stock: 30, threshold: 10 },
  { name: "Milk 500ml", category: "Dairy", unit: "pkt", cost: 45, sell: 60, stock: 15, threshold: 10 },
  { name: "Bread Loaf", category: "Bakery", unit: "loaf", cost: 45, sell: 55, stock: 20, threshold: 12 },
  { name: "Eggs (tray of 30)", category: "Dairy", unit: "tray", cost: 300, sell: 360, stock: 14, threshold: 5 },
  { name: "Rice 5kg", category: "Staples", unit: "bag", cost: 700, sell: 850, stock: 9, threshold: 5 },
  { name: "Tea Leaves 250g", category: "Beverages", unit: "pkt", cost: 350, sell: 420, stock: 7, threshold: 4 },
  { name: "Salt 500g", category: "Staples", unit: "pkt", cost: 25, sell: 40, stock: 50, threshold: 20 },
  { name: "Bar Soap", category: "Household", unit: "pcs", cost: 45, sell: 60, stock: 3, threshold: 10 },
  { name: "Airtime KSh 100", category: "Services", unit: "pcs", cost: 96, sell: 100, stock: 45, threshold: 20 },
  { name: "Detergent 1kg", category: "Household", unit: "pkt", cost: 180, sell: 220, stock: 2, threshold: 6 },
  { name: "Toothpaste", category: "Personal care", unit: "pcs", cost: 120, sell: 160, stock: 25, threshold: 8 },
] as const;

const CUSTOMERS = [
  { name: "Grace Wanjiru", phone: "0722114556", location: "Nakuru", loyalty: 240 },
  { name: "David Otieno", phone: "0733445667", location: "Kisumu", loyalty: 180 },
  { name: "Amina Hassan", phone: "0711223344", location: "Mombasa", loyalty: 320 },
  { name: "Peter Kipchoge", phone: "0725998877", location: "Eldoret", loyalty: 95 },
  { name: "Mercy Achieng", phone: "0701233445", location: "Nairobi", loyalty: 410 },
  { name: "James Mwangi", phone: "0740556677", location: "Thika", loyalty: 60 },
  { name: "Lucy Njeri", phone: "0728887766", location: "Kiambu", loyalty: 150 },
  { name: "Samuel Wekesa", phone: "0719445566", location: "Bungoma", loyalty: 20 },
] as const;

const WALKIN_PHONES = ["0700123456", "0733123456", "0745123456", "0725123456", "0715123456"];

function randomPhone(): string {
  return pick(WALKIN_PHONES);
}

/** 07XX XXX XXX */
function toLocalPhone(national: string): string {
  return `0${national.slice(3)}`;
}

function buildReceiptNo(date: Date, seq: number): string {
  return `RCP-${format(date, "yyyyMMdd")}-${String(seq).padStart(4, "0")}`;
}

function mpesaReceipt(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 7; i++) out += chars[Math.floor(rand() * chars.length)];
  return `SFT${out}`;
}

async function main() {
  console.log("🌱 Seeding M-Pesa Business Manager demo data…");

  // Clean slate for the demo org.
  const existing = await prisma.organization.findUnique({
    where: { slug: "kijani-fresh-foods" },
  });
  if (existing) {
    await prisma.organization.delete({ where: { id: existing.id } });
  }

  const org = await prisma.organization.create({
    data: {
      name: "Kijani Fresh Foods",
      slug: "kijani-fresh-foods",
      tier: "PRO",
      businessType: "Grocery & Fresh Produce",
    },
  });

  await prisma.organizationMember.createMany({
    data: [
      {
        organizationId: org.id,
        userId: "demo-user",
        role: "OWNER",
        firstName: "Demo",
        lastName: "Owner",
      },
      {
        organizationId: org.id,
        userId: "00000000-0000-0000-0000-000000000002",
        role: "STAFF",
        firstName: "Brian",
        lastName: "Kiptoo",
      },
    ],
  });

  // Products
  const productRecords = [];
  for (const p of PRODUCTS) {
    productRecords.push(
      await prisma.product.create({
        data: {
          organizationId: org.id,
          name: p.name,
          category: p.category,
          unit: p.unit,
          costPrice: new Prisma.Decimal(p.cost),
          sellingPrice: new Prisma.Decimal(p.sell),
          stock: p.stock,
          lowStockThreshold: p.threshold,
        },
      }),
    );
  }

  // Customers
  const customerRecords = [];
  for (const c of CUSTOMERS) {
    customerRecords.push(
      await prisma.customer.create({
        data: {
          organizationId: org.id,
          name: c.name,
          phone: `254${c.phone.slice(1)}`,
          location: c.location,
          loyaltyPoints: c.loyalty,
        },
      }),
    );
  }

  // ---- 90 days of sales ------------------------------------------------
  const today = new Date();
  let saleSeq = 0;
  let completedSales = 0;
  let totalRevenue = 0;

  for (let dayOffset = 90; dayOffset >= 0; dayOffset--) {
    const day = addDays(today, -dayOffset);
    const dow = day.getDay();
    // Weekends slightly quieter, Fridays busiest.
    const base = dow === 0 ? 3 : dow === 6 ? 5 : dow === 5 ? 8 : 6;
    const count = Math.max(1, base + between(-2, 3));

    for (let i = 0; i < count; i++) {
      const hour = between(8, 18);
      const minute = between(0, 59);
      const createdAt = setMinutes(setHours(day, hour), minute);

      const numItems = between(1, 4);
      const chosen = new Set<number>();
      const items: {
        productId: string;
        productName: string;
        quantity: number;
        unitPrice: Prisma.Decimal;
        lineTotal: Prisma.Decimal;
      }[] = [];
      for (let j = 0; j < numItems; j++) {
        const idx = Math.floor(rand() * productRecords.length);
        if (chosen.has(idx)) continue;
        chosen.add(idx);
        const product = productRecords[idx];
        const qty = between(1, product.name === "Eggs (tray of 30)" ? 2 : 3);
        items.push({
          productId: product.id,
          productName: product.name,
          quantity: qty,
          unitPrice: new Prisma.Decimal(product.sellingPrice),
          lineTotal: new Prisma.Decimal(product.sellingPrice.toNumber() * qty),
        });
      }
      if (items.length === 0) continue;

      let subtotal = 0;
      for (const it of items) subtotal += it.lineTotal.toNumber();
      const discount = rand() < 0.12 ? Math.round((subtotal * between(5, 10)) / 100) : 0;
      const total = subtotal - discount;
      const receiptNo = buildReceiptNo(createdAt, ++saleSeq);

      const methodRoll = rand();
      const paymentMethod =
        methodRoll < 0.6
          ? "MPESA"
          : methodRoll < 0.88
            ? "CASH"
            : methodRoll < 0.94
              ? "CARD"
              : methodRoll < 0.97
                ? "BANK_TRANSFER"
                : "CREDIT";

      const hasCustomer = rand() < 0.7;
      const customer = hasCustomer ? pick(customerRecords) : null;

      const sale = await prisma.sale.create({
        data: {
          organizationId: org.id,
          customerId: customer?.id ?? null,
          receiptNo,
          status: "COMPLETED",
          paymentMethod,
          subtotal: new Prisma.Decimal(subtotal),
          discount: new Prisma.Decimal(discount),
          total: new Prisma.Decimal(total),
          createdAt,
          items: { create: items },
        },
      });
      completedSales++;
      totalRevenue += total;

      // Matching M-Pesa transaction for M-Pesa sales
      if (paymentMethod === "MPESA") {
        const receipt = mpesaReceipt();
        await prisma.mpesaTransaction.create({
          data: {
            organizationId: org.id,
            direction: "INCOMING",
            phone: customer?.phone ?? `254${randomPhone().slice(1)}`,
            accountName: customer?.name ?? null,
            amount: new Prisma.Decimal(total),
            status: "SUCCESS",
            reference: receiptNo,
            receiptNo: receipt,
            transactionType: "STK_PUSH",
            description: `Sale ${receiptNo}`,
            createdAt,
            completedAt: new Date(createdAt.getTime() + between(1, 5) * 60_000),
          },
        });
        await prisma.sale.update({
          where: { id: sale.id },
          data: { mpesaReference: receipt },
        });
      }
    }
  }

  // ---- Standalone M-Pesa transactions ----------------------------------
  // Direct C2B payments (customers paying a paybill) and B2C payouts.
  for (let i = 0; i < 25; i++) {
    const day = addDays(today, -between(0, 90));
    const createdAt = setHours(day, between(8, 20));
    const amount = pick([200, 500, 1000, 1500, 2000, 3000, 5000]);
    const customer = pick(customerRecords);
    await prisma.mpesaTransaction.create({
      data: {
        organizationId: org.id,
        direction: "INCOMING",
        phone: customer.phone ?? "254700000000",
        accountName: customer.name,
        amount: new Prisma.Decimal(amount),
        status: "SUCCESS",
        receiptNo: mpesaReceipt(),
        transactionType: "C2B",
        description: "Direct paybill payment",
        createdAt,
        completedAt: new Date(createdAt.getTime() + 60_000),
      },
    });
  }

  for (let i = 0; i < 10; i++) {
    const day = addDays(today, -between(0, 90));
    const createdAt = setHours(day, between(9, 17));
    const amount = pick([5000, 8000, 10000, 15000, 20000]);
    await prisma.mpesaTransaction.create({
      data: {
        organizationId: org.id,
        direction: "OUTGOING",
        phone: "254722000111",
        accountName: pick(["Uzuri Supplies Ltd", "GreenLeaf Farm", "Wachira Properties"]),
        amount: new Prisma.Decimal(amount),
        status: "SUCCESS",
        receiptNo: mpesaReceipt(),
        transactionType: "B2C",
        description: "Supplier payment",
        createdAt,
        completedAt: new Date(createdAt.getTime() + 2 * 60_000),
      },
    });
  }

  // One pending transaction so the "awaiting payment" flow is visible.
  await prisma.mpesaTransaction.create({
    data: {
      organizationId: org.id,
      direction: "INCOMING",
      phone: "254733445566",
      accountName: "James Mwangi",
      amount: new Prisma.Decimal(1450),
      status: "PENDING",
      transactionType: "STK_PUSH",
      description: "Sale (pending)",
      createdAt: setHours(addDays(today, 0), new Date().getHours()),
    },
  });

  // ---- Expenses --------------------------------------------------------
  const expenses: {
    category: "INVENTORY" | "RENT" | "SALARIES" | "UTILITIES" | "MARKETING" | "TRANSPORT" | "MAINTENANCE" | "SOFTWARE";
    description: string;
    vendor: string;
    amount: number;
    dayOffset: number;
  }[] = [];

  for (let m = 0; m < 3; m++) {
    const anchor = m * 30;
    expenses.push(
      { category: "RENT", description: `Shop rent — month ${m + 1}`, vendor: "Wachira Properties", amount: 25000, dayOffset: anchor + 1 },
      { category: "SALARIES", description: `Salary — Brian Kiptoo`, vendor: "Staff", amount: 15000, dayOffset: anchor + 2 },
      { category: "SALARIES", description: `Salary — Wanjiru (casual)`, vendor: "Staff", amount: 9000, dayOffset: anchor + 2 },
      { category: "UTILITIES", description: "Electricity bill", vendor: "KPLC", amount: between(2400, 3200), dayOffset: anchor + 5 },
      { category: "UTILITIES", description: "Water bill", vendor: "Nairobi Water", amount: between(1000, 1400), dayOffset: anchor + 6 },
      { category: "SOFTWARE", description: "M-Pesa Business Manager subscription", vendor: "MBM", amount: 1500, dayOffset: anchor + 7 },
    );
  }

  const restocks: [number, string, string][] = [
    [3, "Stock restock — vegetables", "Kongowea Market"],
    [9, "Stock restock — staples", "Uzuri Supplies Ltd"],
    [14, "Stock restock — dairy", "Brookside Distributor"],
    [21, "Stock restock — household", "CLEAN Household Ltd"],
    [28, "Stock restock — vegetables", "Kongowea Market"],
    [36, "Stock restock — staples", "Uzuri Supplies Ltd"],
    [45, "Stock restock — beverages", "KETEPA Wholesale"],
    [52, "Stock restock — vegetables", "Kongowea Market"],
    [60, "Stock restock — staples", "Uzuri Supplies Ltd"],
    [68, "Stock restock — household", "CLEAN Household Ltd"],
    [76, "Stock restock — dairy", "Brookside Distributor"],
    [84, "Stock restock — staples", "Uzuri Supplies Ltd"],
  ];
  for (const [offset, description, vendor] of restocks) {
    expenses.push({
      category: "INVENTORY",
      description,
      vendor,
      amount: between(8000, 42000),
      dayOffset: offset,
    });
  }

  expenses.push(
    { category: "MARKETING", description: "WhatsApp broadcast ad", vendor: "Meta", amount: 2500, dayOffset: 4 },
    { category: "MARKETING", description: "Poster printing", vendor: "PrintHub", amount: 1800, dayOffset: 33 },
    { category: "MARKETING", description: "Facebook boosted post", vendor: "Meta", amount: 3000, dayOffset: 58 },
    { category: "TRANSPORT", description: "Delivery — greenleaf farm", vendor: "Boda rider", amount: 900, dayOffset: 8 },
    { category: "TRANSPORT", description: "Goods delivery", vendor: "Pick-up", amount: 1500, dayOffset: 40 },
    { category: "TRANSPORT", description: "Delivery — Nakuru branch", vendor: "Matatu", amount: 1200, dayOffset: 70 },
    { category: "MAINTENANCE", description: "Fridge repair", vendor: "CoolFix Services", amount: 2000, dayOffset: 25 },
    { category: "MAINTENANCE", description: "Shelving install", vendor: "Metalworks KE", amount: 4500, dayOffset: 49 },
    { category: "UTILITIES", description: "Internet (Starlink)", vendor: "Starlink KE", amount: 3500, dayOffset: 12 },
    { category: "UTILITIES", description: "Internet (Starlink)", vendor: "Starlink KE", amount: 3500, dayOffset: 42 },
    { category: "UTILITIES", description: "Internet (Starlink)", vendor: "Starlink KE", amount: 3500, dayOffset: 72 },
  );

  for (const e of expenses) {
    await prisma.expense.create({
      data: {
        organizationId: org.id,
        category: e.category,
        description: e.description,
        vendor: e.vendor,
        amount: new Prisma.Decimal(e.amount),
        expenseDate: addDays(today, -e.dayOffset),
      },
    });
  }

  console.log("✅ Seed complete:");
  console.log(`   Org:            ${org.name} (${org.slug})`);
  console.log(`   Products:       ${productRecords.length}`);
  console.log(`   Customers:      ${customerRecords.length}`);
  console.log(`   Sales:          ${completedSales} (${formatKES(totalRevenue)} revenue)`);
  console.log(`   M-Pesa txns:    ${(await prisma.mpesaTransaction.count({ where: { organizationId: org.id } }))}`);
  console.log(`   Expenses:       ${expenses.length}`);
  console.log("   Demo sign-in:   any email + password (demo mode)");
}

function formatKES(n: number): string {
  return `KSh ${Math.round(n).toLocaleString("en-KE")}`;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
