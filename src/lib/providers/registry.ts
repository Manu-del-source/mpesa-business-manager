/**
 * Provider registry — resolves PaymentProvider instances by name.
 * Centralizes provider creation and ensures singleton instances per name.
 */

import type { PaymentProvider } from "@/lib/providers/types";
import { SandboxProvider } from "@/lib/providers/sandbox";

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const providers = new Map<string, PaymentProvider>();

/**
 * Register a provider instance. Overwrites any existing provider with the
 * same name.
 */
export function registerProvider(provider: PaymentProvider): void {
  providers.set(provider.name, provider);
}

/**
 * Get a registered provider by name.
 * Returns null if no provider with that name is registered.
 */
export function getProvider(name: string): PaymentProvider | null {
  return providers.get(name) ?? null;
}

/**
 * Get a registered provider by name, throwing if not found.
 */
export function requireProvider(name: string): PaymentProvider {
  const provider = providers.get(name);
  if (!provider) {
    throw new Error(
      `Provider "${name}" is not registered. ` +
      `Available providers: ${Array.from(providers.keys()).join(", ") || "none"}.`,
    );
  }
  return provider;
}

/**
 * List all registered provider names.
 */
export function listProviders(): string[] {
  return Array.from(providers.keys());
}

/**
 * Clear all registered providers (for testing).
 */
export function clearProviders(): void {
  providers.clear();
}

// ---------------------------------------------------------------------------
// Auto-registration
// ---------------------------------------------------------------------------

/**
 * Ensure the sandbox provider is always available.
 */
export function ensureDefaultProviders(): void {
  if (!providers.has("sandbox")) {
    registerProvider(new SandboxProvider());
  }
}

// Initialize on import
ensureDefaultProviders();
