import { z } from "zod";

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const signInSchema = z.object({
  email: z.string().trim().email("Enter a valid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export const signUpSchema = signInSchema.extend({
  fullName: z.string().trim().min(2, "Enter your full name"),
});

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email("Enter a valid email address"),
});

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

/** Accepts 0712 345 678, 254712345678 or +254712345678 */
export const kenyanPhoneSchema = z
  .string()
  .trim()
  .regex(/^(07\d{8}|\+?2547\d{8})$/, "Enter a valid Safaricom number, e.g. 0712 345 678");

export const moneySchema = z.coerce
  .number()
  .min(0, "Amount must be ≥ 0")
  .max(150_000_000, "Amount is too large");

// ---------------------------------------------------------------------------
// Products / inventory
// ---------------------------------------------------------------------------

export const productSchema = z.object({
  name: z.string().trim().min(2, "Product name is required"),
  sku: z.string().trim().max(40).optional().or(z.literal("")),
  category: z.string().trim().min(1, "Category is required"),
  unit: z.string().trim().min(1, "Unit is required"),
  costPrice: z.coerce.number().min(0, "Cost price must be ≥ 0"),
  sellingPrice: z.coerce.number().min(0, "Selling price must be ≥ 0"),
  stock: z.coerce.number().int().min(0, "Stock must be ≥ 0"),
  lowStockThreshold: z.coerce.number().int().min(0, "Threshold must be ≥ 0"),
});

export const stockAdjustSchema = z.object({
  productId: z.string().min(1),
  quantity: z.coerce.number().int().min(-99999, "Quantity out of range").max(99999),
});

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export const customerSchema = z.object({
  name: z.string().trim().min(2, "Customer name is required"),
  phone: kenyanPhoneSchema.optional().or(z.literal("")),
  email: z.string().trim().email("Enter a valid email").optional().or(z.literal("")),
  location: z.string().trim().max(120).optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
});

// ---------------------------------------------------------------------------
// Expenses
// ---------------------------------------------------------------------------

export const expenseCategorySchema = z.enum([
  "INVENTORY",
  "RENT",
  "SALARIES",
  "UTILITIES",
  "MARKETING",
  "TRANSPORT",
  "MAINTENANCE",
  "TAXES",
  "SOFTWARE",
  "OTHER",
]);

export const expenseSchema = z.object({
  category: expenseCategorySchema,
  amount: z.coerce.number().positive("Amount must be greater than 0"),
  description: z.string().trim().min(2, "Description is required"),
  vendor: z.string().trim().max(120).optional().or(z.literal("")),
  expenseDate: z.coerce.date({ errorMap: () => ({ message: "Enter a valid date" }) }),
});

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

export const paymentMethodSchema = z.enum([
  "MPESA",
  "CASH",
  "CARD",
  "BANK_TRANSFER",
  "CREDIT",
]);

export const saleItemInputSchema = z.object({
  productId: z.string().min(1),
  quantity: z.coerce.number().int().min(1, "Quantity must be at least 1").max(9999),
});

export const saleSchema = z.object({
  customerId: z.string().optional().or(z.literal("")),
  paymentMethod: paymentMethodSchema,
  discount: z.coerce.number().min(0).max(1_000_000),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
  items: z.array(saleItemInputSchema).min(1, "Add at least one item"),
});

// ---------------------------------------------------------------------------
// M-Pesa STK push
// ---------------------------------------------------------------------------

export const stkPushSchema = z.object({
  phone: kenyanPhoneSchema,
  amount: z.coerce.number().min(1, "Amount must be at least KSh 1").max(150_000, "M-Pesa limit is KSh 150,000"),
  reference: z.string().trim().max(40).optional().or(z.literal("")),
  description: z.string().trim().max(200).optional().or(z.literal("")),
});

// ---------------------------------------------------------------------------
// M-Pesa Daraja configuration (per organization)
// ---------------------------------------------------------------------------

export const mpesaEnvironmentSchema = z.enum(["sandbox", "production"]);

/**
 * Sentinel sent by the settings form when the admin leaves the consumer key
 * untouched. The server substitutes the stored value, so the real key never
 * has to round-trip through the browser.
 */
export const MPESA_KEEP_EXISTING = "__KEEP_EXISTING__";

/**
 * Secrets are optional on update: a blank consumerSecret/passkey means
 * "keep the stored value". The server enforces that they are present the
 * first time a configuration is created.
 */
export const mpesaConfigSchema = z.object({
  environment: mpesaEnvironmentSchema,
  shortcode: z
    .string()
    .trim()
    .regex(/^\d{5,9}$/, "Shortcode must be 5–9 digits, e.g. 174379"),
  consumerKey: z.string().trim().min(10, "Enter your Daraja consumer key"),
  consumerSecret: z
    .string()
    .trim()
    .min(10, "Consumer secret looks too short")
    .optional()
    .or(z.literal("")),
  passkey: z
    .string()
    .trim()
    .min(10, "Passkey looks too short")
    .optional()
    .or(z.literal("")),
  enabled: z.coerce.boolean(),
  callbackUrl: z
    .string()
    .trim()
    .url("Enter a valid https:// callback URL")
    .optional()
    .or(z.literal("")),
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const orgSettingsSchema = z.object({
  name: z.string().trim().min(2, "Business name is required"),
  businessType: z.string().trim().min(2, "Business type is required"),
});
